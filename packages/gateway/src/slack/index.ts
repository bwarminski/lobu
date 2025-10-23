import { moduleRegistry } from "@peerbot/core";
import { createMessageQueue } from "@peerbot/core";
import { App, ExpressReceiver, LogLevel } from "@slack/bolt";
import { createLogger } from "@peerbot/core";
import type { GatewayConfig } from "../cli/config";
import { WorkerGateway } from "../gateway";
import { AnthropicProxy } from "../model-provider/anthropic-proxy";
import { QueueProducer } from "../session/queue-producer";
import { ThreadResponseConsumer } from "./thread-processor";
import { SlackEventHandlers } from "./event-router";
import { McpConfigService } from "../mcp/config-service";
import { McpCredentialStore } from "../mcp/credential-store";
import { McpProxy } from "../mcp/proxy";
import { McpOAuthModule } from "../mcp/oauth-module";
import { OAuthStateStore } from "../mcp/oauth-state-store";
import { McpInputStore } from "../mcp/input-store";
import { SocketHealthMonitor } from "../health/socket-health-monitor";
import { McpOAuthDiscoveryService } from "../mcp/oauth-discovery";

const logger = createLogger("slack-dispatcher");

export class SlackDispatcher {
  private app: App;
  private queueProducer: QueueProducer;
  private threadResponseConsumer?: ThreadResponseConsumer;
  private anthropicProxy?: AnthropicProxy;
  private workerGateway?: WorkerGateway;
  private mcpProxy?: McpProxy;
  private config: GatewayConfig;
  private queue?: ReturnType<typeof createMessageQueue>;
  private socketHealthMonitor?: SocketHealthMonitor;

  constructor(config: GatewayConfig) {
    this.config = config;

    if (!config.queues?.connectionString) {
      throw new Error("Queue connection string is required");
    }

    // Initialize Slack app based on mode
    if (config.slack.socketMode === false) {
      // HTTP mode - use ExpressReceiver
      const receiver = new ExpressReceiver({
        signingSecret: config.slack.signingSecret!,
        endpoints: {
          events: "/slack/events",
        },
        processBeforeResponse: true,
        logLevel: LogLevel.DEBUG,
      });

      // Add URL verification challenge handler BEFORE Slack middleware
      // This is needed for initial Slack app Event Subscription setup
      receiver.router.use("/slack/events", (req, res, next) => {
        // Check if this is a URL verification challenge
        if (req.body && req.body.type === "url_verification") {
          logger.info("Handling Slack URL verification challenge");
          return res.status(200).json({ challenge: req.body.challenge });
        }
        // Otherwise, continue to normal Slack event handling
        next();
      });

      this.app = new App({
        token: config.slack.token,
        receiver,
        logLevel: config.logLevel || LogLevel.DEBUG,
        ignoreSelf: false, // We need to receive action events from our own messages
      });

      logger.info("Initialized Slack app in HTTP mode with ExpressReceiver");
    } else {
      // Socket mode
      const appConfig: any = {
        signingSecret: config.slack.signingSecret,
        socketMode: true,
        appToken: config.slack.appToken,
        port: config.slack.port || 3000,
        logLevel: config.logLevel || LogLevel.INFO,
        ignoreSelf: false, // We need to receive action events from our own messages
        processBeforeResponse: true,
      };

      if (config.slack.token) {
        appConfig.token = config.slack.token;
      } else {
        throw new Error("SLACK_BOT_TOKEN is required");
      }

      this.app = new App(appConfig);
      logger.info("Initialized Slack app in Socket mode");
    }

    // Initialize queue producer
    logger.info("Initializing queue mode");
    this.queueProducer = new QueueProducer(config.queues.connectionString);
    // ThreadResponseConsumer will be created after event handlers are initialized
    this.setupErrorHandling();
    this.setupGracefulShutdown();

    // Add global middleware to log all events
    this.app.use(async ({ payload, next }) => {
      const event = (payload as any).event || payload;
      logger.debug(
        `[Slack Event] Type: ${event?.type}, Subtype: ${event?.subtype}`
      );
      if (event) {
        logger.debug(
          `[Slack Event Details]`,
          JSON.stringify(event).substring(0, 200)
        );
      }
      await next();
    });
  }

