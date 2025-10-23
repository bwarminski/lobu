#!/usr/bin/env bun

import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Server as HttpServer } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { createLogger } from "@peerbot/core";
import { z } from "zod";

const logger = createLogger("worker");

/**
 * MCP resource handler parameters
 */
interface ResourceParams {
  uri?: string;
  url?: string;
  toString(): string;
}

interface ProcessInfo {
  id: string;
  command: string;
  description: string;
  status: "starting" | "running" | "completed" | "failed" | "killed";
  pid?: number;
  startedAt: string;
  completedAt?: string;
  exitCode?: number;
  process?: ChildProcess;
  port?: number;
  tunnelUrl?: string;
  tunnelProcess?: ChildProcess;
  workingDirectory?: string;
}

export interface ProcessManagerInstance {
  port: number;
  server: McpServer;
  httpServer: HttpServer;
  close: () => Promise<void>;
  stop: () => Promise<void>;
}

// ============================================================================
// PROCESS MANAGER
// ============================================================================

class ProcessManager {
  private processes: Map<string, ProcessInfo> = new Map();
  private processDir = "/tmp/agent-processes";
  private logsDir = "/tmp/claude-logs";

  constructor() {
    this.init();
  }

  private async init() {
    await mkdir(this.processDir, { recursive: true });
    await mkdir(this.logsDir, { recursive: true });
    await this.loadExistingProcesses();
  }

  private async loadExistingProcesses() {
    try {
      const files = await readdir(this.processDir);
      for (const file of files) {
        if (file.endsWith(".json")) {
          const id = file.replace(".json", "");
          const infoPath = path.join(this.processDir, file);
          const data = await readFile(infoPath, "utf-8");
          const info = JSON.parse(data) as ProcessInfo;
          this.processes.set(id, info);
        }
      }
    } catch (error) {
      logger.error("Error loading existing processes:", error);
    }
  }

  private async saveProcessInfo(info: ProcessInfo) {
    const infoPath = path.join(this.processDir, `${info.id}.json`);
    await writeFile(infoPath, JSON.stringify(info, null, 2));
  }

  private getLogPath(id: string): string {
    return path.join(this.logsDir, `${id}.log`);
  }

  async startProcess(
    id: string,
    command: string,
    description: string,
    port?: number,
    workingDirectory?: string
  ): Promise<ProcessInfo> {
    if (this.processes.has(id)) {
      const existing = this.processes.get(id)!;
      if (existing.status === "running" && existing.pid) {
        throw new Error(
          `Process ${id} is already running with PID ${existing.pid}`
        );
      }
    }

    const info: ProcessInfo = {
      id,
      command,
      description,
      status: "starting",
      startedAt: new Date().toISOString(),
      port,
      workingDirectory: workingDirectory,
    };

    const logPath = this.getLogPath(id);
    const logStream = await import("node:fs").then((fs) =>
      fs.createWriteStream(logPath, { flags: "a" })
    );

    // Determine the working directory - use provided directory, then workspace, then cwd
    const workingDir =
      workingDirectory || process.env.WORKSPACE_DIR || process.cwd();

    // Validate working directory exists
    if (!existsSync(workingDir)) {
      throw new Error(`Working directory does not exist: ${workingDir}`);
    }

    logStream.write(`Process ${id} starting at ${info.startedAt}\n`);
    logStream.write(`Command: ${command}\n`);
    logStream.write(`Working Directory: ${workingDir}\n`);
    logStream.write(`Description: ${description}\n`);
    logStream.write("---\n");

    logger.info(`[Process Manager] Starting process ${id}: ${description}`);
    logger.info(`[Process Manager] Command: ${command}`);
    logger.info(`[Process Manager] Working Directory: ${workingDir}`);

    const child = spawn("bash", ["-c", command], {
      detached: false,
      stdio: ["ignore", "pipe", "pipe"],
      cwd: workingDir,
    });

    info.pid = child.pid;
    info.status = "running";
    info.process = child;

    child.stdout?.on("data", (data) => {
      logStream.write(data);
      process.stdout.write(`[Process ${id}] ${data}`);
    });

    child.stderr?.on("data", (data) => {
      logStream.write(data);
      process.stderr.write(`[Process ${id}] ${data}`);
    });

    child.on("exit", async (code, _signal) => {
      info.status = code === 0 ? "completed" : "failed";
      info.exitCode = code || undefined;
      info.completedAt = new Date().toISOString();
      delete info.process;

      logStream.write(
        `\nProcess ${id} exited with code ${code} at ${info.completedAt}\n`
      );
      logStream.end();

      logger.info(`[Process Manager] Process ${id} exited with code ${code}`);

      await this.saveProcessInfo(info);

      // Kill tunnel if main process dies
      if (info.tunnelProcess?.pid) {
        logger.info(
          `[Process Manager] Stopping tunnel for ${id} since main process exited`
        );
        try {
          process.kill(info.tunnelProcess.pid, "SIGTERM");
        } catch (_e) {
          // Tunnel already dead
        }
        delete info.tunnelProcess;
        info.tunnelUrl = undefined;
      }
    });

    this.processes.set(id, info);
    await this.saveProcessInfo(info);

    // Start tunnel if port is specified
    if (port) {
      this.startTunnel(id, port, 0);
    }

    return info;
  }

