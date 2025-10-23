import type { SessionContext } from "./types";

/**
 * Session utilities shared across packages
 */
export class SessionUtils {
  /**
   * Generate session key from context
   */
  static generateSessionKey(context: SessionContext): string {
    // Use thread ID as the session key (if in a thread)
    // Otherwise use message ID
    const id = context.threadId || context.messageId || "";

    // If we have a thread ID, use it directly as the session key
    // This ensures consistency across all worker executions in the same thread
    if (context.threadId) {
      return context.threadId;
    }

    // For direct messages (no thread), use the channel and message ID
    return `${context.channelId}-${id}`;
  }
}
