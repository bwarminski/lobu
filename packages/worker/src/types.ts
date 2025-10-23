#!/usr/bin/env bun

export interface WorkerConfig {
  sessionKey: string;
  userId: string;
  channelId: string;
  threadId?: string;
  userPrompt: string; // Base64 encoded
  responseChannel: string; // Platform-agnostic response channel
  responseId: string; // Platform-agnostic response message ID
  botResponseId?: string; // Bot's response message ID for updates
  agentOptions: string; // JSON string
  sessionId?: string; // Claude session ID for new sessions
  resumeSessionId?: string; // Claude session ID to resume from
  teamId?: string; // Platform team/workspace ID (e.g., Slack team ID)
  platform?: string; // Platform identifier (e.g., "slack", "discord")
  workspace: {
    baseDirectory: string;
  };
}

export interface WorkspaceSetupConfig {
  baseDirectory: string;
}

export interface WorkspaceInfo {
  baseDirectory: string;
  userDirectory: string;
}

// Re-export from shared package
export { SlackError, WorkerError, WorkspaceError } from "@peerbot/core";
