import { createLogger, SessionUtils } from "@peerbot/core";

const logger = createLogger("dispatcher");

import type {
  QueueProducer,
  ThreadMessagePayload,
  WorkerDeploymentPayload,
} from "@peerbot/gateway/session/queue-producer";
import type { SessionManager } from "@peerbot/gateway/session/session-manager";
import type {
  DispatcherConfig,
  SlackContext,
  ThreadSession,
} from "@peerbot/gateway/types";

export class MessageHandler {
  private readonly SESSION_TTL = 24 * 60 * 60 * 1000; // 24 hours session TTL

  constructor(
    private queueProducer: QueueProducer,
    private config: DispatcherConfig,
    private sessionManager: SessionManager
  ) {}

  /**
   * Get bot ID from configuration
   */
  private getBotId(): string {
    return this.config.slack.botId || "default-slack-bot";
  }

  /**
   * Handle user request by routing to appropriate queue
   */
  async handleUserRequest(
    context: SlackContext,
    userRequest: string,
    client: any
  ): Promise<void> {
    const requestStartTime = Date.now();
    logger.info(
      `[TIMING] handleUserRequest started at: ${new Date(requestStartTime).toISOString()}`
    );
    logger.info(
      `📨 Handling request from user ${context.userId} in thread ${context.threadTs || context.messageTs}`
    );

    // CRITICAL: Always use thread_ts for thread identification
    // For root messages: thread_ts is undefined, so we use message_ts
    // For replies in thread: thread_ts points to the root message
    // This ensures all messages in a thread share the same worker
    const normalizedThreadTs = context.threadTs || context.messageTs;

    // Log for debugging thread routing
    logger.info(
      `Thread routing - messageTs: ${context.messageTs}, threadTs: ${context.threadTs}, normalizedThreadTs: ${normalizedThreadTs}`
    );

    // Generate session key with normalized threadTs - use thread creator as userId for consistency
    const threadCreatorSessionKey = SessionUtils.generateSessionKey({
      platform: "slack",
      channelId: context.channelId,
      userId: context.userId,
      threadTs: normalizedThreadTs,
      messageTs: context.messageTs,
    });

    // Check thread ownership using session manager
    const ownershipCheck = await this.sessionManager.validateThreadOwnership(
      context.channelId,
      normalizedThreadTs,
      context.userId
    );

    if (!ownershipCheck.allowed && ownershipCheck.owner) {
      logger.warn(
        `User ${context.userId} tried to interact with thread owned by ${ownershipCheck.owner}`
      );

      // Send ownership message
      await client.chat.postMessage({
        channel: context.channelId,
        thread_ts: normalizedThreadTs,
        text: `This thread is owned by <@${ownershipCheck.owner}>. Only the thread creator can interact with the bot in this conversation.`,
        mrkdwn: true,
      });

      return;
    }

    // Get existing session if any
    const existingSession = await this.sessionManager.findSessionByThread(
      context.channelId,
      normalizedThreadTs
    );

    const sessionKey = threadCreatorSessionKey;

    logger.info(
      `Handling request for session: ${sessionKey} (threadTs: ${normalizedThreadTs})`
    );

    logger.info(
      `Existing session status for ${sessionKey}: ${existingSession?.status || "none"}`
    );

    try {
      const threadTs = normalizedThreadTs;

      // Create thread session
      const threadSession: ThreadSession = {
        sessionKey,
        threadTs: threadTs,
        channelId: context.channelId,
        userId: context.userId,
        threadCreator: context.userId, // Store the thread creator
        lastActivity: Date.now(),
        status: "pending",
        createdAt: Date.now(),
      };

      await this.sessionManager.setSession(threadSession);

      // Show immediate typing indicator
      await this.setThreadStatus(
        client,
        context.channelId,
        normalizedThreadTs,
        "is thinking..."
      );

      // Determine if this is a new conversation
      const isNewConversation = !context.threadTs || !existingSession;

      if (isNewConversation) {
        const deploymentPayload: WorkerDeploymentPayload = {
          userId: context.userId,
          botId: this.getBotId(),
          threadId: threadTs,
          platform: "slack",
          platformUserId: context.userId,
          messageId: context.messageTs,
          messageText: userRequest,
          channelId: context.channelId,
          platformMetadata: {
            teamId: context.teamId,
            userDisplayName: context.userDisplayName,
            slackResponseChannel: context.channelId,
            slackResponseTs: context.messageTs,
            originalMessageTs: context.messageTs,
            botResponseTs: threadSession.botResponseTs,
          },
          claudeOptions: {
            allowedTools: this.config.claude.allowedTools,
            model: this.config.claude.model,
            timeoutMinutes: this.config.sessionTimeoutMinutes.toString(),
          },
          routingMetadata: {
            targetThreadId: threadTs,
            userId: context.userId,
          },
        };

        const jobId =
          await this.queueProducer.enqueueMessage(deploymentPayload);

        logger.info(
          `Enqueued direct message job ${jobId} for session ${sessionKey}`
        );
        threadSession.status = "pending";
      } else {
        // Enqueue to user-specific queue
        const threadPayload: ThreadMessagePayload = {
          botId: this.getBotId(),
          userId: context.userId,
          threadId: threadTs,
          platform: "slack",
          channelId: context.channelId,
          messageId: context.messageTs,
          messageText: userRequest,
          platformMetadata: {
            teamId: context.teamId,
            userDisplayName: context.userDisplayName,
            slackResponseChannel: context.channelId,
            slackResponseTs: context.messageTs,
            originalMessageTs: context.messageTs,
            botResponseTs: threadSession.botResponseTs,
          },
          claudeOptions: {
            ...this.config.claude,
            timeoutMinutes: this.config.sessionTimeoutMinutes.toString(),
          },
          routingMetadata: {
            targetThreadId: threadTs,
            userId: context.userId,
          },
        };

        const jobId = await this.queueProducer.enqueueMessage(threadPayload);

        logger.info(
          `Enqueued thread message job ${jobId} for thread ${threadTs}`
        );
        threadSession.status = "running";
      }
    } catch (error) {
      logger.error(
        `Failed to handle request for session ${sessionKey}:`,
        error
      );

      // Handle all errors the same way - let the worker decide what to show
      try {
        await this.setThreadStatus(
          client,
          context.channelId,
          normalizedThreadTs,
          "encountered an error"
        );
      } catch (statusError) {
        logger.error("Failed to update error status:", statusError);
      }

      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const errorMsg = `❌ *Error:* ${errorMessage || "Unknown error occurred"}`;

      // Post error message in thread
      const threadTs = context.threadTs || context.messageTs;
      await client.chat.postMessage({
        channel: context.channelId,
        thread_ts: threadTs,
        text: errorMsg,
        mrkdwn: true,
      });

      // Clean up session
      await this.sessionManager.deleteSession(sessionKey);
    }
  }