  private async startTunnel(
    id: string,
    port: number,
    retryCount: number = 0
  ): Promise<void> {
    const info = this.processes.get(id);
    if (!info) return;

    // Skip if we already have a working tunnel
    if (info.tunnelUrl && info.tunnelProcess) {
      logger.info(
        `[MCP Process Manager] Tunnel already exists for ${id}: ${info.tunnelUrl}`
      );
      return;
    }

    // Add exponential backoff delay between retries to avoid rate limiting
    if (retryCount > 0) {
      const delay = Math.min(30000 * 2 ** (retryCount - 1), 120000);
      logger.error(
        `[MCP Process Manager] Cloudflare rate limit detected. Waiting ${delay / 1000}s before retry attempt ${retryCount + 1} for tunnel`
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    const tunnelLogPath = path.join(this.logsDir, `${id}-tunnel.log`);
    const tunnelLogStream = await import("node:fs").then((fs) =>
      fs.createWriteStream(tunnelLogPath, { flags: "a" })
    );

    tunnelLogStream.write(
      `Starting cloudflared tunnel for port ${port} at ${new Date().toISOString()} (attempt ${retryCount + 1})\n`
    );

    logger.error(
      `[MCP Process Manager] Starting cloudflared tunnel for process ${id} on port ${port} (attempt ${retryCount + 1})`
    );

    const tunnelChild = spawn(
      "cloudflared",
      ["tunnel", "--url", `http://localhost:${port}`],
      {
        detached: false,
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    tunnelChild.on("error", (err) => {
      logger.error(
        `[Process Manager] Failed to spawn cloudflared: ${err.message}`
      );
      tunnelLogStream.write(
        `ERROR: Failed to spawn cloudflared: ${err.message}\n`
      );
      info.tunnelUrl = undefined;
      delete info.tunnelProcess;
    });

    info.tunnelProcess = tunnelChild;

    let urlExtracted = false;
    const extractTimeout = setTimeout(() => {
      if (!urlExtracted) {
        tunnelLogStream.write(
          "Failed to extract tunnel URL within 15 seconds\n"
        );
        logger.error(`Failed to extract tunnel URL for process ${id}`);

        if (info.tunnelProcess) {
          try {
            process.kill(info.tunnelProcess.pid!, "SIGTERM");
          } catch (_e) {
            // Process already terminated
          }
          delete info.tunnelProcess;
          info.tunnelUrl = undefined;
        }
      }
    }, 15000);

    let rateLimitDetected = false;

    const extractUrl = (data: Buffer) => {
      const output = data.toString();
      tunnelLogStream.write(output);

      if (output.includes("trycloudflare.com")) {
        tunnelLogStream.write(
          `\n[MCP] Found trycloudflare.com in output, attempting extraction...\n`
        );
      }

      logger.error(
        `[MCP Process Manager - Cloudflared Output] ${output.trim()}`
      );

      if (
        output.includes("429 Too Many Requests") ||
        output.includes("error code: 1015")
      ) {
        rateLimitDetected = true;
        tunnelLogStream.write(
          `\n[MCP] Rate limit detected (429 Too Many Requests)\n`
        );
        logger.error(
          `[MCP Process Manager] Cloudflare rate limit detected (429 Too Many Requests)`
        );
      }

      const urlMatch = output.match(
        /https?:\/\/([a-z0-9-]+)\.trycloudflare\.com/i
      );
      if (urlMatch && !urlExtracted) {
        urlExtracted = true;
        clearTimeout(extractTimeout);
        const prefix = urlMatch[1];
        info.tunnelUrl = `https://${prefix}.peerbot.ai`;
        tunnelLogStream.write(
          `\n[MCP] Successfully extracted URL: ${urlMatch[0]}\n`
        );
        tunnelLogStream.write(
          `[MCP] Converted to peerbot.ai: ${info.tunnelUrl}\n`
        );
        logger.error(
          `[MCP Process Manager - Tunnel ${id}] Established: ${info.tunnelUrl}`
        );
        logger.error(
          `[MCP Process Manager - Tunnel ${id}] Original cloudflared URL: ${urlMatch[0]}`
        );
        this.saveProcessInfo(info);
      }
    };

    tunnelChild.stdout?.on("data", extractUrl);
    tunnelChild.stderr?.on("data", extractUrl);

    tunnelChild.on("exit", (code, signal) => {
      clearTimeout(extractTimeout);
      tunnelLogStream.write(
        `\nTunnel process exited with code ${code} at ${new Date().toISOString()}\n`
      );
      tunnelLogStream.end();

      logger.error(
        `[MCP Process Manager] Cloudflared exited with code ${code}, signal: ${signal}`
      );

      if (info.tunnelProcess === tunnelChild) {
        delete info.tunnelProcess;
        info.tunnelUrl = undefined;
        this.saveProcessInfo(info);

        if (code !== 0 && !urlExtracted && retryCount < 2) {
          if (rateLimitDetected) {
            logger.error(
              `[MCP Process Manager] Cloudflared hit rate limit - will retry with longer backoff (attempt ${retryCount + 2}/3)`
            );
          } else {
            logger.error(
              `[MCP Process Manager] Cloudflared failed with exit code ${code} - retrying tunnel (attempt ${retryCount + 2}/3)`
            );
          }
          this.startTunnel(id, port, retryCount + 1);
        } else if (code !== 0 && !urlExtracted) {
          if (rateLimitDetected) {
            logger.error(
              `[MCP Process Manager] Cloudflared rate limited after ${retryCount + 1} attempts - consider using alternative tunnel solution`
            );
          } else {
            logger.error(
              `[MCP Process Manager] Cloudflared failed after ${retryCount + 1} attempts - tunnel not established`
            );
          }
        }
      }
    });

    tunnelChild.on("error", (error) => {
      clearTimeout(extractTimeout);
      tunnelLogStream.write(`Tunnel process error: ${error.message}\n`);
      logger.error(
        `Failed to start cloudflared tunnel for process ${id}:`,
        error
      );

      if (!urlExtracted) {
        urlExtracted = true;
        info.tunnelUrl = undefined;
        delete info.tunnelProcess;
        this.saveProcessInfo(info);
      }
    });
  }

  async stopProcess(id: string): Promise<void> {
    const info = this.processes.get(id);
    if (!info) {
      throw new Error(`Process ${id} not found`);
    }

    if (info.status !== "running" || !info.pid) {
      throw new Error(`Process ${id} is not running`);
    }

    try {
      if (info.tunnelProcess?.pid) {
        try {
          process.kill(info.tunnelProcess.pid, "SIGTERM");
        } catch (_e) {
          // Tunnel process already terminated
        }
        delete info.tunnelProcess;
        info.tunnelUrl = undefined;
      }

      process.kill(info.pid, "SIGTERM");

      setTimeout(() => {
        try {
          process.kill(info.pid!, "SIGKILL");
        } catch (_e) {
          // Process already terminated
        }
      }, 5000);

      info.status = "killed";
      info.completedAt = new Date().toISOString();
      delete info.process;

      await this.saveProcessInfo(info);
    } catch (error) {
      throw new Error(`Failed to kill process ${id}: ${error}`);
    }
  }

  async restartProcess(
    id: string,
    workingDirectory?: string
  ): Promise<ProcessInfo> {
    const info = this.processes.get(id);
    if (!info) {
      throw new Error(`Process ${id} not found`);
    }

    if (info.status === "running") {
      await this.stopProcess(id);
    }

    return this.startProcess(
      id,
      info.command,
      info.description,
      info.port,
      workingDirectory
    );
  }

  getStatus(id?: string): ProcessInfo | ProcessInfo[] | null {
    if (id) {
      return this.processes.get(id) || null;
    }
    return Array.from(this.processes.values());
  }

  async getLogs(id: string, lines: number = 50): Promise<string> {
    const logPath = this.getLogPath(id);
    if (!existsSync(logPath)) {
      return `No logs found for process ${id}`;
    }

    try {
      const content = await readFile(logPath, "utf-8");
      const allLines = content.split("\n");
      const lastLines = allLines.slice(-lines).join("\n");
      return lastLines;
    } catch (error) {
      return `Error reading logs for process ${id}: ${error}`;
    }
  }
}

// ============================================================================
// MCP SERVER
// ============================================================================

function createMCPServer(manager: ProcessManager): McpServer {
  const server = new McpServer({
    name: "Process Manager",
    version: "1.0.0",
  });

  // Register tools
  server.tool(
    "start_process",
    "Start a background process with monitoring and optional tunnel",
    {
      id: z.string().describe("Unique identifier for the process"),
      command: z.string().describe("Command to execute"),
      description: z.string().describe("Description of what this process does"),
      port: z
        .number()
        .optional()
        .describe("Optional port to expose via cloudflared tunnel"),
      workingDirectory: z
        .string()
        .optional()
        .describe(
          "Optional working directory for the process (defaults to workspace directory)"
        ),
    },
    async ({ id, command, description, port, workingDirectory }) => {
      try {
        const info = await manager.startProcess(
          id,
          command,
          description,
          port,
          workingDirectory
        );

        // If port is specified, wait for tunnel URL and verify service health
        if (port) {
          let tunnelUrl: string | undefined;
          let serviceHealthy = false;
          let healthCheckAttempts = 0;
          const maxHealthChecks = 60;
          const healthCheckInterval = 2000;

          logger.error(
            `[MCP Process Manager] Waiting for service on port ${port} to be ready...`
          );

          while (!serviceHealthy && healthCheckAttempts < maxHealthChecks) {
            healthCheckAttempts++;

            const currentInfo = manager.getStatus(id) as ProcessInfo | null;
            if (!currentInfo || currentInfo.status !== "running") {
              logger.error(
                `[MCP Process Manager] Process ${id} exited with code ${currentInfo?.exitCode}, stopping health checks`
              );
              break;
            }

            tunnelUrl = currentInfo.tunnelUrl;

            for (const host of ["localhost", "127.0.0.1", "0.0.0.0"]) {
              try {
                const response = await fetch(`http://${host}:${port}/`, {
                  method: "GET",
                  signal: AbortSignal.timeout(1500),
                });

                if (response.status) {
                  serviceHealthy = true;
                  logger.error(
                    `[MCP Process Manager] Service on port ${port} is healthy at ${host} (status: ${response.status})`
                  );
                  break;
                }
              } catch (error: unknown) {
                const err = error as { cause?: { code?: string } };
                if (
                  err.cause?.code === "ECONNREFUSED" &&
                  healthCheckAttempts === 1
                ) {
                  logger.error(
                    `[MCP Process Manager] Port ${port} not ready yet (connection refused)`
                  );
                }
              }
            }

            if (serviceHealthy) {
              break;
            }

            if (healthCheckAttempts % 5 === 0) {
              logger.error(
                `[MCP Process Manager] Service not ready on port ${port} (attempt ${healthCheckAttempts}/${maxHealthChecks})`
              );
            }

            await new Promise((resolve) =>
              setTimeout(resolve, healthCheckInterval)
            );
          }

          if (serviceHealthy && !tunnelUrl) {
            await new Promise((resolve) => setTimeout(resolve, 5000));
            const finalInfo = manager.getStatus(id) as ProcessInfo | null;
            tunnelUrl = finalInfo?.tunnelUrl;
          }

          if (serviceHealthy && tunnelUrl) {
            return {
              content: [
                {
                  type: "text",
                  text: `✅ Started process ${id} (PID: ${info.pid})\n🌐 Tunnel URL: ${tunnelUrl}\n📡 Service verified on port ${port}`,
                },
              ],
            };
          } else if (serviceHealthy && !tunnelUrl) {
            let tunnelLogs = "";
            try {
              const tunnelLogPath = path.join(
                "/tmp/claude-logs",
                `${id}-tunnel.log`
              );
              if (existsSync(tunnelLogPath)) {
                tunnelLogs = await readFile(tunnelLogPath, "utf-8");
                const lines = tunnelLogs.split("\n");
                tunnelLogs = lines.slice(-20).join("\n");
              }
            } catch (_e) {
              // Tunnel log may not exist
            }

            return {
              content: [
                {
                  type: "text",
                  text: `⚠️ Process ${id} started (PID: ${info.pid})\n✅ Service running on port ${port}\n❌ Failed to establish tunnel\n\n**Tunnel Logs:**\n\`\`\`\n${tunnelLogs || "No tunnel logs available"}\n\`\`\``,
                },
              ],
            };
          } else {
            const processLogs = await manager.getLogs(id, 50);
            let tunnelLogs = "";
            try {
              const tunnelLogPath = path.join(
                "/tmp/claude-logs",
                `${id}-tunnel.log`
              );
              if (existsSync(tunnelLogPath)) {
                tunnelLogs = await readFile(tunnelLogPath, "utf-8");
                const lines = tunnelLogs.split("\n");
                tunnelLogs = lines.slice(-30).join("\n");
              }
            } catch (_e) {
              // Tunnel log may not exist
            }

            try {
              await manager.stopProcess(id);
            } catch (_e) {
              // Process may have already stopped
            }

            return {
              content: [
                {
                  type: "text",
                  text: `❌ Service failed to respond on port ${port} after ${(maxHealthChecks * healthCheckInterval) / 1000} seconds\n\n**Process Logs:**\n\`\`\`\n${processLogs}\n\`\`\`${tunnelLogs ? `\n\n**Tunnel Logs:**\n\`\`\`\n${tunnelLogs}\n\`\`\`` : ""}`,
                },
              ],
              isError: true,
            };
          }
        }

        return {
          content: [
            {
              type: "text",
              text: `Started process ${id} (PID: ${info.pid})`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to start process: ${error}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "stop_process",
    "Stop a running process",
    {
      id: z.string().describe("Process ID to stop"),
    },
    async ({ id }) => {
      try {
        await manager.stopProcess(id);
        return {
          content: [
            {
              type: "text",
              text: `Stopped process ${id}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to stop process: ${error}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "restart_process",
    "Restart a process",
    {
      id: z.string().describe("Process ID to restart"),
      workingDirectory: z
        .string()
        .optional()
        .describe("Optional new working directory for the process"),
    },
    async ({ id, workingDirectory }) => {
      try {
        const info = await manager.restartProcess(id, workingDirectory);
        return {
          content: [
            {
              type: "text",
              text: `Restarted process ${id} (PID: ${info.pid})`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to restart process: ${error}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "get_process_status",
    "Get status of processes",
    {
      id: z.string().optional().describe("Process ID (omit to get all)"),
    },
    async ({ id }) => {
      const status = manager.getStatus(id);
      if (!status) {
        return {
          content: [
            {
              type: "text",
              text: `Process ${id} not found`,
            },
          ],
          isError: true,
        };
      }

      const processes = Array.isArray(status) ? status : [status];
      const statusText = processes
        .map(
          (p) =>
            `${p.id}: ${p.status}${p.pid ? ` (PID: ${p.pid})` : ""}
  Description: ${p.description}
  Started: ${p.startedAt}${p.completedAt ? `\n  Completed: ${p.completedAt}` : ""}${
    p.exitCode !== undefined ? `\n  Exit code: ${p.exitCode}` : ""
  }${p.port ? `\n  Port: ${p.port}` : ""}${p.tunnelUrl ? `\n  Tunnel URL: ${p.tunnelUrl}` : ""}
`
        )
        .join("\n\n");

      return {
        content: [
          {
            type: "text",
            text: statusText || "No processes found",
          },
        ],
      };
    }
  );

  server.tool(
    "get_process_logs",
    "Get logs from a process",
    {
      id: z.string().describe("Process ID"),
      lines: z
        .number()
        .optional()
        .default(50)
        .describe("Number of lines to retrieve"),
    },
    async ({ id, lines }) => {
      const logs = await manager.getLogs(id, lines);
      return {
        content: [
          {
            type: "text",
            text: logs,
          },
        ],
      };
    }
  );

  // Register resources
  server.resource(
    "processes://list",
    "List all managed processes",
    { mimeType: "application/json" },
    async () => {
      const processes = manager.getStatus() as ProcessInfo[];
      return {
        contents: [
          {
            uri: "processes://list",
            mimeType: "application/json",
            text: JSON.stringify(processes, null, 2),
          },
        ],
      };
    }
  );

  server.resource(
    "processes://logs/*",
    "Get logs for a specific process",
    { mimeType: "text/plain" },
    async (params: ResourceParams) => {
      const uri = params.uri || params.url || params.toString();
      const id = uri.replace("processes://logs/", "");
      const logs = await manager.getLogs(id, 1000);
      return {
        contents: [
          {
            uri,
            mimeType: "text/plain",
            text: logs,
          },
        ],
      };
    }
  );

  server.resource(
    "processes://status/*",
    "Get status of a specific process",
    { mimeType: "application/json" },
    async (params: ResourceParams) => {
      const uri = params.uri || params.url || params.toString();
      const id = uri.replace("processes://status/", "");
      const status = manager.getStatus(id);
      return {
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: JSON.stringify(status, null, 2),
          },
        ],
      };
    }
  );

  return server;
}

// ============================================================================
// HTTP SERVER
// ============================================================================

let processManagerInstance: ProcessManagerInstance | null = null;

async function startHTTPServer(
  server: McpServer
): Promise<ProcessManagerInstance> {
  const port = parseInt(process.env.MCP_PROCESS_MANAGER_PORT || "3001", 10);

  const express = await import("express");
  const cors = await import("cors");

  const app = express.default();

  app.use(
    cors.default({
      origin: "*",
      methods: ["GET", "POST"],
      allowedHeaders: ["Content-Type"],
      exposedHeaders: ["Mcp-Session-Id"],
    })
  );

  app.use(express.default.json());

  const transports: Record<string, SSEServerTransport> = {};

  app.get("/sse", async (_req, res) => {
    const transport = new SSEServerTransport("/messages", res);
    transports[transport.sessionId] = transport;

    res.on("close", () => {
      delete transports[transport.sessionId];
    });

    await server.connect(transport);
  });

  app.post("/messages", async (req, res) => {
    const sessionId = req.query.sessionId as string;
    const transport = transports[sessionId];
    if (transport) {
      await transport.handlePostMessage(req, res, req.body);
    } else {
      res.status(400).send("No transport found for sessionId");
    }
  });

  const httpServer = app.listen(port, () => {
    logger.error(`[Process Manager MCP] HTTP server started on port ${port}`);
  });

  return {
    port,
    server,
    httpServer,
    close: async () => {
      httpServer.close();
      Object.values(transports).forEach((transport) => {
        try {
          transport.close?.();
        } catch (_e) {
          // Ignore close errors
        }
      });
    },
    stop: async () => {
      httpServer.close();
      Object.values(transports).forEach((transport) => {
        try {
          transport.close?.();
        } catch (_e) {
          // Ignore close errors
        }
      });
    },
  };
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Start the process manager MCP server
 */
export async function startProcessManager(): Promise<ProcessManagerInstance> {
  if (processManagerInstance) {
    logger.info(
      "Process manager already running on port",
      processManagerInstance.port
    );
    return processManagerInstance;
  }

  try {
    logger.info("🔧 Starting process manager MCP server...");

    const manager = new ProcessManager();
    const server = createMCPServer(manager);
    processManagerInstance = await startHTTPServer(server);

    logger.info(
      `✅ Process manager MCP server started on port ${processManagerInstance.port}`
    );
    return processManagerInstance;
  } catch (error) {
    logger.error("❌ Failed to start process manager MCP server:", error);
    throw error;
  }
}

/**
 * Stop the process manager server
 */
export async function stopProcessManager(): Promise<void> {
  if (processManagerInstance) {
    logger.info("🛑 Stopping process manager MCP server...");
    await processManagerInstance.stop();
    processManagerInstance = null;
  }
}

/**
 * Get the current process manager instance
 */
export function getProcessManagerInstance(): ProcessManagerInstance | null {
  return processManagerInstance;
}
