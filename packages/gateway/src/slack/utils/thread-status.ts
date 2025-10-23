import { createLogger } from "@peerbot/core";

const logger = createLogger("thread-status");

/**
 * Set thread status using assistant.threads.setStatus API
 * Shared utility to avoid duplication
 */
export async function setThreadStatus(
  client: any,
  channelId: string,
  threadTs: string,
  status?: string,
  loadingMessages?: string[]
): Promise<void> {
  if (!threadTs) {
    return;
  }

  try {
    const payload: Record<string, any> = {
      channel_id: channelId,
      thread_ts: threadTs,
      status: status ?? "",
    };

    if (loadingMessages && loadingMessages.length > 0) {
      payload.loading_messages = loadingMessages;
    }

    await client.apiCall("assistant.threads.setStatus", payload);
  } catch (error) {
    logger.warn(
      `Failed to set status '${status || "<clear>"}' for thread ${threadTs}:`,
      error
    );
  }
}
