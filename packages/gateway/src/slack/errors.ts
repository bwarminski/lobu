#!/usr/bin/env bun

import { DispatcherError } from "../errors";

/**
 * Slack API errors
 */
export class SlackApiError extends DispatcherError {
  constructor(
    message: string,
    public readonly slackError: string,
    public readonly data?: unknown
  ) {
    super(message, `SLACK_API_${slackError.toUpperCase()}`, 502);
  }

  isRetryable(): boolean {
    // Retry on rate limits and transient errors
    const retryableErrors = [
      "rate_limited",
      "timeout",
      "service_unavailable",
      "internal_error",
    ];
    return retryableErrors.includes(this.slackError);
  }

  /**
   * Check if this is a validation error (non-retryable)
   */
  isValidationError(): boolean {
    const validationErrors = [
      "invalid_blocks",
      "msg_too_long",
      "invalid_arguments",
      "invalid_array_arg",
    ];
    return validationErrors.includes(this.slackError);
  }

  toJSON() {
    return {
      ...super.toJSON(),
      slackError: this.slackError,
      data: this.data,
      isValidationError: this.isValidationError(),
    };
  }
}

/**
 * Error factory for creating errors from Slack API responses
 */
export function createSlackError(error: unknown): SlackApiError {
  if (typeof error === "object" && error !== null) {
    const errorObj = error as {
      code?: string;
      data?: { error?: string };
      message?: string;
    };

    const slackErrorCode = errorObj.data?.error || errorObj.code || "unknown";
    const message = errorObj.message || `Slack API error: ${slackErrorCode}`;

    return new SlackApiError(message, slackErrorCode, errorObj.data);
  }

  return new SlackApiError(String(error), "unknown", undefined);
}
