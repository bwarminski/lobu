#!/usr/bin/env bun

import type { IModuleRegistry } from "@peerbot/core";
import {
  createLogger,
  type createMessageQueue,
  type IMessageQueue,
  type IRedisClient,
  RedisClient,
} from "@peerbot/core";
import { WebClient } from "@slack/web-api";
import {
  type ModuleButton,
  SlackBlockBuilder,
} from "../slack/converters/block-builder";
import { extractCodeBlockActions } from "../slack/converters/blockkit";
import { convertMarkdownToSlack } from "../slack/converters/markdown";

const logger = createLogger("dispatcher");

/**
 * Represents a single Slack chatStream session
 */
class StreamSession {
  private stream: any;
  private started: boolean = false;
  private slackClient: WebClient;
  private channelId: string;
  private threadTs: string;
  private userId: string;
  private teamId?: string;

  constructor(
    slackClient: WebClient,
    channelId: string,
    threadTs: string,
    userId: string,
    teamId?: string
  ) {
    this.slackClient = slackClient;
    this.channelId = channelId;
    this.threadTs = threadTs;
    this.userId = userId;
    this.teamId = teamId;
  }

  async appendDelta(
    delta: string,
    isFullReplacement: boolean = false
  ): Promise<void> {
    // If this is a full replacement and we have an active stream, stop it first
    if (isFullReplacement && this.started && this.stream) {
      logger.info(
        `🔄 REPLACING STREAM CONTENT: channel=${this.channelId}, thread=${this.threadTs}`
      );
      await this.stream.stop();
      this.started = false;
      this.stream = null;
    }

    if (!this.started) {
      // Start new stream
      logger.info(
        `🚀 STARTING NEW STREAM: channel=${this.channelId}, thread=${this.threadTs}, deltaLength=${delta.length}`
      );
      this.stream = (this.slackClient as any).chatStream({
        channel: this.channelId,
        thread_ts: this.threadTs,
        recipient_user_id: this.userId,
        markdown_text: delta,
        ...(this.teamId ? { recipient_team_id: this.teamId } : {}),
      });
      this.started = true;
      logger.info(
        `✅ Stream started with initial content (${delta.length} chars)`
      );
    } else {
      // Append to existing stream
      logger.info(
        `➕ APPENDING TO STREAM: channel=${this.channelId}, thread=${this.threadTs}, deltaLength=${delta.length}`
      );
      await this.stream.append({ markdown_text: delta });
      logger.info(`✅ Appended ${delta.length} chars to existing stream`);
    }
  }

  async stop(): Promise<void> {
    if (this.started && this.stream) {
      await this.stream.stop();
      logger.info(
        `Stopped Slack stream for channel ${this.channelId}, thread ${this.threadTs}`
      );
    }
  }

  isStarted(): boolean {
    return this.started;
  }
}

/**
 * Manages all active stream sessions
 */
class StreamSessionManager {
  private sessions = new Map<string, StreamSession>();
  private slackClient: WebClient;

  constructor(slackClient: WebClient) {
    this.slackClient = slackClient;
  }

  async handleDelta(
    sessionId: string,
    channelId: string,
    threadTs: string,
    userId: string,
    delta: string,
    isFullReplacement: boolean = false,
    teamId?: string
  ): Promise<void> {
    let session = this.sessions.get(sessionId);

    if (!session) {
      // Create new session
      session = new StreamSession(
        this.slackClient,
        channelId,
        threadTs,
        userId,
        teamId
      );
      this.sessions.set(sessionId, session);
    }

    await session.appendDelta(delta, isFullReplacement);
  }

  async completeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      await session.stop();
      this.sessions.delete(sessionId);
    }
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }
}

interface ThreadResponsePayload {
  messageId: string;
  channelId: string;
  threadTs: string;
  userId: string;
  teamId?: string; // Slack team/workspace ID for streaming API
  content?: string;
  delta?: string; // Stream delta content
  isStreamDelta?: boolean; // Whether this is a stream delta
  isFullReplacement?: boolean; // Whether the delta is a full content replacement (restart stream)
  finalContent?: string; // Final content when streaming completes
  usedStreaming?: boolean; // Whether streaming was used
  processedMessageIds?: string[];
  reaction?: string;
  error?: string;
  timestamp: number;
  originalMessageTs?: string; // User's original message timestamp for reactions
  moduleData?: Record<string, unknown>; // Generic module data from all modules
  botResponseTs?: string; // Bot's response message timestamp for updates
  claudeSessionId?: string; // Claude session ID for tracking bot messages per session
  statusUpdate?: {
    status: string;
    loadingMessages?: string[];
  };
}

