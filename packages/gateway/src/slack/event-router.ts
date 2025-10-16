#!/usr/bin/env bun

import { createLogger } from "@peerbot/core";
import type { App } from "@slack/bolt";

const logger = createLogger("slack-events");

import type { IModuleRegistry } from "@peerbot/core";
import type { createMessageQueue } from "@peerbot/core";
import type { QueueProducer } from "../session/queue-producer";
import { RedisSessionStore, SessionManager } from "../session/session-manager";
import type { DispatcherConfig } from "../types";
import { ActionHandler } from "./events/actions";
import { handleBlockkitFormSubmission } from "./events/forms";
import { MessageHandler } from "./events/messages";
import { ShortcutCommandHandler } from "./events/shortcuts";
import { setupTeamJoinHandler } from "./events/welcome";

/**
 * Queue-based Slack event handlers that route messages to appropriate queues
 * This is the main orchestrator that delegates to specialized handlers
 */
export class SlackEventHandlers {
  private messageHandler: MessageHandler;
  private actionHandler: ActionHandler;
  private shortcutCommandHandler: ShortcutCommandHandler;
  private sessionManager: SessionManager;

  constructor(
    private app: App,
    queueProducer: QueueProducer,
    private config: DispatcherConfig,
    private moduleRegistry: IModuleRegistry,
    queue: ReturnType<typeof createMessageQueue>
  ) {
    // Initialize session manager with Redis store using the provided started queue
    const sessionStore = new RedisSessionStore(queue);
    this.sessionManager = new SessionManager(sessionStore);

    // Initialize specialized handlers
    this.messageHandler = new MessageHandler(
      queueProducer,
      config,
      this.sessionManager
    );
    this.actionHandler = new ActionHandler(
      this.messageHandler,
      this.moduleRegistry
    );
    this.shortcutCommandHandler = new ShortcutCommandHandler(app);

    // Setup all event handlers
    this.setupEventHandlers();
  }

  /**
   * Setup all Slack event handlers
   */
  private setupEventHandlers(): void {
    logger.info("Setting up Queue-based Slack event handlers...");

    // Setup message event handlers
    this.app.event("message", async ({ event }) => {
      const messageEvent = event as any;

      // Handle message edits
      if (messageEvent.subtype === "message_changed") {
        logger.info(
          `Message changed: ${JSON.stringify(messageEvent, null, 2)}`
        );
      }

      // Handle message deletions
      if (messageEvent.subtype === "message_deleted") {
        logger.info(
          `Message deleted: ${JSON.stringify(messageEvent, null, 2)}`
        );
      }
    });

    // Setup file event handlers
    this.app.event("file_shared", async ({ event }) => {
      logger.info(`File shared: ${JSON.stringify(event, null, 2)}`);
    });

    this.app.event("file_deleted", async ({ event }) => {
      logger.info(`File deleted: ${JSON.stringify(event, null, 2)}`);
    });

    // Setup user event handlers
    this.app.event("team_join", async ({ event }) => {
      logger.info(`Team join: ${JSON.stringify(event, null, 2)}`);
    });

    this.app.event("presence_change", async ({ event }) => {
      logger.info(`Presence change: ${JSON.stringify(event, null, 2)}`);
    });

    this.app.event("member_joined_channel", async ({ event, client }) => {
      logger.info(`Member joined channel: ${JSON.stringify(event, null, 2)}`);

      try {
        const memberEvent = event as any;

        // Skip if it's a bot joining
        if (memberEvent.user.startsWith("B")) {
          logger.info(`Skipping welcome for bot user: ${memberEvent.user}`);
          return;
        }

        // Check if it's the bot itself joining
        const authResult = await client.auth.test();
        if (memberEvent.user === authResult.user_id) {
          logger.info(`Skipping welcome for bot itself: ${memberEvent.user}`);
          return;
        }

        // Send welcome message
        await this.shortcutCommandHandler.sendContextAwareWelcome(
          memberEvent.user,
          memberEvent.channel,
          client
        );
      } catch (error) {
        logger.error("Failed to send welcome message:", error);
      }
    });

    // Setup team join event handler for welcome messages
    setupTeamJoinHandler(
      this.app,
      (userId: string, channelId: string, client: any, threadTs?: string) =>
        this.shortcutCommandHandler.sendContextAwareWelcome(
          userId,
          channelId,
          client,
          threadTs
        )
    );

    // Setup shortcuts, slash commands, and view submissions
    this.shortcutCommandHandler.setupHandlers();

    // Handle app mentions
    this.setupAppMentionHandler();

    // Handle direct messages
    this.setupDirectMessageHandler();

    // Handle all button/action interactions
    this.setupActionHandler();

    // Handle form submissions
    this.setupFormSubmissionHandler();

    // Handle app home opened event
    this.setupAppHomeHandler();

    logger.info("All Slack event handlers registered successfully");
  }

