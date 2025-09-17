import logger from "../logger";

/**
 * Centralized error handler utility to reduce duplicate error handling code
 */
export class ErrorHandler {
  /**
   * Log and handle an error with consistent formatting
   */
  static logAndHandle(
    action: string,
    error: any,
    context?: Record<string, any>
  ): void {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorDetails = {
      action,
      errorMessage,
      ...context,
      stack: error instanceof Error ? error.stack : undefined,
    };

    logger.error(`Failed to ${action}`, errorDetails);
  }

  /**
   * Log error and return a safe default value
   */
  static logAndReturn<T>(
    action: string,
    error: any,
    defaultValue: T,
    context?: Record<string, any>
  ): T {
    ErrorHandler.logAndHandle(action, error, context);
    return defaultValue;
  }

  /**
   * Create a Slack-friendly error message
   */
  static formatSlackError(error: any, prefix = "Error"): string {
    const message =
      error instanceof Error ? error.message : "Unknown error occurred";
    return `❌ *${prefix}:* ${message}`;
  }

  /**
   * Wrap an async function with error handling
   */
  static async wrap<T>(
    action: string,
    fn: () => Promise<T>,
    defaultValue?: T,
    context?: Record<string, any>
  ): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      ErrorHandler.logAndHandle(action, error, context);
      if (defaultValue !== undefined) {
        return defaultValue;
      }
      throw error;
    }
  }

  /**
   * Check if error is retryable
   */
  static isRetryable(error: any): boolean {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      return (
        message.includes("timeout") ||
        message.includes("econnreset") ||
        message.includes("econnrefused") ||
        message.includes("network")
      );
    }
    return false;
  }
}
