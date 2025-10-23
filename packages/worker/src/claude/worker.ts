#!/usr/bin/env bun

import { query } from "@anthropic-ai/claude-agent-sdk";
import type {
  McpServerConfig,
  Options as SDKOptions,
  SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { createLogger } from "@peerbot/core";
import { BaseWorker } from "../base/base-worker";
import type { WorkerConfig } from "../types";
import type { InstructionProvider } from "../instructions/types";
import { ClaudeCoreInstructionProvider } from "./instructions";
import { ProgressProcessor } from "./processor";
import { ensureBaseUrl } from "../utils/url";
import type {
  ProgressUpdate,
  ProgressCallback,
  SessionExecutionResult,
} from "../base/types";

const logger = createLogger("claude-worker");

// ============================================================================
// TYPES
// ============================================================================

// Claude-specific execution options
export interface ClaudeExecutionOptions {
  allowedTools?: string;
  disallowedTools?: string;
  maxTurns?: string;
  systemPrompt?: string;
  appendSystemPrompt?: string;
  claudeEnv?: string;
  fallbackModel?: string;
  timeoutMinutes?: string;
  model?: string;
  sessionId?: string;
  resumeSessionId?: string;
}

export interface ClaudeExecutionResult {
  success: boolean;
  exitCode: number;
  output: string;
  error?: string;
}

// ============================================================================
// TOOL STATUS MAPPING
// ============================================================================

/**
 * Tool input parameters (flexible structure for different tools)
 */
interface ToolInput {
  command?: string;
  file_path?: string;
  pattern?: string;
  description?: string;
  prompt?: string;
  [key: string]: unknown;
}

/**
 * Map Claude Code tool names to friendly status messages with parameters
 */
function getToolStatus(toolName: string, toolInput?: ToolInput): string {
  const truncate = (str: string, maxLen: number = 50): string => {
    if (!str) return "";
    if (str.length <= maxLen) return str;
    return `${str.substring(0, maxLen)}...`;
  };

  const getFileName = (path: string): string => {
    if (!path) return "";
    const parts = path.split("/");
    return parts[parts.length - 1] || path;
  };

  switch (toolName) {
    case "Bash": {
      const command = toolInput?.command;
      if (command) {
        const shortCmd = truncate(command, 40);
        return `running: ${shortCmd}`;
      }
      return "is running command";
    }
    case "Read": {
      const filePath = toolInput?.file_path;
      if (filePath) {
        return `reading: ${getFileName(filePath)}`;
      }
      return "is reading file";
    }
    case "Write": {
      const filePath = toolInput?.file_path;
      if (filePath) {
        return `writing: ${getFileName(filePath)}`;
      }
      return "is writing file";
    }
    case "Edit": {
      const filePath = toolInput?.file_path;
      if (filePath) {
        return `editing: ${getFileName(filePath)}`;
      }
      return "is editing file";
    }
    case "Grep": {
      const pattern = toolInput?.pattern;
      if (pattern) {
        return `searching: ${truncate(pattern, 30)}`;
      }
      return "searching";
    }
    case "Glob": {
      const pattern = toolInput?.pattern;
      if (pattern) {
        return `finding: ${truncate(pattern, 30)}`;
      }
      return "is finding files";
    }
    case "Task": {
      const description = toolInput?.description;
      if (description) {
        return `launching: ${truncate(description, 35)}`;
      }
      return "launching agent";
    }
    case "WebFetch": {
      const url = toolInput?.url;
      if (url && typeof url === "string") {
        try {
          const urlObj = new URL(url);
          return `fetching: ${urlObj.hostname}`;
        } catch {
          return `fetching: ${truncate(url, 30)}`;
        }
      }
      return "is fetching web page";
    }
    case "WebSearch": {
      const query = toolInput?.query;
      if (query && typeof query === "string") {
        return `searching: ${truncate(query, 35)}`;
      }
      return "is searching web";
    }
    case "SlashCommand": {
      const command = toolInput?.command;
      if (command && typeof command === "string") {
        return `running: ${truncate(command, 40)}`;
      }
      return "running command";
    }
    case "AskUserQuestion": {
      return "is asking question";
    }
    case "TodoWrite": {
      return "is updating tasks";
    }
    default:
      return `is using ${toolName}`;
  }
}

// ============================================================================
// MCP CONFIGURATION
// ============================================================================

interface MCPServerConfig {
  type?: "sse" | "stdio";
  url?: string;
  description?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  headers?: Record<string, string>;
}

interface MCPConfigResponse {
  mcpServers?: Record<string, MCPServerConfig>;
}

/**
 * Convert gateway MCP config to Claude SDK format
 */
async function getMCPServersForSDK(): Promise<
  Record<string, McpServerConfig> | undefined
> {
  const dispatcherUrl = process.env.DISPATCHER_URL;
  const workerToken = process.env.WORKER_TOKEN;

  if (!dispatcherUrl || !workerToken) {
    logger.warn("Missing dispatcher URL or worker token for MCP config");
    return undefined;
  }

  try {
    const url = new URL("/worker/mcp/config", ensureBaseUrl(dispatcherUrl));
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${workerToken}`,
      },
    });

    if (!response.ok) {
      logger.warn("Gateway returned non-success status for MCP config", {
        status: response.status,
      });
      return undefined;
    }

    const data = (await response.json()) as MCPConfigResponse;
    if (!data?.mcpServers) {
      return undefined;
    }

    logger.info(
      `Received ${Object.keys(data.mcpServers).length} MCPs from gateway:`,
      {
        mcpIds: Object.keys(data.mcpServers),
        configs: Object.entries(data.mcpServers).map(([id, cfg]) => ({
          id,
          type: cfg.type,
          hasUrl: !!cfg.url,
          hasCommand: !!cfg.command,
        })),
      }
    );

    // Convert gateway format to SDK format
    const sdkServers: Record<string, McpServerConfig> = {};

    for (const [name, config] of Object.entries(data.mcpServers)) {
      if (config.type === "sse" && config.url) {
        sdkServers[name] = {
          type: "http",
          url: config.url,
          headers: config.headers || {},
        };
        logger.info(`Including HTTP MCP server: ${name}`);
      } else if (config.command) {
        sdkServers[name] = {
          command: config.command,
          args: config.args || [],
          env: config.env || {},
        };
        logger.info(`Including stdio MCP server: ${name}`);
      } else {
        logger.warn(`Skipping MCP ${name} - no type=sse or command property`, {
          type: config.type,
          hasUrl: !!config.url,
          hasCommand: !!config.command,
        });
      }
    }

    logger.info(
      `Configured ${Object.keys(sdkServers).length} MCP servers for SDK (filtered from ${Object.keys(data.mcpServers).length})`
    );
    return Object.keys(sdkServers).length > 0 ? sdkServers : undefined;
  } catch (error) {
    logger.error("Failed to fetch MCP config from gateway", { error });
    return undefined;
  }
}

// ============================================================================
// SDK EXECUTION
// ============================================================================

/**
 * Execute Claude session using the SDK
 */
async function runClaudeWithSDK(
  userPrompt: string,
  options: ClaudeExecutionOptions,
  onProgress?: ProgressCallback,
  workingDirectory?: string
): Promise<ClaudeExecutionResult> {
  logger.info("Starting Claude SDK execution");

  try {
    const mcpServers = await getMCPServersForSDK();

    const sdkOptions: SDKOptions = {
      model: options.model,
      cwd: workingDirectory || process.cwd(),
      permissionMode: "bypassPermissions",
      env: {
        ...process.env,
        DEBUG: "1",
      },
      stderr: (message: string) => {
        logger.error(`[Claude CLI stderr] ${message}`);
      },
    };

    // Add session management
    if (options.resumeSessionId === "continue") {
      logger.info("Continuing previous session in workspace");
    } else if (options.resumeSessionId) {
      sdkOptions.resume = options.resumeSessionId;
      logger.info(`Resuming session: ${options.resumeSessionId}`);
    }
    // Note: SDK doesn't support explicit sessionId setting

    // Add system prompts
    if (options.systemPrompt && options.appendSystemPrompt) {
      sdkOptions.systemPrompt = {
        type: "preset",
        preset: "claude_code",
        append: options.appendSystemPrompt,
      };
    } else if (options.systemPrompt) {
      sdkOptions.systemPrompt = options.systemPrompt;
    }

    // Add MCP servers
    if (mcpServers) {
      sdkOptions.mcpServers = mcpServers;
    }

    // Add tool restrictions
    if (options.allowedTools) {
      sdkOptions.allowedTools = options.allowedTools
        .split(",")
        .map((t) => t.trim());
    }
    if (options.disallowedTools) {
      sdkOptions.disallowedTools = options.disallowedTools
        .split(",")
        .map((t) => t.trim());
    }

    // Add max turns
    if (options.maxTurns) {
      const maxTurnsNum = parseInt(options.maxTurns, 10);
      if (!Number.isNaN(maxTurnsNum) && maxTurnsNum > 0) {
        sdkOptions.maxTurns = maxTurnsNum;
      }
    }

    logger.info(`SDK options: ${JSON.stringify(sdkOptions, null, 2)}`);

    // Execute query
    const response = query({
      prompt: userPrompt,
      options: sdkOptions,
    });

    let output = "";
    let capturedSessionId: string | undefined;
    let messageCount = 0;
    let lastMessageTime = Date.now();

    // Process streaming responses
    for await (const message of response) {
      messageCount++;
      const now = Date.now();
      const timeSinceLastMessage = now - lastMessageTime;
      lastMessageTime = now;

      logger.info(
        `SDK message #${messageCount} (${timeSinceLastMessage}ms since last): ${message.type}`,
        {
          messageType: message.type,
          subtype: "subtype" in message ? message.subtype : undefined,
          timeSinceLastMessage,
        }
      );

      // Send progress updates
      if (onProgress) {
        await onProgress({
          type: "output",
          data: message,
          timestamp: Date.now(),
        });
      }

      // Handle different message types
      switch (message.type) {
        case "system":
          if (message.subtype === "init") {
            capturedSessionId = message.session_id;
            logger.info(`SDK session started: ${capturedSessionId}`);
          }
          logger.info(`System message subtype: ${message.subtype}`, {
            subtype: message.subtype,
            sessionId: message.session_id,
          });
          break;

        case "assistant": {
          const assistantMsg = message.message;
          if (assistantMsg && Array.isArray(assistantMsg.content)) {
            logger.info(
              `Assistant message (${assistantMsg.content.length} blocks)`
            );
            for (const block of assistantMsg.content) {
              if (block.type === "text" && block.text) {
                logger.info(`  Text block: ${block.text.substring(0, 100)}`);
                output += `${block.text}\n`;
              } else if (block.type === "tool_use") {
                logger.info(
                  `🔧 Tool use: ${block.name} with params: ${JSON.stringify(block.input)}`
                );

                // Send status update for tool usage
                if (onProgress) {
                  const toolStatus = getToolStatus(block.name, block.input);
                  await onProgress({
                    type: "status",
                    data: { status: toolStatus },
                    timestamp: Date.now(),
                  });
                }
              }
            }
          } else {
            logger.warn(`Unexpected assistant message structure`, {
              hasMessage: "message" in message,
              messageType: typeof message.message,
            });
          }
          break;
        }

        case "result": {
          if (message.subtype === "success" && "result" in message) {
            const resultStr = String(message.result);
            logger.info(
              `SDK result received (${resultStr.length} chars): ${resultStr.substring(0, 200)}`
            );
            output = resultStr;
          } else {
            logger.warn(`Result message without success: ${message.subtype}`, {
              subtype: message.subtype,
              isError: message.is_error,
            });
          }
          break;
        }

        case "stream_event":
          logger.debug(`Stream event received`);
          break;

        case "user": {
          const userMsg = message.message;
          if (userMsg?.content?.[0]?.type === "tool_result") {
            logger.debug(`Tool result returned to Claude`);
          }
          break;
        }
      }
    }

    logger.info(
      `Claude SDK execution completed successfully (${messageCount} messages received, final output: ${output.length} chars)`
    );

    // Call completion callback
    if (onProgress) {
      await onProgress({
        type: "completion",
        data: { success: true, sessionId: capturedSessionId },
        timestamp: Date.now(),
      });
    }

    return {
      success: true,
      exitCode: 0,
      output: output.trim(),
    };
  } catch (error) {
    logger.error("Claude SDK execution failed:", {
      error,
      errorMessage: error instanceof Error ? error.message : String(error),
      errorStack: error instanceof Error ? error.stack : undefined,
      errorType: error?.constructor?.name,
      errorKeys:
        error && typeof error === "object" ? Object.keys(error) : undefined,
    });

    const errorMessage = error instanceof Error ? error.message : String(error);

    // Call error callback
    if (onProgress) {
      await onProgress({
        type: "error",
        data: { error: errorMessage },
        timestamp: Date.now(),
      });
    }

    return {
      success: false,
      exitCode: 1,
      output: "",
      error: errorMessage,
    };
  }
}

