#!/usr/bin/env bun

import { initSentry } from "./sentry";
// Force rebuild to deploy MCP config fix - timestamp: 1756399400

// Initialize Sentry monitoring
initSentry();

import { QueuePersistentClaudeWorker } from "./queue-persistent-worker";
import { QueueIntegration } from "./queue-integration";
import logger from "./logger";

// Re-export ClaudeWorker for backward compatibility
export { ClaudeWorker } from "./claude-worker";

/**
 * Main entry point - now supports both queue-based and legacy workers
 */
async function main() {  
    logger.info("🔄 Starting in queue mode (dynamic deployment-based persistent worker)");
    
    // Get user ID and optional target thread from environment
    const userId = process.env.USER_ID;
    const targetThreadId = process.env.TARGET_THREAD_ID; // Optional - for thread-specific workers
    
    if (!userId) {
      logger.error("❌ USER_ID environment variable is required for queue mode");
      process.exit(1);
    }
    
    try {
      const queueWorker = new QueuePersistentClaudeWorker(userId, targetThreadId);
      await queueWorker.start();
      
      // Keep the process running for persistent queue consumption
      process.on("SIGTERM", async () => {
        logger.info("Received SIGTERM, shutting down queue worker...");
        await queueWorker.stop();
        process.exit(0);
      });
      
      process.on("SIGINT", async () => {
        logger.info("Received SIGINT, shutting down queue worker...");
        await queueWorker.stop();
        process.exit(0);
      });
      
      // Keep process alive
      await new Promise(() => {}); // Wait forever
      
    } catch (error) {
      logger.error("❌ Queue worker failed:", error);
      process.exit(1);
    }
}

// Handle process signals
process.on("SIGTERM", async () => {
  logger.info("Received SIGTERM, shutting down gracefully...");
  await appendTerminationMessage("SIGTERM");
  process.exit(0);
});

process.on("SIGINT", async () => {
  logger.info("Received SIGINT, shutting down gracefully...");
  await appendTerminationMessage("SIGINT");
  process.exit(0);
});

/**
 * Append termination message via queue when worker is terminated
 */
async function appendTerminationMessage(signal: string): Promise<void> {
  try {
    if (process.env.DATABASE_URL && process.env.SLACK_RESPONSE_CHANNEL && process.env.SLACK_RESPONSE_TS) {
      const queueIntegration = new QueueIntegration({
        databaseUrl: process.env.DATABASE_URL,
        responseChannel: process.env.SLACK_RESPONSE_CHANNEL,
        responseTs: process.env.SLACK_RESPONSE_TS,
        messageId: process.env.SLACK_RESPONSE_TS
      });
      
      await queueIntegration.start();
      await queueIntegration.updateProgress(
        `🛑 **Worker terminated (${signal})** - The host is terminated and not processing further requests.`
      );
      await queueIntegration.signalDone();
      
      // Reactions are now handled by dispatcher based on message isDone status
      // No direct reaction calls needed here
      
      await queueIntegration.stop();
    }
  } catch (error) {
    logger.error(`Failed to send ${signal} termination message via queue:`, error);
  }
}

export type { WorkerConfig } from "./types";

main();


