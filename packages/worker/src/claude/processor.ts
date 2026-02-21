#!/usr/bin/env bun

import type {
  SDKAssistantMessage,
  SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { createLogger } from "@lobu/core";
import { formatToolExecution } from "../shared/processor-utils";

const logger = createLogger("claude-processor");

// ============================================================================
// PROGRESS PROCESSOR
// ============================================================================

interface TodoItem {
  content: string;
  status: "pending" | "in_progress" | "completed";
  activeForm: string;
}

interface ToolUseBlock {
  name: string;
  input?: unknown;
}

/**
 * Processes Claude SDK streaming updates and extracts user-friendly content
 * Implements chronological display with task progress and mixed text/tool output
 */
export class ProgressProcessor {
  private currentTodos: TodoItem[] = [];
  private currentThinking: string = "";
  private chronologicalOutput: string = "";
  private lastSentContent: string = "";
  private verboseLogging: boolean = false;
  // Maximum size for chronologicalOutput to prevent memory pressure on long sessions
  private static readonly MAX_OUTPUT_SIZE = 512 * 1024; // 512KB

  /**
   * Enable or disable verbose logging mode.
   * When enabled, shows tool calls, reasoning tokens, and detailed output.
   */
  setVerboseLogging(enabled: boolean): void {
    this.verboseLogging = enabled;
    logger.info(`Verbose logging ${enabled ? "enabled" : "disabled"}`);
  }

  /**
   * Process streaming update and return formatted content
   * Always returns { text: string, isFinal: boolean } or null
   * Now handles SDK message format directly
   */
  processUpdate(data: SDKMessage): { text: string; isFinal: boolean } | null {
    try {
      // Skip if no data
      if (!data || typeof data !== "object") {
        return null;
      }

      // Handle SDK message types
      switch (data.type) {
        case "assistant":
          return this.processAssistantMessage(data);

        case "result":
          // Final result from SDK - send as safety net with isFinal flag
          if (data.subtype === "success" && "result" in data) {
            const resultText = String(data.result).trim();
            const accumulatedText = this.chronologicalOutput.trim();

            logger.info(`Result message length: ${resultText.length} chars`);
            logger.info(`Accumulated length: ${accumulatedText.length} chars`);
            logger.info(`Result starts with: ${resultText.substring(0, 100)}`);
            logger.info(
              `Accumulated starts with: ${accumulatedText.substring(0, 100)}`
            );

            // Check if result contains content not in accumulated
            if (!accumulatedText.includes(resultText.substring(0, 50))) {
              logger.warn(
                `⚠️  Result contains different content than accumulated text!`
              );
              logger.warn(`Result preview: ${resultText.substring(0, 200)}`);
            }

            // Return final result with isFinal flag - gateway will deduplicate
            return { text: resultText, isFinal: true };
          }
          return null;

        case "system":
          // Skip system messages (init, completion, etc.)
          return null;

        case "stream_event":
          // Skip stream events
          return null;

        case "user":
          // Skip user messages
          return null;

        default:
          // Unknown message type - skip
          return null;
      }
    } catch (error) {
      logger.error("Failed to process progress update:", error);
      return null;
    }
  }

  /**
   * Process SDK assistant messages
   * SDK wraps content in message.message.content structure
   */
  private processAssistantMessage(
    message: SDKAssistantMessage
  ): { text: string; isFinal: boolean } | null {
    let hasUpdate = false;

    // SDK format: message.message.content (nested)
    const nestedMessage = (message as { message?: { content?: unknown } })
      .message;
    const content: unknown = nestedMessage?.content;

    // Handle string content
    if (typeof content === "string" && content.trim()) {
      this.chronologicalOutput += `${content}\n`;
      hasUpdate = true;
    }
    // Handle content blocks (array format)
    else if (Array.isArray(content)) {
      for (const entry of content) {
        if (!entry || typeof entry !== "object") {
          continue;
        }

        const block = entry as {
          type?: string;
          text?: string;
          thinking?: string;
          name?: string;
          input?: unknown;
        };

        if (
          block.type === "text" &&
          typeof block.text === "string" &&
          block.text.trim()
        ) {
          this.chronologicalOutput += `${block.text}\n`;
          hasUpdate = true;
        } else if (
          block.type === "thinking" &&
          typeof block.thinking === "string" &&
          block.thinking.trim()
        ) {
          // Store thinking content
          this.currentThinking = block.thinking.trim();
          logger.info(
            `💭 Thinking block received (${this.currentThinking.length} chars): ${this.currentThinking.substring(0, 100)}...`
          );
          // In verbose mode, output thinking blocks
          if (this.verboseLogging) {
            this.chronologicalOutput += `\n💭 *Reasoning:*\n${this.currentThinking}\n\n`;
          }
          hasUpdate = true;
        } else if (
          block.type === "tool_use" &&
          typeof block.name === "string"
        ) {
          // Check for TodoWrite updates
          const toolInput =
            block.input && typeof block.input === "object"
              ? (block.input as { todos?: unknown })
              : undefined;
          if (
            block.name === "TodoWrite" &&
            toolInput?.todos &&
            Array.isArray(toolInput.todos)
          ) {
            // Append task updates as chronological events
            const newTodos = toolInput.todos as TodoItem[];

            newTodos.forEach((newTodo, index) => {
              const oldTodo = this.currentTodos[index];

              if (!oldTodo) {
                // New task created
                this.chronologicalOutput += `📝 ${newTodo.content}\n`;
              } else if (oldTodo.status !== newTodo.status) {
                // Task status changed
                if (newTodo.status === "in_progress") {
                  this.chronologicalOutput += `🪚 *${newTodo.activeForm}*\n`;
                } else if (newTodo.status === "completed") {
                  this.chronologicalOutput += `☑️ ${newTodo.content}\n`;
                }
              }
            });

            this.currentTodos = newTodos;
            hasUpdate = true;
          } else {
            // Format and append non-TodoWrite tool execution
            const toolExecution = this.formatToolExecution(
              block as ToolUseBlock
            );
            if (toolExecution) {
              this.chronologicalOutput += `${toolExecution}\n`;
              hasUpdate = true;
            }
          }
        }
      }
    }

    if (!hasUpdate) {
      return null;
    }

    // Trim chronologicalOutput if it exceeds max size to prevent memory pressure
    if (this.chronologicalOutput.length > ProgressProcessor.MAX_OUTPUT_SIZE) {
      // Keep the last portion after trimming, preserving the most recent context
      const keepFrom =
        this.chronologicalOutput.length -
        ProgressProcessor.MAX_OUTPUT_SIZE * 0.75;
      // Find the next newline to avoid cutting mid-line
      const nextNewline = this.chronologicalOutput.indexOf("\n", keepFrom);
      const cutPoint = nextNewline > 0 ? nextNewline + 1 : Math.floor(keepFrom);
      this.chronologicalOutput = this.chronologicalOutput.slice(cutPoint);
      // Reset lastSentContent since we truncated the beginning
      this.lastSentContent = "";
      logger.info(
        `Trimmed chronologicalOutput to ${this.chronologicalOutput.length} chars`
      );
    }

    return { text: this.formatFullUpdate(), isFinal: false };
  }

  /**
   * Format tool execution for user-friendly display in bullet lists
   */
  private formatToolExecution(toolUse: ToolUseBlock): string {
    const toolName = toolUse.name;
    const params =
      toolUse.input && typeof toolUse.input === "object"
        ? (toolUse.input as Record<string, unknown>)
        : {};

    // Hide system tools (mcp__lobu__*) unless in verbose mode
    if (toolName.startsWith("mcp__lobu__") && !this.verboseLogging) {
      return "";
    }

    return formatToolExecution(toolName, params, this.verboseLogging);
  }

  /**
   * Format full update with chronological output only (tasks are appended as events)
   */
  private formatFullUpdate(): string {
    // Return only chronological output - tasks are added as events during processing
    return this.chronologicalOutput.trim();
  }

  /**
   * Get delta since last sent content
   * Returns null if no new content
   * All content is append-only now (including task updates)
   */
  getDelta(): string | null {
    const fullContent = this.formatFullUpdate();

    // No content to send
    if (!fullContent) {
      return null;
    }

    // No changes since last send
    if (fullContent === this.lastSentContent) {
      return null;
    }

    // Content should always be append-only now
    if (this.lastSentContent && fullContent.startsWith(this.lastSentContent)) {
      // Only new content was appended
      const delta = fullContent.slice(this.lastSentContent.length);
      this.lastSentContent = fullContent;
      return delta;
    }

    // First send or something unexpected happened - send full content
    this.lastSentContent = fullContent;
    return fullContent;
  }

  /**
   * Store final result for later processing
   */
  private finalResult: { text: string; isFinal: boolean } | null = null;

  /**
   * Set the final result from processUpdate
   */
  setFinalResult(result: { text: string; isFinal: boolean }): void {
    this.finalResult = result;
  }

  /**
   * Get and clear the final result
   */
  getFinalResult(): { text: string; isFinal: boolean } | null {
    const result = this.finalResult;
    this.finalResult = null;
    return result;
  }

  /**
   * Get current thinking content
   */
  getCurrentThinking(): string | null {
    return this.currentThinking || null;
  }

  /**
   * Reset state for new message
   */
  reset(): void {
    this.lastSentContent = "";
    this.chronologicalOutput = "";
    this.currentTodos = [];
    this.currentThinking = "";
  }
}