/**
 * Consumer that listens to thread_response queue and updates Slack messages
 * This handles all Slack communication that was previously done by the workerdon
 */
export class ThreadResponseConsumer {
  private queue: IMessageQueue;
  private redis: IRedisClient;
  private slackClient: WebClient;
  private isRunning = false;
  private blockBuilder: SlackBlockBuilder;
  private readonly BOT_MESSAGES_PREFIX = "bot_messages:";
  private moduleRegistry: IModuleRegistry;
  private streamSessionManager: StreamSessionManager;

  constructor(
    queue: ReturnType<typeof createMessageQueue>,
    slackToken: string,
    moduleRegistry: IModuleRegistry
  ) {
    this.queue = queue;
    this.slackClient = new WebClient(slackToken);
    this.blockBuilder = new SlackBlockBuilder();
    this.moduleRegistry = moduleRegistry;
    this.streamSessionManager = new StreamSessionManager(this.slackClient);
    // Get Redis client from queue connection pool (queue must be started)
    this.redis = new RedisClient(this.queue.getRedisClient());
  }

  /**
   * Get bot message timestamp from Redis
   */
  private async getBotMessageTs(sessionKey: string): Promise<string | null> {
    const key = `${this.BOT_MESSAGES_PREFIX}${sessionKey}`;
    return await this.redis.get(key);
  }

  /**
   * Store bot message timestamp in Redis with 24h TTL
   */
  private async setBotMessageTs(
    sessionKey: string,
    botMessageTs: string
  ): Promise<void> {
    const key = `${this.BOT_MESSAGES_PREFIX}${sessionKey}`;
    await this.redis.set(key, botMessageTs, 24 * 60 * 60); // 24 hours
  }

  /**
   * Set thread status using assistant.threads.setStatus API
   */
  private async setThreadStatus(
    channelId: string,
    threadTs: string,
    status?: string,
    loadingMessages?: string[]
  ): Promise<void> {
    if (!threadTs) {
      return;
    }

    try {
      const payload: Record<string, any> = {
        channel_id: channelId,
        thread_ts: threadTs,
        status: status ?? "",
      };

      if (loadingMessages && loadingMessages.length > 0) {
        payload.loading_messages = loadingMessages;
      }

      await this.slackClient.apiCall("assistant.threads.setStatus", payload);
    } catch (error) {
      logger.warn(
        `Failed to set status '${status || "<clear>"}' for thread ${threadTs}:`,
        error
      );
    }
  }

  /**
   * Start consuming thread_response messages
   */
  async start(): Promise<void> {
    try {
      await this.queue.start();

      // Create the thread_response queue if it doesn't exist
      await this.queue.createQueue("thread_response");

      // Register job handler for thread response messages
      await this.queue.work(
        "thread_response",
        this.handleThreadResponse.bind(this)
      );

      this.isRunning = true;
      logger.info("✅ Thread response consumer started");
    } catch (error) {
      logger.error("Failed to start thread response consumer:", error);
      throw error;
    }
  }

  /**
   * Stop the consumer
   */
  async stop(): Promise<void> {
    try {
      this.isRunning = false;
      await this.queue.stop();
      logger.info("✅ Thread response consumer stopped");
    } catch (error) {
      logger.error("Error stopping thread response consumer:", error);
      throw error;
    }
  }

