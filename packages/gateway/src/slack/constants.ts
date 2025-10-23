#!/usr/bin/env bun

/**
 * Slack-specific constants
 */

export const SLACK = {
  /** Maximum number of blocks in a Slack message */
  MAX_BLOCKS: 50,
  /** Maximum characters per block text */
  MAX_BLOCK_TEXT_LENGTH: 3000,
} as const;
