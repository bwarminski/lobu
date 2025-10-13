#!/usr/bin/env bun

import type { IMessageQueue } from "@peerbot/core";
import { createLogger, type IRedisClient, RedisClient } from "@peerbot/core";
import type { WorkerConnectionManager } from "./connection-manager";

const logger = createLogger("worker-job-router");

interface PendingJob {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
  jobId: string;
}

/**
 * Routes jobs from queues to workers via SSE connections
 * Manages job acknowledgments and timeouts
 */
export class WorkerJobRouter {
  private readonly QUEUE_WORKERS_KEY = "worker_job_router:queue_workers";
  private pendingJobs: Map<string, PendingJob> = new Map(); // In-memory timeouts only
  private redis: IRedisClient;

  constructor(
    private queue: IMessageQueue,
    private connectionManager: WorkerConnectionManager
  ) {
    // Get Redis client from queue connection pool
    this.redis = new RedisClient(queue.getRedisClient());
  }

  /**
   * Register a worker to receive jobs from its deployment queue
   * Each worker listens on its own queue: thread_message_{deploymentName}
   */
  async registerWorker(deploymentName: string): Promise<void> {
    const queueName = `thread_message_${deploymentName}`;

    // Check if already registered in Redis
    const isRegistered = await this.redis.sismember(
      this.QUEUE_WORKERS_KEY,
      queueName
    );

    if (isRegistered) {
      logger.debug(`Worker already registered for queue ${queueName}`);
      return;
    }

    // Create queue if it doesn't exist
    await this.queue.createQueue(queueName);

    // Register job handler
    await this.queue.work(queueName, async (job: unknown) => {
      await this.handleJob(deploymentName, job);
    });

    // Mark as registered in Redis
    await this.redis.sadd(this.QUEUE_WORKERS_KEY, queueName);
    logger.info(`Registered worker for queue ${queueName}`);
  }

  /**
   * Handle a job from the queue and route it to the worker
   */
  private async handleJob(deploymentName: string, job: unknown): Promise<void> {
    const connection = this.connectionManager.getConnection(deploymentName);

    if (!connection) {
      logger.warn(
        `No connection for deployment ${deploymentName}, job will be retried`
      );
      throw new Error("Worker not connected");
    }

    // Extract job data and ID
    const jobData = (job as { data?: unknown }).data;
    const jobId =
      (job as { id?: string }).id ||
      `job-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    // Create promise that resolves when worker sends response
    const responsePromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => {
          this.pendingJobs.delete(jobId);
          reject(new Error(`Worker response timeout for job ${jobId}`));
        },
        5 * 60 * 1000
      ); // 5 minute timeout

      this.pendingJobs.set(jobId, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeout,
        jobId,
      });
    });

    // Send job to worker via SSE with jobId
    const jobPayload =
      typeof jobData === "object" && jobData !== null
        ? { ...jobData, jobId: jobId }
        : { data: jobData, jobId: jobId };

    this.connectionManager.sendSSE(connection.res, "job", jobPayload);
    this.connectionManager.touchConnection(deploymentName);

    // Wait for worker to acknowledge/complete the job
    await responsePromise;

    logger.debug(`Job ${jobId} completed by worker ${deploymentName}`);
  }

  /**
   * Acknowledge job completion from worker
   * Called when worker sends HTTP response
   */
  acknowledgeJob(jobId: string): void {
    const pendingJob = this.pendingJobs.get(jobId);
    if (pendingJob) {
      clearTimeout(pendingJob.timeout);
      pendingJob.resolve(undefined);
      this.pendingJobs.delete(jobId);
      logger.debug(`Job ${jobId} acknowledged`);
    } else {
      logger.warn(`Received acknowledgment for unknown job ${jobId}`);
    }
  }

  /**
   * Check if a worker is registered
   */
  async isWorkerRegistered(deploymentName: string): Promise<boolean> {
    const queueName = `thread_message_${deploymentName}`;
    return await this.redis.sismember(this.QUEUE_WORKERS_KEY, queueName);
  }

  /**
   * Get number of pending jobs
   */
  getPendingJobCount(): number {
    return this.pendingJobs.size;
  }

  /**
   * Shutdown job router
   */
  shutdown(): void {
    // Reject all pending jobs
    for (const [jobId, pendingJob] of this.pendingJobs.entries()) {
      clearTimeout(pendingJob.timeout);
      pendingJob.reject(new Error("Job router shutting down"));
      logger.debug(`Rejected pending job ${jobId} due to shutdown`);
    }
    this.pendingJobs.clear();
  }
}