  /**
   * Handle thread response message jobs
   */
  private async handleThreadResponse(job: any): Promise<void> {
    let data;

    try {
      // Handle serialized format from queue (similar to worker queue consumer)
      if (typeof job === "object" && job !== null) {
        const keys = Object.keys(job);
        const numericKeys = keys.filter((key) => !Number.isNaN(Number(key)));

        if (numericKeys.length > 0) {
          // Queue passes jobs as an array, get the first element
          const firstKey = numericKeys[0];
          const firstJob = firstKey ? job[firstKey] : null;

          if (
            typeof firstJob === "object" &&
            firstJob !== null &&
            firstJob.data
          ) {
            // This is the actual job object from the queue
            data = firstJob.data;
            logger.info(
              `📤 AGENT RESPONSE: Processing agent response for user ${data.userId}, thread ${data.threadId || "unknown"}, jobId: ${firstJob.id}`
            );
          } else {
            throw new Error(
              "Invalid job format: expected job object with data field"
            );
          }
        } else {
          // Fallback - might be normal job format
          data = job.data || job;
        }
      } else {
        data = job;
      }

      if (!data || !data.messageId) {
        throw new Error(
          `Invalid thread response data: ${JSON.stringify(data)}`
        );
      }

      logger.info(
        `Processing thread response job for message ${data.messageId}, originalMessageTs: ${data.originalMessageTs}, claudeSessionId: ${data.claudeSessionId}, botResponseTs: ${data.botResponseTs}`
      );

      // Create a session key to track bot messages per conversation
      // Use the claudeSessionId as the primary key when available
      // This ensures all messages from the same worker session update the same bot message
      const sessionKey = data.claudeSessionId
        ? `session:${data.claudeSessionId}`
        : `${data.userId}:${data.originalMessageTs || data.messageId}`;

      logger.info(`Using session key: ${sessionKey}`);

      // Log data fields for debugging
      logger.info(
        `Thread response data fields: ${Object.keys(data).join(", ")}`
      );
      if (data.isStreamDelta) {
        logger.info(
          `Stream delta detected: deltaLength=${data.delta?.length || 0}`
        );
      }

      // Check if we have a bot message for this Claude session
      // First check if the worker provided a bot message timestamp, then check Redis
      const redisBotMessageTs = await this.getBotMessageTs(sessionKey);
      const existingBotMessageTs = data.botResponseTs || redisBotMessageTs;
      const isFirstResponse = !existingBotMessageTs;

      // Handle streaming delta FIRST before status updates
      // This is critical because setThreadStatus interferes with chatStream
      if (data.isStreamDelta && data.delta) {
        logger.info(
          `Processing stream delta length=${data.delta.length} for session ${sessionKey}, isFullReplacement=${data.isFullReplacement || false}`
        );

        await this.streamSessionManager.handleDelta(
          sessionKey,
          data.channelId,
          data.threadTs,
          data.userId,
          data.delta,
          data.isFullReplacement || false,
          data.teamId
        );
        // Don't set status when streaming - it interferes with chatStream
        return;
      }

      // Apply status update if provided (only when NOT streaming)
      if (data.statusUpdate) {
        logger.info(
          `Setting thread status to: "${data.statusUpdate.status}" for thread ${data.threadTs}`
        );
        await this.setThreadStatus(
          data.channelId,
          data.threadTs,
          data.statusUpdate.status,
          data.statusUpdate.loadingMessages
        );
      }

      // Handle message content
      if (data.content) {
        // Pass the existing bot message timestamp if we have one
        const botMessageTs = existingBotMessageTs || data.botResponseTs;
        const newBotResponseTs = await this.handleMessageUpdate(
          data,
          isFirstResponse,
          botMessageTs
        );

        // Store the bot response timestamp in Redis for future updates
        if (isFirstResponse && newBotResponseTs) {
          logger.info(
            `Bot created first response with ts: ${newBotResponseTs}, storing for session ${sessionKey}`
          );
          await this.setBotMessageTs(sessionKey, newBotResponseTs);

          // Also send the bot message timestamp back to the worker for future updates
          // This ensures the worker can include it in subsequent thread_response messages
          try {
            if (data.claudeSessionId) {
              await this.queue.send("worker_metadata_update", {
                claudeSessionId: data.claudeSessionId,
                botResponseTs: newBotResponseTs,
                channelId: data.channelId,
                threadTs: data.threadTs,
              });
            }
          } catch (error) {
            logger.debug(
              `Failed to send bot message timestamp to worker: ${error}`
            );
          }
        }
      } else if (data.error) {
        // Pass the existing bot message timestamp for error updates
        const botMessageTs = existingBotMessageTs || data.botResponseTs;
        await this.handleError(data, isFirstResponse, botMessageTs);
      }

      // Log completion when processedMessageIds is present but DON'T clear session
      // Keep the session active so any late-arriving messages still update the same bot message
      if (
        Array.isArray(data.processedMessageIds) &&
        data.processedMessageIds.length > 0
      ) {
        logger.info(
          `Thread processing completed for message ${data.messageId}`
        );

        // Complete active streaming session if one exists
        const hasActiveStream =
          this.streamSessionManager.hasSession(sessionKey);
        if (hasActiveStream) {
          logger.info(`Completing active stream for session ${sessionKey}`);
          await this.streamSessionManager.completeSession(sessionKey);
          // Don't set status - streaming completion handles it
        } else {
          // Clear status for non-streaming completion
          await this.setThreadStatus(data.channelId, data.threadTs, "");

          if (data.finalContent) {
            // No streaming or stream wasn't active - post content directly
            logger.info(
              `Posting final content directly (${data.finalContent.length} chars) - usedStreaming: ${data.usedStreaming}, hasActiveStream: ${hasActiveStream}`
            );
            const botMessageTs = existingBotMessageTs || data.botResponseTs;
            await this.handleMessageUpdate(
              { ...data, content: data.finalContent },
              isFirstResponse,
              botMessageTs
            );
          }
        }

        // Don't clear the session here - it will be cleared when a new user message arrives
        // This prevents duplicate bot messages if the worker sends more messages after completion
      }
    } catch (error: any) {
      // Check if it's a validation error that shouldn't be retried
      if (
        error?.data?.error === "invalid_blocks" ||
        error?.data?.error === "msg_too_long" ||
        error?.code === "slack_webapi_platform_error"
      ) {
        logger.error(
          `Slack validation error in job ${job.id}: ${error?.data?.error || error.message}`
        );

        // Try to inform the user about the validation error
        if (data?.channelId && data.messageId) {
          try {
            await this.slackClient.chat.update({
              channel: data.channelId,
              ts: data.messageId,
              text: `❌ **Message update failed**\n\n**Error:** ${error?.data?.error || error.message}\n\nThe response may contain invalid formatting or be too long for Slack.`,
            });
            logger.info(
              `Notified user about validation error in job ${job.id}`
            );
          } catch (notifyError) {
            logger.error(
              `Failed to notify user about validation error: ${notifyError}`
            );
          }
        }

        // Don't throw - mark job as complete to prevent retry loops
        return;
      }

      logger.error(`Failed to process thread response job ${job.id}:`, error);
      throw error; // Let the queue handle retry logic for other errors
    }
  }

