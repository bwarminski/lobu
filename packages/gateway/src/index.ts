#!/usr/bin/env bun

import { initSentry } from "@peerbot/core";

// Initialize Sentry monitoring (fire and forget - won't block startup)
initSentry().catch(console.error);

import http from "node:http";
import { existsSync } from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { moduleRegistry } from "@peerbot/core";
import { createLogger, type OrchestratorConfig } from "@peerbot/core";
import { LogLevel } from "@slack/bolt";
import { config as dotenvConfig } from "dotenv";
import express from "express";

export const logger = createLogger("dispatcher");

import type { WorkerGateway } from "./gateway";
import { Orchestrator } from "./orchestration";
import type { AnthropicProxy } from "./proxy/anthropic-proxy";
import { SlackDispatcher } from "./slack";
import type { DispatcherConfig } from "./types";
import type { McpProxy } from "./mcp/proxy";

let healthServer: http.Server | null = null;

/**
 * Setup health endpoints, proxy, and worker gateway on port 8080
 */
function setupHealthEndpoints(
  anthropicProxy?: AnthropicProxy,
  workerGateway?: WorkerGateway,
  mcpProxy?: McpProxy
) {
  if (healthServer) return;

  // Create Express app for proxy and health endpoints
  const proxyApp = express();

  // Add body parsing middleware for JSON and raw data
  proxyApp.use(express.json({ limit: "50mb" }));
  proxyApp.use(express.raw({ type: "application/json", limit: "50mb" }));

  // Health endpoints
  proxyApp.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      anthropicProxy: !!anthropicProxy,
    });
  });

  proxyApp.get("/ready", (_req, res) => {
    res.json({ ready: true });
  });

  // Add Anthropic proxy if provided
  if (anthropicProxy) {
    proxyApp.use("/api/anthropic", anthropicProxy.getRouter());
    logger.info("✅ Anthropic proxy enabled at :8080/api/anthropic");
  }

  // Add Worker Gateway routes if provided
  if (workerGateway) {
    workerGateway.setupRoutes(proxyApp);
    logger.info("✅ Worker gateway routes enabled at :8080/worker/*");
  }

  if (mcpProxy) {
    mcpProxy.setupRoutes(proxyApp);
    logger.info("✅ MCP proxy routes enabled at :8080/mcp/*");
  }

  // Register module endpoints
  moduleRegistry.registerEndpoints(proxyApp);
  logger.info("✅ Module endpoints registered");

  // Create HTTP server with Express app
  healthServer = http.createServer(proxyApp);

  // Listen on port 8080 for health checks and proxy
  const healthPort = 8080;
  healthServer.listen(healthPort, () => {
    logger.info(
      `Health check and proxy server listening on port ${healthPort}`
    );
  });
}

/**
 * Main entry point
 */
type StartOptions = {
  env?: string;
};

class MissingRequiredEnvError extends Error {
  constructor(public envName: string | string[]) {
    const message = Array.isArray(envName)
      ? `Missing one of the required environment variables: ${envName.join(", ")}`
      : `Missing required environment variable: ${envName}`;
    super(message);
    this.name = "MissingRequiredEnvError";
  }
}

