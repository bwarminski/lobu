/**
 * WhatsApp platform adapter implementing PlatformAdapter interface.
 */

import {
  createLogger,
  type UserInteraction,
  type UserSuggestion,
} from "@peerbot/core";
import { platformAuthRegistry } from "../auth/platform-auth";
import type { CoreServices, PlatformAdapter } from "../platform";
import type { IFileHandler } from "../platform/file-handler";
import {
  type AgentOptions as FactoryAgentOptions,
  type PlatformConfigs,
  type PlatformFactory,
  platformFactoryRegistry,
} from "../platform/platform-factory";
import type { ResponseRenderer } from "../platform/response-renderer";
import { resolveSpace } from "../spaces";
import { WhatsAppAuthAdapter } from "./auth-adapter";
import type { WhatsAppConfig } from "./config";
import { BaileysClient } from "./connection/baileys-client";
import { WhatsAppMessageHandler } from "./events/message-handler";
import { WhatsAppFileHandler } from "./file-handler";
import { WhatsAppInteractionRenderer } from "./interactions";
import { WhatsAppResponseRenderer } from "./response-renderer";
import { jidToE164 } from "./types";

const logger = createLogger("whatsapp-platform");

export interface WhatsAppPlatformConfig {
  whatsapp: WhatsAppConfig;
}

export interface AgentOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  allowedTools?: string[];
  disallowedTools?: string[];
  timeoutMinutes?: number;
}

/**
 * WhatsApp platform adapter.
 * Handles all WhatsApp-specific functionality using Baileys.
 */
export class WhatsAppPlatform implements PlatformAdapter {
  readonly name = "whatsapp";

  private client!: BaileysClient;
  private services!: CoreServices;
  private messageHandler?: WhatsAppMessageHandler;
  private responseRenderer?: WhatsAppResponseRenderer;
  private interactionRenderer?: WhatsAppInteractionRenderer;
  private authAdapter?: WhatsAppAuthAdapter;
  private fileHandler?: WhatsAppFileHandler;

  constructor(
    private readonly config: WhatsAppPlatformConfig,
    private readonly agentOptions: AgentOptions,
    private readonly sessionTimeoutMinutes: number
  ) {}

  /**
   * Initialize with core services.
   */
  async initialize(services: CoreServices): Promise<void> {
    logger.info("Initializing WhatsApp platform...");
    this.services = services;

    // Create Baileys client
    this.client = new BaileysClient(this.config.whatsapp);

    // Create file handler for media
    this.fileHandler = new WhatsAppFileHandler(this.client);

    // Create message handler
    this.messageHandler = new WhatsAppMessageHandler(
      this.client,
      this.config.whatsapp,
      services.getQueueProducer(),
      services.getSessionManager(),
      this.agentOptions
    );

    // Connect file handler to message handler
    this.messageHandler.setFileHandler(this.fileHandler);

    // Create response renderer for unified thread consumer
    this.responseRenderer = new WhatsAppResponseRenderer(
      this.client,
      this.config.whatsapp
    );

    // Wire up conversation history tracking
    this.responseRenderer.setStoreOutgoingCallback((chatJid, text) => {
      this.messageHandler?.storeOutgoingMessage(chatJid, text);
    });

    // Create interaction renderer
    this.interactionRenderer = new WhatsAppInteractionRenderer(
      this.client,
      services.getInteractionService(),
      this.config.whatsapp
    );

    // Register beforeCreate hook to stop streams before interaction
    const interactionService = services.getInteractionService();
    interactionService.setBeforeCreateHook(
      async (userId: string, threadId: string) => {
        logger.info({ userId, threadId }, "Stopping stream before interaction");
        // WhatsApp doesn't have streaming, so this is a no-op
      }
    );

    // Register interaction button handler
    this.interactionRenderer.registerButtonHandler();

    // Create and register auth adapter
    const stateStore = services.getClaudeOAuthStateStore();
    const publicGatewayUrl = services.getPublicGatewayUrl();
    if (stateStore) {
      this.authAdapter = new WhatsAppAuthAdapter(
        this.client,
        stateStore,
        publicGatewayUrl
      );
      platformAuthRegistry.register("whatsapp", this.authAdapter);

      // Connect auth adapter to message handler for auth response handling
      if (this.messageHandler) {
        this.messageHandler.setAuthAdapter(this.authAdapter);
      }

      logger.info("WhatsApp auth adapter registered");
    }

    logger.info("WhatsApp platform initialized");
  }

  /**
   * Get the auth adapter for handling auth responses.
   */
  getAuthAdapter(): WhatsAppAuthAdapter | undefined {
    return this.authAdapter;
  }

  /**
   * Get the file handler for media operations.
   */
  getFileHandler(): IFileHandler | undefined {
    return this.fileHandler;
  }

  /**
   * Start the platform (connect to WhatsApp).
   */
  async start(): Promise<void> {
    logger.info("Starting WhatsApp platform...");

    // Setup message handler BEFORE connecting (to catch early messages)
    if (this.messageHandler) {
      this.messageHandler.start();
    }

    // Connect to WhatsApp
    await this.client.connect();

    logger.info("WhatsApp platform started");
  }

  /**
   * Stop the platform gracefully.
   */
  async stop(): Promise<void> {
    logger.info("Stopping WhatsApp platform...");

    // Stop message handler
    if (this.messageHandler) {
      this.messageHandler.stop();
    }

    // Disconnect from WhatsApp
    await this.client.disconnect();

    logger.info("WhatsApp platform stopped");
  }