// ============================================================================
// CLAUDE WORKER
// ============================================================================

/**
 * Claude Code worker implementation
 * Extends BaseWorker with Claude SDK-specific execution logic
 */
export class ClaudeWorker extends BaseWorker {
  private progressProcessor: ProgressProcessor;

  constructor(config: WorkerConfig) {
    super(config);
    this.progressProcessor = new ProgressProcessor();
  }

  protected getAgentName(): string {
    return "Claude Code";
  }

  protected getCoreInstructionProvider(): InstructionProvider {
    return new ClaudeCoreInstructionProvider();
  }

  protected getLoadingMessages(isResumedSession: boolean): string[] {
    return [
      isResumedSession ? "⚙️ resuming workspace" : "⚙️ setting up workspace",
      "⚙️ preparing Claude session",
      "🚀 starting Claude Code",
      "💭 thinking",
      "🔥 burning tokens",
    ];
  }

  protected async runAISession(
    userPrompt: string,
    customInstructions: string,
    onProgress: (update: ProgressUpdate) => Promise<void>
  ): Promise<SessionExecutionResult> {
    try {
      logger.info(`Creating Claude SDK session ${this.config.sessionKey}`);

      // Parse Claude options
      const agentOptions: ClaudeExecutionOptions = JSON.parse(
        this.config.agentOptions
      );

      // Execute Claude with SDK
      const result = await runClaudeWithSDK(
        userPrompt,
        {
          ...agentOptions,
          appendSystemPrompt: customInstructions,
          ...(this.config.resumeSessionId
            ? { resumeSessionId: this.config.resumeSessionId }
            : this.config.sessionId
              ? { sessionId: this.config.sessionId }
              : {}),
        },
        async (update) => {
          await onProgress(update);
        },
        this.getWorkingDirectory()
      );

      return {
        ...result,
        sessionKey: this.config.sessionKey,
        persisted: false,
        storagePath: `${this.config.platform || "platform"}://thread`,
      };
    } catch (error) {
      logger.error(
        `Session ${this.config.sessionKey} execution failed:`,
        error
      );

      return {
        success: false,
        exitCode: 1,
        output: "",
        error: error instanceof Error ? error.message : "Unknown error",
        sessionKey: this.config.sessionKey,
      };
    }
  }

