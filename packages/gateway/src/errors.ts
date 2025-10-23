#!/usr/bin/env bun

/**
 * Centralized error handling for dispatcher
 * Provides error classification and retry logic
 * Platform-specific errors (e.g., Slack) are in their respective directories
 */

import { SlackApiError } from "./slack/errors";

/**
 * Base error class for all dispatcher errors
 */
export class DispatcherError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 500
  ) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }

  /**
   * Determine if this error should be retried
   */
  isRetryable(): boolean {
    return false; // Default: don't retry
  }

  /**
   * Get error details for logging
   */
  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      statusCode: this.statusCode,
      retryable: this.isRetryable(),
    };
  }
}

/**
 * Session management errors
 */
export class SessionError extends DispatcherError {
  constructor(message: string, code: string = "SESSION_ERROR") {
    super(message, code, 400);
  }
}

export class SessionNotFoundError extends SessionError {
  constructor(sessionKey: string) {
    super(`Session not found: ${sessionKey}`, "SESSION_NOT_FOUND");
  }
}

export class SessionOwnershipError extends SessionError {
  constructor(
    public readonly userId: string,
    public readonly ownerId: string
  ) {
    super(
      `User ${userId} does not own this session (owner: ${ownerId})`,
      "SESSION_OWNERSHIP_ERROR"
    );
  }
}

/**
 * Queue errors
 */
export class QueueError extends DispatcherError {
  constructor(message: string, code: string = "QUEUE_ERROR") {
    super(message, code, 500);
  }

  isRetryable(): boolean {
    return true; // Queue errors are generally transient
  }
}

export class QueueConnectionError extends QueueError {
  constructor(message: string) {
    super(message, "QUEUE_CONNECTION_ERROR");
  }
}

/**
 * Worker errors
 */
export class WorkerError extends DispatcherError {
  constructor(message: string, code: string = "WORKER_ERROR") {
    super(message, code, 500);
  }
}

export class WorkerNotConnectedError extends WorkerError {
  constructor(deploymentName: string) {
    super(`Worker ${deploymentName} is not connected`, "WORKER_NOT_CONNECTED");
  }

  isRetryable(): boolean {
    return true; // Worker might reconnect
  }
}

export class WorkerTimeoutError extends WorkerError {
  constructor(jobId: string) {
    super(`Worker timeout for job ${jobId}`, "WORKER_TIMEOUT");
  }

  isRetryable(): boolean {
    return true;
  }
}

/**
 * Module errors
 */
export class ModuleError extends DispatcherError {
  constructor(
    message: string,
    public readonly moduleName: string,
    code: string = "MODULE_ERROR"
  ) {
    super(message, code, 500);
  }

  toJSON() {
    return {
      ...super.toJSON(),
      moduleName: this.moduleName,
    };
  }
}

/**
 * Check if an error is retryable
 */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof DispatcherError) {
    return error.isRetryable();
  }

  // Default: don't retry unknown errors
  return false;
}

/**
 * Format error for user display
 */
export function formatErrorForUser(error: unknown): string {
  if (error instanceof SlackApiError && error.isValidationError()) {
    return `❌ Message format error: ${error.slackError}. The response may be too long or contain invalid formatting.`;
  }

  if (error instanceof SessionOwnershipError) {
    return `❌ This thread belongs to another user. Only the thread creator can interact with the bot.`;
  }

  if (error instanceof WorkerNotConnectedError) {
    return `❌ Worker is not available. Please try again in a moment.`;
  }

  if (error instanceof DispatcherError) {
    return `❌ Error: ${error.message}`;
  }

  return `❌ An unexpected error occurred. Please try again.`;
}