  /**
   * Extract Slack context from event
   */
  extractSlackContext(event: any): SlackContext {
    return {
      channelId: event.channel,
      userId: event.user,
      teamId: event.team || "",
      threadTs: event.thread_ts,
      messageTs: event.ts,
      text: event.text || "",
      userDisplayName: event.user_profile?.display_name || "Unknown User",
    };
  }

  /**
   * Extract user request from mention text
   */
  extractUserRequest(text: string): string {
    const cleaned = text.replace(/<@[^>]+>/g, "").trim();

    if (!cleaned) {
      return "Hello! How can I help you today?";
    }

    return cleaned;
  }

  /**
   * Check if user is allowed to use the bot
   */
  isUserAllowed(userId: string): boolean {
    const allowedUsers = process.env.ALLOWED_USERS || "";
    if (!allowedUsers) {
      return true; // If no restrictions, allow all
    }

    const userList = allowedUsers.split(",").map((u) => u.trim());
    return userList.includes(userId);
  }

  /**
   * Cleanup expired data from session store
   */
  async cleanupExpiredData(): Promise<void> {
    const deletedCount = await this.sessionManager.cleanupExpired(
      this.SESSION_TTL
    );
    if (deletedCount > 0) {
      logger.info(`Cleanup completed - Deleted ${deletedCount} sessions`);
    }
  }

  /**
   * Update Slack assistant thread status indicator
   */
  private async setThreadStatus(
    client: any,
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

      await client.apiCall("assistant.threads.setStatus", payload);
    } catch (error) {
      logger.warn(
        `Failed to set status '${status || "<clear>"}' for thread ${threadTs}:`,
        error
      );
    }
  }
}
