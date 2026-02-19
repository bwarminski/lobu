/**
 * Slack installation store for multi-workspace OAuth distribution.
 * Stores per-workspace bot tokens and metadata in Redis.
 */

import { BaseRedisStore, createLogger } from "@lobu/core";
import type { AuthorizeResult } from "@slack/bolt";
import type Redis from "ioredis";

const logger = createLogger("slack-installation-store");

export interface SlackInstallation {
  teamId: string;
  teamName: string;
  botToken: string;
  botUserId: string;
  botId: string;
  installedBy: string;
  installedAt: number;
  appId: string;
}

export class SlackInstallationStore extends BaseRedisStore<SlackInstallation> {
  constructor(redis: Redis) {
    super({
      redis,
      keyPrefix: "slack:installation",
      loggerName: "slack-installation-store",
    });
  }

  protected override validate(value: SlackInstallation): boolean {
    return !!(value.teamId && value.botToken && value.botUserId);
  }

  async getInstallation(teamId: string): Promise<SlackInstallation | null> {
    const key = this.buildKey(teamId);
    return this.get(key);
  }

  async setInstallation(
    teamId: string,
    data: SlackInstallation
  ): Promise<void> {
    const key = this.buildKey(teamId);
    await this.set(key, data);
  }

  async deleteInstallation(teamId: string): Promise<void> {
    const key = this.buildKey(teamId);
    await this.delete(key);
  }

  async getTokenForTeam(teamId: string): Promise<string | null> {
    const installation = await this.getInstallation(teamId);
    return installation?.botToken ?? null;
  }
}

/**
 * Create a Bolt-compatible authorize callback that resolves tokens from the store.
 * Falls back to a static token when no installation is found (backward compat).
 */
export function createAuthorize(
  store: SlackInstallationStore,
  fallbackToken?: string
): (source: {
  teamId?: string;
  enterpriseId?: string;
}) => Promise<AuthorizeResult> {
  return async (source) => {
    const teamId = source.teamId;
    if (teamId) {
      const installation = await store.getInstallation(teamId);
      if (installation) {
        return {
          botToken: installation.botToken,
          botId: installation.botId,
          botUserId: installation.botUserId,
          teamId: installation.teamId,
        };
      }
    }

    if (fallbackToken) {
      logger.warn(
        `No installation found for team ${teamId}, using fallback token`
      );
      // Resolve botId/botUserId via auth.test so Bolt can identify its own messages
      let botId = "";
      let botUserId = "";
      try {
        const resp = await fetch("https://slack.com/api/auth.test", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${fallbackToken}`,
            "Content-Type": "application/json",
          },
        });
        const data = (await resp.json()) as {
          ok: boolean;
          bot_id?: string;
          user_id?: string;
        };
        if (data.ok) {
          botId = data.bot_id || "";
          botUserId = data.user_id || "";
        }
      } catch {
        logger.warn("Could not resolve bot info for fallback token");
      }
      return {
        botToken: fallbackToken,
        botId,
        botUserId,
        teamId: teamId || "",
      };
    }

    throw new Error(
      `No Slack installation found for team ${teamId} and no fallback token configured`
    );
  };
}
