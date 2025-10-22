#!/usr/bin/env bun

import { query } from "@anthropic-ai/claude-agent-sdk";
import { createLogger } from "@peerbot/core";
import type {
  ClaudeExecutionOptions,
  ClaudeExecutionResult,
  ProgressCallback,
} from "./executor";

const logger = createLogger("worker-sdk");

/**
 * Map tool names to friendly status messages
 */
function getToolStatus(toolName: string): string {
  const toolStatusMap: Record<string, string> = {
    Bash: "Running command",
    Read: "Reading file",
    Write: "Writing file",
    Edit: "Editing file",
    Grep: "Searching",
    Glob: "Finding files",
    Task: "Launching agent",
    WebFetch: "Fetching web page",
    WebSearch: "Searching web",
    SlashCommand: "Running command",
    AskUserQuestion: "Asking question",
    TodoWrite: "Updating tasks",
  };

  return toolStatusMap[toolName] || `Using ${toolName}`;
}

interface MCPServerConfig {
  type?: "sse" | "stdio";
  url?: string;
  description?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
}

interface MCPConfigResponse {
  mcpServers?: Record<string, MCPServerConfig>;
}

/**
 * Convert gateway MCP config to SDK format
 */
async function getMCPServersForSDK(): Promise<Record<string, any> | undefined> {
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

    // Convert gateway format to SDK format
    const sdkServers: Record<string, any> = {};

    for (const [name, config] of Object.entries(data.mcpServers)) {
      if (config.type === "sse" && config.url) {
        // SSE server
        sdkServers[name] = {
          url: config.url,
        };
      } else if (config.command) {
        // stdio server
        sdkServers[name] = {
          command: config.command,
          args: config.args || [],
          env: config.env || {},
        };
      }
    }

    logger.info(
      `Configured ${Object.keys(sdkServers).length} MCP servers for SDK`
    );
    return Object.keys(sdkServers).length > 0 ? sdkServers : undefined;
  } catch (error) {
    logger.error("Failed to fetch MCP config from gateway", { error });
    return undefined;
  }
}

function ensureBaseUrl(base: string): string {
  if (!base.startsWith("http")) {
    return `http://${base.replace(/^\/+/, "")}`;
  }
  return base;
}

/**
 * Execute Claude session using the SDK
 */
export async function runClaudeWithSDK(
  userPrompt: string,
  options: ClaudeExecutionOptions,
  onProgress?: ProgressCallback,
  workingDirectory?: string
): Promise<ClaudeExecutionResult> {
  logger.info("Starting Claude SDK execution");

  try {
    // Get MCP servers configuration
    const mcpServers = await getMCPServersForSDK();

    // Build SDK options
    const sdkOptions: any = {
      model: options.model,
      workingDirectory: workingDirectory || process.cwd(),
      permissionMode: "bypassPermissions", // Non-interactive mode
      // TODO: Re-enable thinking once we verify SDK version supports it
      // maxThinkingTokens: 5000,
    };

    // Add session management
    if (options.resumeSessionId === "continue") {
      // SDK handles continuation via persistent sessions in workspace
      // Don't need to specify anything - it auto-resumes
      logger.info("Continuing previous session in workspace");
    } else if (options.resumeSessionId) {
      sdkOptions.resume = options.resumeSessionId;
      logger.info(`Resuming session: ${options.resumeSessionId}`);
    } else if (options.sessionId) {
      sdkOptions.sessionId = options.sessionId;
      logger.info(`Creating new session: ${options.sessionId}`);
    }

    // Add system prompts
    if (options.systemPrompt) {
      sdkOptions.systemPrompt = options.systemPrompt;
    }
    if (options.appendSystemPrompt) {
      sdkOptions.appendSystemPrompt = options.appendSystemPrompt;
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

      // Log every message with timing information
      logger.info(
        `SDK message #${messageCount} (${timeSinceLastMessage}ms since last): ${message.type}`,
        {
          messageType: message.type,
          subtype: (message as any).subtype,
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
            sessionId: (message as any).session_id,
          });
          break;

        case "assistant": {
          // SDK wraps content in message.message.content structure
          const assistantMsg = (message as any).message;
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
                  const toolStatus = getToolStatus(block.name);
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
              messageType: typeof (message as any).message,
            });
          }
          break;
        }

        case "result": {
          // Final result message with the complete output
          // Result only exists on success subtype
          const resultMsg = message as any;
          if (resultMsg.subtype === "success" && resultMsg.result) {
            const resultStr = String(resultMsg.result);
            logger.info(
              `SDK result received (${resultStr.length} chars): ${resultStr.substring(0, 200)}`
            );
            output = resultStr;
          } else {
            logger.warn(
              `Result message without success: ${resultMsg.subtype}`,
              {
                subtype: resultMsg.subtype,
                isError: resultMsg.is_error,
              }
            );
          }
          break;
        }

        case "stream_event":
          // Partial messages during streaming
          logger.debug(`Stream event received`);
          break;

        case "user": {
          // User messages contain tool results being sent back to Claude
          // These are handled internally by the SDK, we just log them at debug level
          const userMsg = (message as any).message;
          if (userMsg?.content?.[0]?.type === "tool_result") {
            logger.debug(`Tool result returned to Claude`);
          }
          break;
        }

        default:
          logger.info(`Unhandled SDK message type: ${(message as any).type}`, {
            fullMessage: JSON.stringify(message, null, 2),
          });
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
