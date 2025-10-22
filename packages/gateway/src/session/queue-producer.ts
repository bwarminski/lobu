#!/usr/bin/env bun

import {
  createLogger,
  createMessageQueue,
  type IMessageQueue,
} from "@peerbot/core";
import * as Sentry from "@sentry/node";

const logger = createLogger("dispatcher");

/**
 * Queue producer for dispatching messages to Redis queues
 * Handles both direct_message and thread_message queues with bot isolation
 */

export interface BotContext {
  botId: string;
  platform: string;
}

export interface WorkerDeploymentPayload {
  userId: string;
  botId: string;
  threadId: string;
  platform: string;
  platformUserId: string;
  messageId: string;
  messageText: string;
  channelId: string;
  platformMetadata: Record<string, any>;
  claudeOptions: Record<string, any>;
  environmentVariables?: Record<string, string>;
  // Routing metadata for thread-specific processing
  routingMetadata?: {
    targetThreadId: string;
    userId: string;
  };
}

export interface ThreadMessagePayload {
  botId: string;
  userId: string;
  threadId: string;
  platform: string;
  channelId: string;
  messageId: string;
  messageText: string;
  platformMetadata: Record<string, any>;
  claudeOptions: Record<string, any>;
  // Routing metadata for thread-specific processing
  routingMetadata?: {
    targetThreadId: string;
    userId: string;
  };
}

export class QueueProducer {
  private queue: IMessageQueue;
  private isConnected = false;

  constructor(connectionString: string) {
    this.queue = createMessageQueue(connectionString);
  }

  /**
   * Start the queue producer
   */
  async start(): Promise<void> {
    try {
      await this.queue.start();
      this.isConnected = true;

      // Create the messages queue if it doesn't exist
      await this.queue.createQueue("messages");
      logger.info("✅ Created/verified messages queue");

      logger.info("✅ Queue producer started successfully");
    } catch (error) {
      logger.error("Failed to start queue producer:", error);
      throw error;
    }
  }

  /**
   * Stop the queue producer
   */
  async stop(): Promise<void> {
    try {
      this.isConnected = false;
      await this.queue.stop();
      logger.info("✅ Queue producer stopped");
    } catch (error) {
      logger.error("Error stopping queue producer:", error);
      throw error;
    }
  }

  /**
   * Enqueue any message (direct or thread) to the single 'messages' queue
   * Orchestrator will determine if it needs to create a deployment or route to existing thread
   */
  async enqueueMessage(
    payload: WorkerDeploymentPayload | ThreadMessagePayload,
    options?: {
      priority?: number;
      retryLimit?: number;
      retryDelay?: number;
      expireInSeconds?: number;
    }
  ): Promise<string> {
    if (!this.isConnected) {
      throw new Error("Queue producer is not connected");
    }

    try {
      // All messages go to the single 'messages' queue
      const jobId = await this.queue.send("messages", payload, {
        priority: options?.priority || 0,
        retryLimit: options?.retryLimit || 3,
        retryDelay: options?.retryDelay || 30,
        expireInSeconds: options?.expireInSeconds || 300, // 5 minutes = 300 seconds
        singletonKey: `message-${payload.userId}-${payload.threadId}-${payload.messageId || Date.now()}`, // Prevent duplicates
      });

      logger.info(
        `Enqueued message job ${jobId} for user ${payload.userId}, thread ${payload.threadId}`
      );
      return jobId || "job-sent";
    } catch (error) {
      Sentry.captureException(error);
      logger.error(
        `Failed to enqueue message for user ${payload.userId}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Send a response directly to thread_response queue
   * Used to start streams immediately before worker responds
   */
  async sendThreadResponse(payload: any): Promise<void> {
    if (!this.isConnected) {
      logger.warn("Cannot send thread response - queue not connected");
      return;
    }

    try {
      // Ensure thread_response queue exists
      await this.queue.createQueue("thread_response");
      await this.queue.send("thread_response", payload);
      logger.info(
        `📤 Sent initial stream delta (${payload.delta?.length || 0} chars) for thread ${payload.threadTs}`
      );
    } catch (error) {
      logger.error("Failed to send thread response:", error);
      // Don't throw - this is not critical, just a UX improvement
    }
  }

  /**
   * Get queue statistics
   */
  async getQueueStats(queueName: string): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
  }> {
    try {
      const stats = await this.queue.getQueueStats(queueName);
      return stats;
    } catch (error) {
      logger.error(`Failed to get queue stats for ${queueName}:`, error);
      return { waiting: 0, active: 0, completed: 0, failed: 0 };
    }
  }

  /**
   * Check if producer is connected
   */
  isHealthy(): boolean {
    return this.isConnected && this.queue.isHealthy();
  }
}
