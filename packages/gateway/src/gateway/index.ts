#!/usr/bin/env bun

import type { IMessageQueue, WorkerTokenData } from "@peerbot/core";
import { createLogger, verifyWorkerToken } from "@peerbot/core";
import type { Request, Response } from "express";
import { WorkerConnectionManager } from "./connection-manager";
import { WorkerJobRouter } from "./job-router";
import type { McpConfigService } from "../mcp/config-service";

const logger = createLogger("worker-gateway");

/**
 * Worker Gateway - SSE and HTTP endpoints for worker communication
 * Workers connect via SSE to receive jobs, send responses via HTTP POST
 * Uses encrypted tokens for authentication and routing
 */
export class WorkerGateway {
  private connectionManager: WorkerConnectionManager;
  private jobRouter: WorkerJobRouter;
  private queue: IMessageQueue;
  private mcpConfigService?: McpConfigService;

  constructor(queue: IMessageQueue, mcpConfigService?: McpConfigService) {
    this.queue = queue;
    this.connectionManager = new WorkerConnectionManager();
    this.jobRouter = new WorkerJobRouter(queue, this.connectionManager);
    this.mcpConfigService = mcpConfigService;
  }

  /**
   * Setup routes on Express app
   */
  setupRoutes(app: any) {
    // SSE endpoint for workers to receive jobs
    app.get("/worker/stream", (req: Request, res: Response) =>
      this.handleStreamConnection(req, res)
    );

    // HTTP POST endpoint for workers to send responses
    app.post("/worker/response", (req: Request, res: Response) =>
      this.handleWorkerResponse(req, res)
    );

    if (this.mcpConfigService) {
      app.get("/worker/mcp/config", (req: Request, res: Response) =>
        this.handleMcpConfigRequest(req, res)
      );
    }

    logger.info("Worker gateway routes registered");
  }

  /**
   * Handle SSE connection from worker
   */
  private async handleStreamConnection(req: Request, res: Response) {
    const auth = this.authenticateWorker(req, res);
    if (!auth) {
      return;
    }

    const { deploymentName, userId, threadId } = auth.tokenData;

    // Setup SSE
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    // Register connection with connection manager
    this.connectionManager.addConnection(deploymentName, userId, threadId, res);

    // Register job router for this worker (if not already registered)
    const isRegistered =
      await this.jobRouter.isWorkerRegistered(deploymentName);
    if (!isRegistered) {
      await this.jobRouter.registerWorker(deploymentName);
    }

    // Handle client disconnect
    req.on("close", () => {
      this.connectionManager.removeConnection(deploymentName);
      // Note: We don't unregister the job router - worker might reconnect
    });
  }

  /**
   * Handle HTTP response from worker
   */
  private async handleWorkerResponse(req: Request, res: Response) {
    const auth = this.authenticateWorker(req, res);
    if (!auth) {
      return;
    }

    const { deploymentName } = auth.tokenData;

    // Update connection activity
    this.connectionManager.touchConnection(deploymentName);

    try {
      const { jobId, ...responseData } = req.body;

      // Acknowledge job completion if jobId provided
      if (jobId) {
        this.jobRouter.acknowledgeJob(jobId);
      }

      // Send response to thread_response queue
      await this.queue.send("thread_response", responseData);

      res.json({ success: true });
    } catch (error) {
      logger.error(`Error handling worker response: ${error}`);
      res.status(500).json({ error: "Failed to process response" });
    }
  }

  private async handleMcpConfigRequest(req: Request, res: Response) {
    if (!this.mcpConfigService) {
      res.status(503).json({ error: "mcp_config_unavailable" });
      return;
    }

    const auth = this.authenticateWorker(req, res);
    if (!auth) {
      return;
    }

    try {
      const baseUrl = this.getRequestBaseUrl(req);
      const config = await this.mcpConfigService.getWorkerConfig({
        baseUrl,
        workerToken: auth.token,
      });
      res.json(config);
    } catch (error) {
      logger.error("Failed to generate MCP config", { error });
      res.status(500).json({ error: "mcp_config_error" });
    }
  }

  private authenticateWorker(
    req: Request,
    res: Response
  ): { tokenData: WorkerTokenData; token: string } | null {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      res
        .status(401)
        .json({ error: "Missing or invalid authorization header" });
      return null;
    }

    const token = authHeader.substring(7);
    const tokenData = verifyWorkerToken(token);

    if (!tokenData) {
      logger.warn("Invalid token");
      res.status(401).json({ error: "Invalid token" });
      return null;
    }

    return { tokenData, token };
  }

  private getRequestBaseUrl(req: Request): string {
    const forwardedProto = req.headers["x-forwarded-proto"];
    const protocolCandidate = Array.isArray(forwardedProto)
      ? forwardedProto[0]
      : forwardedProto?.split(",")[0];
    const protocol = (protocolCandidate || req.protocol || "http").trim();
    const host = req.get("host");
    if (host) {
      return `${protocol}://${host}`;
    }
    return (
      process.env.PEERBOT_PUBLIC_GATEWAY_URL || `${protocol}://localhost:8080`
    );
  }

  /**
   * Get active worker connections
   */
  getActiveConnections(): string[] {
    return this.connectionManager.getActiveConnections();
  }

  /**
   * Shutdown gateway
   */
  shutdown(): void {
    this.connectionManager.shutdown();
    this.jobRouter.shutdown();
  }
}
