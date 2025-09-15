#!/usr/bin/env bun

// Set TLS verification before any imports that might use HTTPS
if (process.env.K8S_SKIP_TLS_VERIFY === "true") {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

import type { ClaudeWorker } from "./claude-worker";
import logger from "./logger";
import { WorkerQueueConsumer } from "./queue/queue-consumer";

/**
 * Queue-based persistent Claude worker
 * Replaces ConfigMap polling with PostgreSQL queue consumption
 */
export class QueuePersistentClaudeWorker {
  private worker: ClaudeWorker | null = null;
  private queueConsumer: WorkerQueueConsumer;
  private userId: string;
  private targetThreadId?: string;
  private isInitialized = false;

  constructor(userId: string, targetThreadId?: string) {
    this.userId = userId;
    this.targetThreadId = targetThreadId;

    // Load initial configuration from environment
    // this.config = this.loadConfigFromEnv();

    // Get deployment name from environment
    const deploymentName = process.env.DEPLOYMENT_NAME;
    if (!deploymentName) {
      throw new Error("DEPLOYMENT_NAME environment variable is required");
    }

    // Initialize queue consumer with thread-specific routing
    const connectionString = this.buildConnectionString();
    this.queueConsumer = new WorkerQueueConsumer(
      connectionString,
      this.userId,
      deploymentName,
      this.targetThreadId
    );

    logger.info(`🚀 Starting Queue-based Persistent Claude Worker`);
    logger.info(`- User ID: ${this.userId}`);
    logger.info(`- Deployment: ${deploymentName}`);
    if (this.targetThreadId) {
      logger.info(`- Target Thread: ${this.targetThreadId}`);
    }
  }

  private buildConnectionString(): string {
    // Build connection string from environment variables
    if (
      !process.env.PEERBOT_DATABASE_HOST ||
      !process.env.PEERBOT_DATABASE_PORT ||
      !process.env.PEERBOT_DATABASE_USERNAME ||
      !process.env.PEERBOT_DATABASE_PASSWORD
    ) {
      throw new Error(
        "Database connection environment variables are required (PEERBOT_DATABASE_HOST, PEERBOT_DATABASE_PORT, PEERBOT_DATABASE_USERNAME, PEERBOT_DATABASE_PASSWORD)"
      );
    }

    const connectionString = `postgresql://${process.env.PEERBOT_DATABASE_USERNAME}:${process.env.PEERBOT_DATABASE_PASSWORD}@${process.env.PEERBOT_DATABASE_HOST}:${process.env.PEERBOT_DATABASE_PORT}/peerbot`;
    return connectionString;
  }

  async start(): Promise<void> {
    try {
      // Start queue consumer (this will handle message processing)
      await this.queueConsumer.start();

      this.isInitialized = true;
      logger.info(`✅ Queue-based persistent worker started successfully`);
    } catch (error) {
      logger.error("Failed to start queue-based persistent worker:", error);
      process.exit(1);
    }
  }

  /**
   * Stop the worker (public method)
   */
  async stop(): Promise<void> {
    await this.shutdown();
  }

  /**
   * Graceful shutdown
   */
  private async shutdown(): Promise<void> {
    logger.info(`Shutting down queue-based persistent worker...`);

    try {
      // Stop queue consumer
      await this.queueConsumer.stop();

      // Cleanup current worker if processing
      if (this.worker) {
        await this.worker.cleanup();
      }
    } catch (error) {
      logger.error("Error during shutdown:", error);
    }

    process.exit(0);
  }

  /**
   * Get worker status
   */
  getStatus(): {
    isInitialized: boolean;
    queueStatus: any;
  } {
    return {
      isInitialized: this.isInitialized,
      queueStatus: this.queueConsumer.getStatus(),
    };
  }
}