async function startGateway({ env }: StartOptions = {}) {
  try {
    if (process.env.NODE_ENV !== "production") {
      const envProvided = Boolean(env);
      const envPath = envProvided
        ? path.resolve(process.cwd(), env!)
        : path.resolve(process.cwd(), ".env");

      if (existsSync(envPath)) {
        dotenvConfig({ path: envPath });
        logger.debug(`Loaded environment variables from ${envPath}`);
      } else if (envProvided) {
        logger.warn(
          `Specified env file ${envPath} was not found; continuing without it.`
        );
      } else {
        logger.debug("No .env file found; relying on process environment.");
      }
    }

    logger.info("🚀 Starting Claude Code Slack Dispatcher");

    // Get bot token from environment
    const botToken = process.env.SLACK_BOT_TOKEN;

    // Load configuration from environment
    logger.info("Environment variables debug:", {
      botToken: `${botToken?.substring(0, 10)}...`,
      appToken: `${process.env.SLACK_APP_TOKEN?.substring(0, 10)}...`,
      signingSecret: `${process.env.SLACK_SIGNING_SECRET?.substring(0, 10)}...`,
    });

    const connectionString = process.env.QUEUE_URL;
    if (!connectionString) {
      throw new MissingRequiredEnvError("QUEUE_URL");
    }

    if (!botToken) {
      throw new MissingRequiredEnvError("SLACK_BOT_TOKEN");
    }

    const config: DispatcherConfig = {
      slack: {
        token: botToken,
        appToken: process.env.SLACK_APP_TOKEN,
        signingSecret: process.env.SLACK_SIGNING_SECRET,
        socketMode: process.env.SLACK_HTTP_MODE !== "true",
        port: parseInt(process.env.PORT || "3000", 10),
        botUserId: process.env.SLACK_BOT_USER_ID,
        allowedUsers: process.env.SLACK_ALLOWED_USERS?.split(","),
      },
      claude: {
        allowedTools: process.env.ALLOWED_TOOLS?.split(","),
        model: process.env.AGENT_DEFAULT_MODEL,
        timeoutMinutes: process.env.TIMEOUT_MINUTES
          ? Number(process.env.TIMEOUT_MINUTES)
          : undefined,
      },
      sessionTimeoutMinutes: parseInt(
        process.env.SESSION_TIMEOUT_MINUTES || "5",
        10
      ),
      logLevel: (process.env.LOG_LEVEL as any) || LogLevel.INFO,
      // Queue configuration (required)
      queues: {
        connectionString,
        directMessage: process.env.QUEUE_DIRECT_MESSAGE || "direct_message",
        messageQueue: process.env.QUEUE_MESSAGE_QUEUE || "message_queue",
        retryLimit: parseInt(process.env.PGBOSS_RETRY_LIMIT || "3", 10),
        retryDelay: parseInt(process.env.PGBOSS_RETRY_DELAY || "30", 10),
        expireInHours: parseInt(process.env.PGBOSS_EXPIRE_HOURS || "24", 10),
      },
      // Anthropic proxy configuration (always enabled)
      anthropicProxy: {
        enabled: true,
        anthropicApiKey:
          process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN!,
        anthropicBaseUrl: process.env.ANTHROPIC_BASE_URL,
      },
    };

    logger.info("Final config debug:", {
      slackToken: `${config.slack.token?.substring(0, 10)}...`,
      slackAppToken: `${config.slack.appToken?.substring(0, 10)}...`,
      slackSigningSecret: `${config.slack.signingSecret?.substring(0, 10)}...`,
      socketMode: config.slack.socketMode,
    });

    // Validate required configuration
    // Create orchestrator configuration
    const orchestratorConfig: OrchestratorConfig = {
      queues: {
        connectionString: config.queues.connectionString,
        retryLimit: config.queues.retryLimit || 3,
        retryDelay: config.queues.retryDelay || 30,
        expireInSeconds: (config.queues.expireInHours || 24) * 3600,
      },
      worker: {
        image: {
          repository: process.env.WORKER_IMAGE_REPOSITORY || "peerbot-worker",
          tag: process.env.WORKER_IMAGE_TAG || "latest",
          pullPolicy: process.env.WORKER_IMAGE_PULL_POLICY || "Always",
        },
        runtimeClassName: process.env.WORKER_RUNTIME_CLASS_NAME || "kata",
        resources: {
          requests: {
            cpu: process.env.WORKER_CPU_REQUEST || "100m",
            memory: process.env.WORKER_MEMORY_REQUEST || "256Mi",
          },
          limits: {
            cpu: process.env.WORKER_CPU_LIMIT || "1000m",
            memory: process.env.WORKER_MEMORY_LIMIT || "2Gi",
          },
        },
        idleCleanupMinutes: parseInt(
          process.env.WORKER_IDLE_CLEANUP_MINUTES || "60",
          10
        ),
        maxDeployments: parseInt(
          process.env.MAX_WORKER_DEPLOYMENTS || "100",
          10
        ),
      },
      kubernetes: {
        namespace: process.env.KUBERNETES_NAMESPACE || "peerbot",
      },
      cleanup: {
        initialDelayMs: parseInt(
          process.env.CLEANUP_INITIAL_DELAY_MS || "5000",
          10
        ),
        intervalMs: parseInt(process.env.CLEANUP_INTERVAL_MS || "60000", 10),
        veryOldDays: parseInt(process.env.CLEANUP_VERY_OLD_DAYS || "7", 10),
      },
    };

    // Create and start orchestrator
    const orchestrator = new Orchestrator(orchestratorConfig);
    await orchestrator.start();

    logger.info("✅ Orchestrator started");

    // Create and start dispatcher
    const dispatcher = new SlackDispatcher(config);
    await dispatcher.start();

    logger.info("✅ Claude Code Slack Dispatcher is running!");

    // Setup health endpoints on port 8080
    setupHealthEndpoints(
      dispatcher.getAnthropicProxy(),
      dispatcher.getWorkerGateway(),
      dispatcher.getMcpProxy()
    );

    // Setup graceful shutdown for orchestrator
    const cleanup = async () => {
      logger.info("Shutting down...");
      await orchestrator.stop();
      process.exit(0);
    };

    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);

    // Handle health checks
    process.on("SIGUSR1", () => {
      const status = dispatcher.getStatus();
      logger.info("Health check:", JSON.stringify(status, null, 2));
    });
  } catch (error) {
    if (error instanceof MissingRequiredEnvError) {
      logger.error(error.message);
    } else {
      logger.error("❌ Failed to start Slack Dispatcher:", error);
    }
    process.exit(1);
  }
}

const program = new Command();

program
  .name("peerbot-gateway")
  .description("Peerbot gateway service")
  .option("--env <path>", "Path to environment file")
  .action(async (options: StartOptions) => {
    await startGateway(options);
  });

program.parseAsync(process.argv).catch((error: any) => {
  logger.error("❌ Failed to start Slack Dispatcher:", error);
  process.exit(1);
});

export type { DispatcherConfig } from "./types";