  /**
   * Handle message content updates
   */
  private async handleMessageUpdate(
    data: ThreadResponsePayload,
    isFirstResponse: boolean,
    botMessageTs?: string
  ): Promise<string | undefined> {
    const { content, channelId, threadTs, userId } = data;

    if (!content) return;

    try {
      let truncatedText: string;
      let blocks: any[];

      // Check if content is JSON with blocks (from authentication prompt)
      try {
        const parsed = JSON.parse(content);
        if (parsed.blocks && Array.isArray(parsed.blocks)) {
          // Content is already formatted blocks from the worker
          logger.debug(
            `[DEBUG] Content is pre-formatted blocks - blocks count: ${parsed.blocks.length}`
          );
          truncatedText =
            parsed.blocks[0]?.text?.text || "Authentication required";
          blocks = parsed.blocks;
        } else {
          throw new Error("Not blocks format");
        }
      } catch {
        // Not JSON or not blocks format - process as markdown
        logger.debug(
          `[DEBUG] Processing content for Slack - content length: ${content?.length || 0}`
        );

        // Extract code block actions and process markdown
        const { processedContent, actionButtons: codeBlockButtons } =
          extractCodeBlockActions(content);
        const text = convertMarkdownToSlack(processedContent);

        logger.debug(
          `[DEBUG] Extracted ${codeBlockButtons.length} code block action buttons`
        );

        // Get action buttons from modules
        const moduleButtons = await this.getModuleActionButtons(
          userId,
          data.channelId,
          data.threadTs,
          data.moduleData
        );

        // Combine all action buttons
        const allActionButtons = [...codeBlockButtons, ...moduleButtons];

        // Use block builder to create proper blocks with validation
        const result = this.blockBuilder.buildBlocks(text, {
          actionButtons: allActionButtons,
          includeActionButtons: true,
        });

        truncatedText = result.text;
        blocks = result.blocks;
      }
      logger.debug(
        `[DEBUG] Final blocks to send - count: ${blocks.length}, types: ${blocks.map((b: any) => b.type).join(", ")}`
      );
      if (blocks.some((b: any) => b.type === "actions")) {
        logger.debug(
          `[DEBUG] Actions block elements:`,
          blocks.find((b: any) => b.type === "actions")?.elements
        );
      }

      if (isFirstResponse) {
        // Create new message for first response
        logger.info(
          `Creating new bot message in channel ${channelId}, thread ${threadTs}`
        );
        const postResult = await this.slackClient.chat.postMessage({
          channel: channelId,
          thread_ts: threadTs,
          text: truncatedText,
          mrkdwn: true,
          blocks: blocks,
          unfurl_links: true,
          unfurl_media: true,
        });

        logger.info(
          `Bot message created: ${postResult.ok}, ts: ${postResult.ts}`
        );

        if (!postResult.ok) {
          logger.error(`Failed to create bot message: ${postResult.error}`);
          return;
        }

        // CRITICAL: Validate that Slack created the message in the correct thread
        const returnedTs = postResult.ts as string;
        const returnedThreadTs =
          (postResult.message as any)?.thread_ts || returnedTs;

        // Check if the message was created in the intended thread
        if (threadTs && returnedThreadTs !== threadTs) {
          // Delete the wrongly placed message
          try {
            await this.slackClient.chat.delete({
              channel: channelId,
              ts: returnedTs,
            });
            logger.info(`Deleted misplaced message ${returnedTs}`);
          } catch (deleteError) {
            logger.error(`Failed to delete misplaced message:`, deleteError);
          }

          // Retry with explicit thread creation
          await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait 1 second

          const retryResult = await this.slackClient.chat.postMessage({
            channel: channelId,
            thread_ts: threadTs,
            text: truncatedText,
            mrkdwn: true,
            blocks: blocks,
            unfurl_links: true,
            unfurl_media: true,
            reply_broadcast: false, // Ensure it stays in thread
          });

          if (!retryResult.ok) {
            throw new Error(
              `Failed to create bot message after retry: ${retryResult.error}`
            );
          }

          return retryResult.ts as string;
        }

        return returnedTs; // Return the new message timestamp
      } else {
        // Update existing message - use the passed botMessageTs or fallback
        const botTs = botMessageTs || data.botResponseTs || threadTs;
        logger.info(
          `Updating bot message in channel ${channelId}, ts ${botTs}`
        );

        const updateResult = await this.slackClient.chat.update({
          channel: channelId,
          ts: botTs,
          text: truncatedText,
          blocks: blocks,
        });

        logger.info(`Slack update result: ${updateResult.ok}`);

        if (!updateResult.ok) {
          logger.error(`Slack update failed with error: ${updateResult.error}`);
        }
      }
    } catch (error: any) {
      // Handle specific Slack errors
      if (error.code === "message_not_found") {
        logger.error("Slack message not found - it may have been deleted");
      } else if (error.code === "channel_not_found") {
        logger.error("Slack channel not found - bot may not have access");
      } else if (error.code === "not_in_channel") {
        logger.error("Bot is not in the channel");
      } else if (
        error.data?.error === "invalid_blocks" ||
        error.data?.error === "msg_too_long"
      ) {
        // These are Slack validation errors - retrying won't help
        logger.error(`Slack validation error: ${JSON.stringify(error)}`);

        // Try to send a simple error message with raw content for recovery
        try {
          // Truncate content to fit in code block (leave room for error message + code block formatting)
          const maxContentLength = 2500; // Conservative limit
          const truncatedContent =
            content.length > maxContentLength
              ? `${content.substring(0, maxContentLength)}\n...[truncated]`
              : content;

          const errorMessage = `❌ *Error occurred while updating message*\n\n*Error:* ${error.data?.error || ""}${error.message || ""}\n\nThe response may be too long or contain invalid formatting.\n\n*Raw Content:*\n\`\`\`\n${truncatedContent}\n\`\`\``;

          await this.slackClient.chat.update({
            channel: channelId,
            ts: threadTs,
            text: errorMessage,
          });
          logger.info(
            `Sent fallback error message with raw content for validation error: ${error.data?.error}`
          );
        } catch (fallbackError) {
          logger.error("Failed to send fallback error message:", fallbackError);
          // If even the fallback fails, try a minimal message
          try {
            await this.slackClient.chat.update({
              channel: channelId,
              ts: threadTs,
              text: `❌ *Error occurred while updating message*\n\n*Error:* ${error.data?.error || error.message}`,
            });
          } catch (minimalError) {
            logger.error("Failed to send minimal error message:", minimalError);
          }
        }
        // Don't throw - this prevents retry loops for validation errors
      } else {
        logger.error(`Failed to update Slack message: ${error.message}`);
        throw error;
      }
    }
  }