  /**
   * Handle app mentions in channels
   */
  private setupAppMentionHandler(): void {
    logger.info("Registering app_mention event handler");

    this.app.event("app_mention", async ({ event, client, say }) => {
      // Ignore mentions generated by our own bot only (not other bots)
      const botUserId = this.config.slack.botUserId;
      const botId = this.config.slack.botId;
      const eventAny = event as any;
      const isSelf =
        (botId && eventAny.bot_id && eventAny.bot_id === botId) ||
        (botUserId && eventAny.user === botUserId);
      if (isSelf) {
        logger.debug(
          `Ignoring self-generated app_mention (bot_id=${eventAny.bot_id}, user=${eventAny.user})`
        );
        return;
      }

      logger.info(`App mentioned by ${event.user} in channel ${event.channel}`);

      // Check if user is allowed
      if (!this.messageHandler.isUserAllowed(event.user || "")) {
        logger.warn(`User ${event.user} not in allowed users list`);
        await say({
          text: "Sorry, you don't have permission to use this bot. Please contact your administrator.",
          thread_ts: event.thread_ts || event.ts,
        });
        return;
      }

      // Extract the actual message text (removing the bot mention)
      const userRequest = this.messageHandler.extractUserRequest(event.text);
      const messageText = userRequest.toLowerCase().trim();

      // Check for text commands first (same as DM handler)
      if (
        messageText === "welcome" ||
        messageText === "help" ||
        messageText === "start" ||
        messageText === "onboard"
      ) {
        logger.info(`Handling welcome command via app_mention: ${messageText}`);
        await this.shortcutCommandHandler.handleTextCommand(
          "welcome",
          event.user || "",
          event.channel,
          client,
          event.thread_ts || event.ts
        );
        return;
      }

      // Normal message processing
      const context = this.messageHandler.extractSlackContext(event);
      await this.messageHandler.handleUserRequest(context, userRequest, client);
    });
  }

  /**
   * Handle direct messages to the bot
   */
  private setupDirectMessageHandler(): void {
    logger.info("Registering direct message handler");

    this.app.message(async ({ message, client }) => {
      const event = message as any;

      // Log all message events for debugging
      logger.info(
        `Message event received - channel: ${event.channel}, channel_type: ${event.channel_type}, subtype: ${event.subtype}, user: ${event.user}, thread_ts: ${event.thread_ts}`
      );

      // Handle direct messages - check both channel_type and channel ID pattern
      // DM channels start with 'D' (e.g., D095U1QV667)
      const isDM =
        event.channel_type === "im" ||
        (event.channel &&
          typeof event.channel === "string" &&
          event.channel.startsWith("D"));

      if (!message.subtype && isDM) {
        // Ignore messages generated by our own bot only (not other bots)
        const botUserId = this.config.slack.botUserId;
        const botId = this.config.slack.botId;
        const isSelf =
          (botId && event.bot_id && event.bot_id === botId) ||
          (botUserId && event.user === botUserId);
        if (isSelf) {
          logger.debug(
            `Ignoring self DM message (bot_id=${event.bot_id}, user=${event.user})`
          );
          return;
        }

        logger.info(`Direct message from ${event.user}: ${event.text}`);

        // Check if user is allowed
        if (!this.messageHandler.isUserAllowed(event.user || "")) {
          logger.warn(`User ${event.user} not in allowed users list`);
          await client.chat.postMessage({
            channel: event.channel,
            text: "Sorry, you don't have permission to use this bot. Please contact your administrator.",
            thread_ts: event.thread_ts || event.ts,
          });
          return;
        }

        // Check for text commands first
        const messageText = event.text?.toLowerCase().trim();
        logger.info(`Checking for text command: "${messageText}"`);

        // Handle text commands that mimic slash commands
        if (
          messageText === "welcome" ||
          messageText === "help" ||
          messageText === "start" ||
          messageText === "onboard"
        ) {
          logger.info(`Handling welcome command via text: ${messageText}`);
          // Reuse the slash command handler's welcome functionality
          await this.shortcutCommandHandler.handleTextCommand(
            "welcome",
            event.user,
            event.channel,
            client,
            event.thread_ts || event.ts
          );
          return;
        }

        // Normal message processing
        const context = this.messageHandler.extractSlackContext(event);
        const userRequest = this.messageHandler.extractUserRequest(event.text);

        await this.messageHandler.handleUserRequest(
          context,
          userRequest,
          client
        );
      }
    });
  }