  /**
   * Check if platform is healthy.
   */
  isHealthy(): boolean {
    return this.client?.isConnected() ?? false;
  }

  /**
   * Get the response renderer for unified thread consumer.
   */
  getResponseRenderer(): ResponseRenderer | undefined {
    return this.responseRenderer;
  }

  /**
   * Build platform-specific deployment metadata.
   */
  buildDeploymentMetadata(
    threadId: string,
    channelId: string,
    platformMetadata: Record<string, any>
  ): Record<string, string> {
    const jid = platformMetadata?.jid || channelId;
    const e164 = jidToE164(jid) || jid;

    return {
      chat_id: jid,
      phone_number: e164,
      thread_id: threadId,
      is_group: String(platformMetadata?.isGroup || false),
    };
  }

  /**
   * Render a blocking user interaction.
   */
  async renderInteraction(interaction: UserInteraction): Promise<void> {
    if (this.interactionRenderer) {
      await this.interactionRenderer.renderInteraction(interaction);
    }
  }

  /**
   * Render non-blocking suggestions.
   * WhatsApp doesn't have native suggested prompts, so we send as regular message.
   */
  async renderSuggestion(suggestion: UserSuggestion): Promise<void> {
    if (this.interactionRenderer) {
      await this.interactionRenderer.renderSuggestion(suggestion);
    }
  }

  /**
   * Set thread status indicator.
   * WhatsApp uses typing indicator instead.
   */
  async setThreadStatus(
    channelId: string,
    _threadId: string, // Not used for WhatsApp
    status: string | null
  ): Promise<void> {
    if (status && this.client) {
      // Show typing indicator
      await this.client.sendTyping(
        channelId,
        this.config.whatsapp.typingTimeout
      );
    }
    // Clear status is a no-op - typing auto-expires
  }

  /**
   * Check if token matches platform credentials.
   * WhatsApp doesn't use tokens in the same way.
   */
  isOwnBotToken(_token: string): boolean {
    // We don't have a simple token to compare
    return false;
  }

  /**
   * Send a message for testing/automation.
   * If sending to self (self-chat mode), queues message directly to worker.
   */
  async sendMessage(
    _token: string, // Not used for WhatsApp
    channel: string,
    message: string,
    options?: {
      threadId?: string;
      files?: Array<{ buffer: Buffer; filename: string }>;
    }
  ): Promise<{
    channel: string;
    messageId: string;
    threadId: string;
    threadUrl?: string;
    queued?: boolean;
  }> {
    if (!this.client?.isConnected()) {
      throw new Error("WhatsApp not connected");
    }

    // Replace @me with nothing (WhatsApp doesn't have bot mentions)
    const cleanMessage = message.replace(/@me\s*/g, "").trim();

    // Check if this is a self-chat message (sending to bot's own number)
    const selfE164 = this.client.getSelfE164();
    const normalizedChannel = channel.startsWith("+") ? channel : `+${channel}`;
    const isSelfMessage =
      this.config.whatsapp.selfChatEnabled && normalizedChannel === selfE164;

    // Send the actual WhatsApp message
    const result = await this.client.sendMessage(channel, {
      text: cleanMessage,
    });

    // If self-chat, queue the message directly to bypass event handler filter
    if (isSelfMessage) {
      const queueProducer = this.services.getQueueProducer();
      const messageId = result.messageId;
      const threadId = options?.threadId || messageId;

      // Use TEST_USER_ID if available, otherwise use bot's number
      const testUserId = process.env.TEST_USER_ID || selfE164 || channel;

      // Resolve spaceId for multi-tenant isolation (DM context for self-chat)
      const { spaceId } = resolveSpace({
        platform: "whatsapp",
        userId: testUserId,
        channelId: channel,
        isGroup: false,
      });

      const payload = {
        userId: testUserId,
        threadId,
        messageId,
        channelId: channel,
        teamId: "whatsapp",
        spaceId,
        botId: selfE164 || "whatsapp-bot",
        platform: "whatsapp",
        messageText: cleanMessage,
        platformMetadata: {
          remoteJid: `${channel.replace("+", "")}@s.whatsapp.net`,
          isSelfChat: true,
          isFromMe: false, // Pretend it's from user for processing
        },
        agentOptions: {
          ...this.agentOptions,
          timeoutMinutes: this.sessionTimeoutMinutes.toString(),
        },
      };

      await queueProducer.enqueueMessage(payload);
      logger.info(`Queued self-chat message ${messageId} to worker queue`);

      return {
        channel,
        messageId,
        threadId,
        queued: true,
      };
    }

    return {
      channel,
      messageId: result.messageId,
      threadId: options?.threadId || result.messageId,
    };
  }
}

/**
 * WhatsApp platform factory for declarative registration.
 */
const whatsappFactory: PlatformFactory = {
  name: "whatsapp",

  isEnabled(configs: PlatformConfigs): boolean {
    return configs.whatsapp?.enabled === true;
  },

  create(
    configs: PlatformConfigs,
    agentOptions: FactoryAgentOptions,
    sessionTimeoutMinutes: number
  ) {
    const platformConfig: WhatsAppPlatformConfig = {
      whatsapp: configs.whatsapp,
    };
    return new WhatsAppPlatform(
      platformConfig,
      agentOptions,
      sessionTimeoutMinutes
    );
  },
};

// Register factory on module load
platformFactoryRegistry.register(whatsappFactory);
