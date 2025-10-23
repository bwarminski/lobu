#!/usr/bin/env bun

/**
 * Gateway core types (platform-agnostic)
 * Slack-specific types are in slack/types.ts
 */

export interface ThreadSession {
  sessionKey: string;
  threadId?: string;
  channelId: string;
  userId: string;
  threadCreator?: string; // Track the original thread creator
  jobName?: string;
  lastActivity: number;
  status:
    | "pending"
    | "starting"
    | "running"
    | "completed"
    | "error"
    | "timeout";
  createdAt: number;
  botResponseId?: string; // Bot's response message ID for updates
}
