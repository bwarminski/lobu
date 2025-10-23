#!/usr/bin/env bun

import { createLogger } from "@peerbot/core";
import type {
  SDKMessage,
  SDKAssistantMessage,
} from "@anthropic-ai/claude-agent-sdk";

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
  input?: Record<string, unknown>;
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

  /**
   * Process streaming update and return formatted content for Slack
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
    const nestedMessage = message.message;
    const content = nestedMessage?.content;

    // Handle string content
    if (typeof content === "string" && content.trim()) {
      this.chronologicalOutput += `${content}\n`;
      hasUpdate = true;
    }
    // Handle content blocks (array format)
    else if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type === "text" && block.text?.trim()) {
          this.chronologicalOutput += `${block.text}\n`;
          hasUpdate = true;
        } else if (block.type === "thinking" && block.thinking?.trim()) {
          // Store thinking content - will be shown as status
          this.currentThinking = block.thinking.trim();
          logger.info(
            `💭 Thinking block received (${this.currentThinking.length} chars): ${this.currentThinking.substring(0, 100)}...`
          );
          hasUpdate = true;
        } else if (block.type === "tool_use") {
          // Check for TodoWrite updates
          if (
            block.name === "TodoWrite" &&
            block.input?.todos &&
            Array.isArray(block.input.todos)
          ) {
            // Append task updates as chronological events
            const newTodos = block.input.todos as TodoItem[];

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
            const toolExecution = this.formatToolExecution(block);
            this.chronologicalOutput += `${toolExecution}\n`;
            hasUpdate = true;
          }
        }
      }
    }

    if (!hasUpdate) {
      return null;
    }

    return { text: this.formatFullUpdate(), isFinal: false };
  }

  /**
   * Format tool execution for user-friendly display in bullet lists
   */
  private formatToolExecution(toolUse: ToolUseBlock): string {
    const toolName = toolUse.name;
    const params = toolUse.input || {};

    // Helper to safely get string param
    const getParam = (key: string): string => {
      const value = params[key];
      return typeof value === "string" ? value : String(value || "");
    };

    switch (toolName) {
      case "Write":
        return `└ ✏️ **Writing** \`${getParam("file_path")}\``;
      case "Edit":
        return `└ ✏️ **Editing** \`${getParam("file_path")}\``;
      case "Bash": {
        const command =
          getParam("command") || getParam("description") || "command";
        return `└ 👾 **Running** \`${command.length > 50 ? `${command.substring(0, 50)}...` : command}\``;
      }
      case "Read":
        return `└ 📖 **Reading** \`${getParam("file_path")}\``;
      case "Grep":
        return `└ 🔍 **Searching** \`${getParam("pattern")}\``;
      case "Glob":
        return `└ 🔍 **Finding** \`${getParam("pattern")}\``;
      case "TodoWrite":
        return "└ 📝 Updating task list";
      case "WebFetch":
        return `└ 🌐 **Fetching** \`${getParam("url")}\``;
      case "WebSearch":
        return `└ 🔎 **Searching web** \`${getParam("query")}\``;
      default:
        return `└ 🔧 **Using** ${toolName}`;
    }
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