  /**
   * Handle all button and interactive component actions
   */
  private setupActionHandler(): void {
    logger.info(
      "Registering action handler for buttons and interactive components"
    );

    this.app.action(/.*/, async ({ action, ack, client, body }) => {
      await ack();

      const actionId = (action as any).action_id;
      const userId = body.user.id;
      const channelId =
        (body as any).channel?.id || (body as any).container?.channel_id;
      const messageTs = (body as any).message?.ts || "";

      logger.info(`Action received: ${actionId} from user ${userId}`);

      // Delegate to action handler
      await this.actionHandler.handleBlockAction(
        actionId,
        userId,
        channelId,
        messageTs,
        body,
        client
      );
    });
  }

  /**
   * Handle form submission events
   */
  private setupFormSubmissionHandler(): void {
    logger.info("Registering view_submission handler for forms");

    // Register handler for blockkit form modal submissions
    this.app.view(
      "blockkit_form_modal",
      async ({ ack, body, view, client }) => {
        await ack();

        const userId = body.user.id;

        logger.info(
          `Form submission from user ${userId} for blockkit_form_modal`
        );

        await handleBlockkitFormSubmission(
          userId,
          view,
          client,
          async (context: any, userRequest: string, client: any) =>
            this.messageHandler.handleUserRequest(context, userRequest, client)
        );
      }
    );

    // Register handler for MCP input modal submissions
    this.app.view(/^mcp_input_modal_/, async ({ ack, body, view, client }) => {
      await ack();

      const userId = body.user.id;
      const viewId = view.id;
      const callbackId = view.callback_id;
      const privateMetadata = view.private_metadata || "{}";
      const values = view.state.values;

      logger.info(
        `MCP input modal submission from user ${userId} for ${callbackId}`
      );

      // Delegate to modules that handle view submissions
      const dispatcherModules = this.moduleRegistry.getDispatcherModules();
      for (const module of dispatcherModules) {
        if (module.handleViewSubmission) {
          try {
            await module.handleViewSubmission(
              viewId,
              userId,
              values,
              privateMetadata
            );
            logger.info(
              `Module ${module.name} handled view submission ${callbackId}`
            );
          } catch (error) {
            logger.error(
              `Module ${module.name} failed to handle view submission:`,
              error
            );
          }
        }
      }

      // Update app home after successful submission
      await this.actionHandler.updateAppHome(userId, client);
    });
  }

  /**
   * Handle app home opened events
   */
  private setupAppHomeHandler(): void {
    logger.info("Registering app_home_opened event handler");

    this.app.event("app_home_opened", async ({ event, client }) => {
      try {
        if (event.tab === "home") {
          await this.actionHandler.updateAppHome(event.user, client);
        }
      } catch (error) {
        logger.error("Error handling app home opened:", error);
      }
    });
  }

  /**
   * Cleanup method for graceful shutdown
   */
  cleanup(): void {
    logger.info("Cleaning up Slack event handlers");
    this.messageHandler.cleanupExpiredData();
  }
}