  protected async processProgressUpdate(
    update: ProgressUpdate
  ): Promise<string | null> {
    // Type guard to check if data is an SDKMessage
    const isSDKMessage = (data: unknown): data is SDKMessage => {
      return typeof data === "object" && data !== null && "type" in data;
    };

    // Skip system messages
    if (isSDKMessage(update.data) && update.data.type === "system") {
      logger.debug(
        `Skipping system message: ${"subtype" in update.data ? update.data.subtype : "unknown"}`
      );
      return null;
    }

    // Process the update to extract user-friendly content (only for SDKMessage types)
    if (!isSDKMessage(update.data)) {
      return null;
    }
    const processResult = this.progressProcessor.processUpdate(update.data);

    // Check if this is a final result message
    if (processResult?.isFinal) {
      this.progressProcessor.setFinalResult(processResult);
      logger.info(
        `📦 Stored final result (${processResult.text.length} chars) for deduplication`
      );
      return null;
    }

    // Show thinking content as status if present
    const thinkingContent = this.progressProcessor.getCurrentThinking();
    if (thinkingContent) {
      const maxLength = 100;
      const displayThinking =
        thinkingContent.length > maxLength
          ? `${thinkingContent.substring(0, maxLength)}...`
          : thinkingContent;
      logger.info(`💭 Sending thinking status update: ${displayThinking}`);
      await this.gatewayIntegration.updateStatus(displayThinking);
    }

    // Get delta and return
    return this.progressProcessor.getDelta();
  }

  protected getFinalResult(): { text: string; isFinal: boolean } | null {
    return this.progressProcessor.getFinalResult();
  }

  protected resetProgressState(): void {
    this.progressProcessor.reset();
  }

  protected async cleanupSession(sessionKey: string): Promise<void> {
    logger.info(`Cleanup for ${sessionKey} (no-op in stateless mode)`);
  }
}

export type { WorkerConfig } from "../types";