  /**
   * Handle error messages
   */
  private async handleError(
    data: ThreadResponsePayload,
    isFirstResponse: boolean,
    botMessageTs?: string
  ): Promise<void> {
    const { error, channelId, threadTs, userId } = data;

    if (!error) return;

    try {
      logger.info(
        `Sending error message to channel ${channelId}, thread ${threadTs}`
      );

      // Get action buttons from modules
      const actionButtons = await this.getModuleActionButtons(
        userId,
        data.channelId,
        data.threadTs,
        data.moduleData
      );

      // Use block builder for error blocks
      const errorResult = this.blockBuilder.buildErrorBlocks(
        error,
        actionButtons
      );

      if (isFirstResponse) {
        // Create new error message
        const postResult = await this.slackClient.chat.postMessage({
          channel: channelId,
          thread_ts: threadTs,
          text: errorResult.text,
          mrkdwn: true,
          blocks: errorResult.blocks,
          unfurl_links: true,
          unfurl_media: true,
        });
        logger.info(`Error message created: ${postResult.ok}`);
      } else {
        // Update existing message with error - use the passed botMessageTs or fallback
        const botTs = botMessageTs || data.botResponseTs || threadTs;
        const updateResult = await this.slackClient.chat.update({
          channel: channelId,
          ts: botTs,
          text: errorResult.text,
          blocks: errorResult.blocks,
        });
        logger.info(`Error message update result: ${updateResult.ok}`);
      }
    } catch (updateError: any) {
      logger.error(
        `Failed to send error message to Slack: ${updateError.message}`
      );
      throw updateError;
    }
  }