  /**
   * Initialize Anthropic proxy service
   */
  private async initializeAnthropicProxy(): Promise<void> {
    this.anthropicProxy = new AnthropicProxy(this.config.anthropicProxy);
    logger.info("✅ Anthropic proxy initialized");
  }

  /**
   * Initialize MCP services (config, discovery, OAuth, proxy)
   */
  private async initializeMcpServices(): Promise<void> {
    if (!this.queue) {
      throw new Error("Queue must be initialized before MCP services");
    }

    const redisClient = this.queue.getRedisClient();

    // Initialize MCP OAuth Discovery Service
    const mcpCredentialStore = new McpCredentialStore(this.queue);
    const mcpDiscoveryService = new McpOAuthDiscoveryService({
      cacheStore: {
        get: async (key: string) => {
          try {
            const value = await redisClient.get(key);
            return value;
          } catch (error) {
            logger.error("Failed to get from cache", { key, error });
            return null;
          }
        },
        set: async (key: string, value: string, ttl: number) => {
          try {
            await redisClient.set(key, value, "EX", ttl);
          } catch (error) {
            logger.error("Failed to set cache", { key, error });
          }
        },
        delete: async (key: string) => {
          try {
            await redisClient.del(key);
          } catch (error) {
            logger.error("Failed to delete from cache", { key, error });
          }
        },
      },
      callbackUrl: this.config.mcp.callbackUrl,
      protocolVersion: "2025-03-26",
      cacheTtl: 86400, // 24 hours
    });
    logger.info("✅ MCP OAuth Discovery Service initialized");

    const oauthStateStore = new OAuthStateStore(this.queue);
    const mcpInputStore = new McpInputStore(this.queue);
    const mcpConfigService = new McpConfigService({
      configUrl: this.config.mcp.serversUrl,
      discoveryService: mcpDiscoveryService,
      credentialStore: mcpCredentialStore,
      inputStore: mcpInputStore,
    });
    this.workerGateway = new WorkerGateway(
      this.queue,
      this.config.mcp.publicGatewayUrl,
      mcpConfigService
    );
    this.mcpProxy = new McpProxy(
      mcpConfigService,
      mcpCredentialStore,
      mcpInputStore
    );
    logger.info("✅ Worker gateway initialized");
    logger.info("✅ MCP proxy initialized");

    // Perform OAuth discovery for all MCP servers
    logger.info("🔍 Discovering OAuth capabilities for MCP servers...");
    await mcpConfigService.enrichWithDiscovery();
    logger.info("✅ MCP OAuth discovery completed");

    // Register MCP OAuth module for authentication flow
    const mcpOAuthModule = new McpOAuthModule(
      mcpConfigService,
      mcpCredentialStore,
      oauthStateStore,
      mcpInputStore,
      this.config.mcp.publicGatewayUrl,
      this.config.mcp.callbackUrl
    );
    moduleRegistry.register(mcpOAuthModule);
    logger.info("✅ MCP OAuth module registered");

    // Discover and register available modules
    await moduleRegistry.registerAvailableModules();

    // Initialize all registered modules
    await moduleRegistry.initAll();
    logger.info("✅ Modules initialized");
  }

