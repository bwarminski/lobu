#!/usr/bin/env bun

import { createLogger } from "@peerbot/core";
import express from "express";
import http from "node:http";
import type { GatewayConfig } from "./config";

const logger = createLogger("gateway-startup");

let healthServer: http.Server | null = null;

/**
 * Setup health endpoints, proxy, and worker gateway on port 8080
 */
function setupHealthEndpoints(
  anthropicProxy: any,
  workerGateway: any,
  mcpProxy: any
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

  // Register module endpoints (must be before MCP proxy for OAuth routes)
  const { moduleRegistry } = require("@peerbot/core");
  moduleRegistry.registerEndpoints(proxyApp);
  logger.info("✅ Module endpoints registered");

  if (mcpProxy) {
    mcpProxy.setupRoutes(proxyApp);
    logger.info("✅ MCP proxy routes enabled at :8080/mcp/*");
  }

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
 * Start the gateway with the provided configuration
 */
export async function startGateway(config: GatewayConfig): Promise<void> {
  logger.info("🚀 Starting Peerbot Gateway");

  // Import dependencies (after config is loaded)
  const { Orchestrator } = await import("../orchestration");
  const { SlackDispatcher } = await import("../slack");

  // Create and start orchestrator
  const orchestrator = new Orchestrator(config.orchestration);
  await orchestrator.start();
  logger.info("✅ Orchestrator started");

  // Create and start dispatcher
  const dispatcher = new SlackDispatcher(config);
  await dispatcher.start();
  logger.info("✅ Slack Dispatcher started");

  // Setup health endpoints on port 8080
  setupHealthEndpoints(
    dispatcher.getAnthropicProxy(),
    dispatcher.getWorkerGateway(),
    dispatcher.getMcpProxy()
  );

  logger.info("✅ Peerbot Gateway is running!");
  logger.info(
    `Mode: ${config.slack.socketMode ? "Socket Mode" : `HTTP on port ${config.slack.port}`}`
  );

  // Setup graceful shutdown
  const cleanup = async () => {
    logger.info("Shutting down gateway...");
    await orchestrator.stop();
    await dispatcher.stop();
    if (healthServer) {
      healthServer.close();
    }
    logger.info("Gateway shutdown complete");
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  // Handle health checks
  process.on("SIGUSR1", () => {
    const status = dispatcher.getStatus();
    logger.info("Health check:", JSON.stringify(status, null, 2));
  });
}