  /**
   * Get action buttons from all registered modules
   * Extracted to deduplicate code between message and error handling
   */
  private async getModuleActionButtons(
    userId: string,
    channelId: string,
    threadTs: string,
    moduleData?: Record<string, unknown>
  ): Promise<ModuleButton[]> {
    const actionButtons: ModuleButton[] = [];
    const dispatcherModules = this.moduleRegistry.getDispatcherModules();

    for (const module of dispatcherModules) {
      try {
        const moduleButtons = await module.generateActionButtons({
          userId,
          channelId,
          threadTs,
          slackClient: this.slackClient,
          moduleData: moduleData?.[module.name],
        });

        // Validate and convert buttons
        for (const btn of moduleButtons) {
          if (!btn.text || !btn.action_id) {
            logger.warn(
              `Invalid button from module ${module.name}: missing text or action_id`,
              btn
            );
            continue;
          }

          actionButtons.push({
            text: btn.text,
            action_id: btn.action_id,
            style: btn.style,
            value: btn.value,
          });
        }
      } catch (error) {
        logger.error(
          `Failed to get action buttons from module ${module.name}:`,
          error
        );
      }
    }

    return actionButtons;
  }

  /**
   * Check if consumer is running and healthy
   */
  isHealthy(): boolean {
    return this.isRunning;
  }

  /**
   * Get current status
   */
  getStatus(): {
    isRunning: boolean;
  } {
    return {
      isRunning: this.isRunning,
    };
  }
}

// Export functions for backward compatibility
export { convertMarkdownToSlack };