  /**
   * Initialize Socket Mode connection and monitoring
   */
  private async initializeSocketMode(): Promise<void> {
    const socketModeClient = (this.app as any).receiver?.client;
    if (!socketModeClient) {
      logger.warn("No Socket Mode client found in receiver");
      return;
    }

    // Circuit breaker: detect reconnection loops and exit
    let connectionCount = 0;
    let lastConnectionTime = Date.now();
    const RECONNECTION_THRESHOLD = 5;
    const RECONNECTION_WINDOW_MS = 30000;

    const checkReconnectionLoop = () => {
      const now = Date.now();
      const timeSinceLastConnection = now - lastConnectionTime;

      if (timeSinceLastConnection > RECONNECTION_WINDOW_MS) {
        connectionCount = 0;
      }

      connectionCount++;
      lastConnectionTime = now;

      logger.info(
        `Socket Mode connection attempt ${connectionCount}/${RECONNECTION_THRESHOLD} (window: ${timeSinceLastConnection}ms)`
      );

      if (
        connectionCount >= RECONNECTION_THRESHOLD &&
        timeSinceLastConnection < RECONNECTION_WINDOW_MS
      ) {
        logger.error(
          `❌ FATAL: Detected reconnection loop (${connectionCount} reconnections in ${timeSinceLastConnection}ms)`
        );
        logger.error(
          "Exiting process - Docker/K8s will restart with clean state"
        );
        process.exit(1);
      }
    };

    // Initialize health monitor for zombie connection detection
    this.socketHealthMonitor = new SocketHealthMonitor(this.config.health);

    socketModeClient.on("slack_event", (event: any, _body: any) => {
      logger.info("Socket Mode event received:", event.type);
      this.socketHealthMonitor?.recordSocketEvent();
    });

    socketModeClient.on("disconnect", () => {
      logger.warn("Socket Mode disconnected, will auto-reconnect");
    });

    socketModeClient.on("error", (error: Error) => {
      logger.error("Socket Mode error:", error);
    });

    socketModeClient.on("ready", () => {
      logger.info("Socket Mode client ready");
      this.socketHealthMonitor?.recordSocketEvent();
    });

    socketModeClient.on("connecting", () => {
      logger.info("Socket Mode connecting...");
      checkReconnectionLoop();
    });

    socketModeClient.on("connected", () => {
      logger.info("Socket Mode connected successfully!");
      this.socketHealthMonitor?.recordSocketEvent();

      // Reset counter on successful stable connection
      setTimeout(() => {
        connectionCount = 0;
        logger.debug("Connection stable - reset reconnection counter");
      }, require("../constants").TIME.FIVE_SECONDS_MS);

      // Start health monitoring after successful connection
      if (this.socketHealthMonitor && this.workerGateway) {
        this.socketHealthMonitor.start(
          () => this.workerGateway?.getActiveConnections().length || 0
        );
        logger.info("✅ Socket health monitoring enabled");
      }
    });

    // Start the Socket Mode app
    this.app.start();

    // Wait for connection or timeout
    const connectionPromise = new Promise<void>((resolve, reject) => {
      if (!socketModeClient) {
        reject(new Error("Socket Mode client not found"));
        return;
      }

      const connectedHandler = () => {
        logger.info("✅ Socket Mode connection established!");
        clearTimeout(timeoutId);
        resolve();
      };

      const timeoutId = setTimeout(() => {
        socketModeClient.removeListener("connected", connectedHandler);
        reject(new Error("Socket Mode connection timeout"));
      }, 10000);

      if (
        socketModeClient.isConnected?.() ||
        socketModeClient.stateMachine?.getCurrentState?.() === "connected"
      ) {
        connectedHandler();
      } else {
        socketModeClient.once("connected", connectedHandler);
      }
    });

    await connectionPromise.catch((error) => {
      logger.warn("Socket Mode connection warning:", error.message);
    });

    // Give it a moment to stabilize
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  /**
   * Initialize HTTP Mode
   */
  private async initializeHttpMode(): Promise<void> {
    await this.app.start(this.config.slack.port || 3000);

    const receiver = (this.app as any).receiver as ExpressReceiver;
    const expressApp = receiver.app;

    // Add request logging middleware
    expressApp.use((req: any, _res: any, next: any) => {
      logger.debug(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
      logger.debug("Headers:", req.headers);
      if (req.method === "POST" && req.body) {
        logger.debug("Body:", JSON.stringify(req.body).substring(0, 200));
      }
      next();
    });

    logger.debug("Express routes after Slack app start:");
    expressApp._router.stack.forEach((middleware: any) => {
      if (middleware.route) {
        logger.debug(
          `- ${Object.keys(middleware.route.methods).join(", ").toUpperCase()} ${middleware.route.path}`
        );
      } else if (middleware.name === "router") {
        logger.debug("- Router middleware");
      }
    });
  }

  /**
   * Start the dispatcher
   */
  async start(): Promise<void> {
    try {
      // Initialize Anthropic proxy
      await this.initializeAnthropicProxy();

      // Initialize Worker Gateway for SSE/HTTP worker communication
      this.queue = createMessageQueue(this.config.queues.connectionString);
      await this.queue.start();

      // Initialize MCP services
      await this.initializeMcpServices();

      // Start queue producer
      await this.queueProducer.start();
      logger.info("✅ Queue producer started");

      // CRITICAL: Get bot's own user ID and bot ID BEFORE initializing handlers
      await this.initializeBotInfo(this.config);

      if (this.threadResponseConsumer) {
        await this.threadResponseConsumer.start();
      }

      // Start Slack app based on mode
      logger.debug(
        `Starting Slack app in ${this.config.slack.socketMode ? "Socket Mode" : "HTTP Mode"}`
      );

      if (this.config.slack.socketMode === false) {
        await this.initializeHttpMode();
      } else {
        logger.info("Starting Slack app in Socket Mode...");
        await this.initializeSocketMode();
      }

      const mode = this.config.slack.socketMode
        ? "Socket Mode"
        : `HTTP on port ${this.config.slack.port}`;
      logger.info(
        `🚀 Slack Dispatcher is running in ${mode}! (Local Development)`
      );

      // Log configuration
      logger.info("Configuration:");
      logger.info(
        `- Session Timeout: ${this.config.sessionTimeoutMinutes} minutes`
      );
      logger.info(
        `- Signing Secret: ${this.config.slack.signingSecret?.substring(0, 8)}...`
      );
    } catch (error) {
      logger.error("Failed to start Slack dispatcher:", error);
      process.exit(1);
    }
  }

  /**
   * Stop the dispatcher
   */
  async stop(): Promise<void> {
    try {
      // Stop health monitor first
      if (this.socketHealthMonitor) {
        this.socketHealthMonitor.stop();
        logger.info("Socket health monitor stopped");
      }

      await this.app.stop();

      await this.queueProducer.stop();

      if (this.threadResponseConsumer) {
        await this.threadResponseConsumer.stop();
      }

      // Shutdown worker gateway
      if (this.workerGateway) {
        this.workerGateway.shutdown();
        logger.info("Worker gateway shutdown complete");
      }

      logger.info("Slack dispatcher stopped");
    } catch (error) {
      logger.error("Error stopping Slack dispatcher:", error);
    }
  }

  /**
   * Get dispatcher status
   */
  getStatus(): {
    isRunning: boolean;
    mode: string;
    config: Partial<GatewayConfig>;
  } {
    return {
      isRunning: true,
      mode: "queue",
      config: {
        slack: {
          token: this.config.slack.token,
          socketMode: this.config.slack.socketMode,
          port: this.config.slack.port,
          apiUrl: this.config.slack.apiUrl,
        },
        queues: this.config.queues,
      },
    };
  }

  /**
   * Get Anthropic proxy instance
   */
  getAnthropicProxy() {
    return this.anthropicProxy;
  }

  /**
   * Get Worker Gateway instance
   */
  getWorkerGateway() {
    return this.workerGateway;
  }

  getMcpProxy() {
    return this.mcpProxy;
  }

  /**
   * Initialize bot info and event handlers
   * CRITICAL: This must be called BEFORE starting the app to ensure
   * all handlers have access to bot IDs during initialization
   */
  private async initializeBotInfo(config: GatewayConfig): Promise<void> {
    try {
      // Validate bot IDs are set or fetch them
      if (!config.slack.botUserId || !config.slack.botId) {
        logger.info("Bot IDs not configured, calling auth.test via HTTP...");

        // Use direct HTTP call instead of Slack Bolt client
        const response = await fetch(`${config.slack.apiUrl}/auth.test`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.slack.token}`,
            "Content-Type": "application/json",
          },
        });

        const authResult = (await response.json()) as {
          ok: boolean;
          user_id?: string;
          bot_id?: string;
          error?: string;
        };

        if (!authResult.ok) {
          throw new Error(
            `Auth test failed: ${authResult.error || "Unknown error"}`
          );
        }

        if (!authResult.user_id || !authResult.bot_id) {
          throw new Error("Auth test did not return bot IDs");
        }

        // Store bot info in config
        config.slack.botUserId = authResult.user_id;
        config.slack.botId = authResult.bot_id;

        logger.info(
          `Bot initialized - User ID: ${authResult.user_id}, Bot ID: ${authResult.bot_id}`
        );
      } else {
        logger.info(
          `Using configured bot IDs - User ID: ${config.slack.botUserId}, Bot ID: ${config.slack.botId}`
        );
      }

      // Now that bot IDs are set, initialize event handlers
      logger.info("Initializing queue-based event handlers");
      new SlackEventHandlers(
        this.app,
        this.queueProducer,
        config,
        moduleRegistry,
        this.queue!
      );

      // Create ThreadResponseConsumer with the started queue
      this.threadResponseConsumer = new ThreadResponseConsumer(
        this.queue!,
        config.slack.token,
        moduleRegistry
      );
    } catch (error) {
      logger.error("Failed to initialize bot:", error);
      throw new Error("Failed to initialize bot - could not get bot user ID");
    }
  }

  /**
   * Setup error handling
   */
  private setupErrorHandling(): void {
    this.app.error(async (error: Error) => {
      logger.error("Slack app error:", error);
      logger.error("Error details:", {
        message: error.message,
        code: (error as any).code,
        data: (error as any).data,
        stack: error.stack,
      });
    });

    process.on("unhandledRejection", (reason, promise) => {
      // Filter out expected Socket Mode connection events
      const reasonStr = String(reason);
      if (
        reasonStr.includes("server explicit disconnect") ||
        reasonStr.includes("Unhandled event") ||
        reasonStr.includes("state machine")
      ) {
        // These are expected Socket Mode reconnection events, just log as debug
        logger.debug(
          "Socket Mode connection event (expected):",
          reasonStr.substring(0, 100)
        );
        return;
      }

      logger.error("Unhandled Rejection at:", promise, "reason:", reason);
      // Don't exit on unhandled rejections during startup
      // The app might still work despite some initialization errors
    });

    process.on("uncaughtException", (error) => {
      const errorStr = error?.toString() || "";
      const messageStr = (error as any)?.message || "";

      // Check if this is a Socket Mode connection error that should be ignored
      if (
        errorStr.includes("server explicit disconnect") ||
        messageStr.includes("server explicit disconnect") ||
        errorStr.includes("Unhandled event") ||
        messageStr.includes("Unhandled event") ||
        errorStr.includes("state machine") ||
        messageStr.includes("state machine")
      ) {
        // These are expected Socket Mode reconnection events, just log as debug
        logger.debug(
          "Socket Mode connection exception (expected, will reconnect):",
          errorStr.substring(0, 100)
        );
        return;
      }

      logger.error("Uncaught Exception:", error);
      process.exit(1);
    });
  }

  /**
   * Setup graceful shutdown
   */
  private setupGracefulShutdown(): void {
    const cleanup = async () => {
      logger.info("Shutting down Slack dispatcher...");

      // Stop accepting new jobs
      await this.stop();

      // Queue cleanup is handled by stop()
      logger.info("Slack dispatcher shutdown complete");
      process.exit(0);
    };

    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);
  }
}
