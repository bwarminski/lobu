/**
 * Slack-specific configuration and constants
 */

import type { AgentOptions as CoreAgentOptions } from "@peerbot/core";
import type { LogLevel } from "@slack/bolt";

// ============================================================================
// Constants
// ============================================================================

export const SLACK = {
  /** Maximum number of blocks in a Slack message */
  MAX_BLOCKS: 50,
  /** Maximum characters per block text */
  MAX_BLOCK_TEXT_LENGTH: 3000,
} as const;

// ============================================================================
// Types
// ============================================================================

export type AgentOptions = CoreAgentOptions;

export interface SlackConfig {
  token: string;
  appToken?: string;
  signingSecret?: string;
  socketMode: boolean;
  port: number;
  botUserId?: string;
  botId?: string;
  apiUrl: string;
}

/**
 * Platform-agnostic configuration needed by Slack platform
 */
export interface SlackPlatformConfig {
  slack: SlackConfig;
  logLevel: LogLevel;
  health: {
    checkIntervalMs: number;
    staleThresholdMs: number;
    protectActiveWorkers: boolean;
  };
}

/**
 * Message handler configuration
 */
export interface MessageHandlerConfig {
  slack: SlackConfig;
  agentOptions: AgentOptions;
  sessionTimeoutMinutes: number;
}
