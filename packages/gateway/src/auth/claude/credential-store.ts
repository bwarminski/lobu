import { BaseCredentialStore } from "@peerbot/core";
import type Redis from "ioredis";

export interface ClaudeCredentials {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  expiresAt: number; // Unix timestamp in milliseconds
  scopes: string[];
}

/**
 * Store and retrieve Claude OAuth credentials from Redis
 * Pattern: claude:credential:{spaceId}
 */
export class ClaudeCredentialStore extends BaseCredentialStore<ClaudeCredentials> {
  constructor(redis: Redis) {
    super({
      redis,
      keyPrefix: "claude:credential",
      loggerName: "claude-credential-store",
    });
  }

  /**
   * Store Claude credentials for a space
   */
  async setCredentials(
    spaceId: string,
    credentials: ClaudeCredentials
  ): Promise<void> {
    const key = this.buildKey(spaceId);
    await this.set(key, credentials);

    this.logger.info(`Stored Claude credentials for space ${spaceId}`, {
      expiresAt: new Date(credentials.expiresAt).toISOString(),
      scopes: credentials.scopes,
    });
  }

  /**
   * Get Claude credentials for a space
   * Returns null if not found or if credentials are missing required fields
   */
  async getCredentials(spaceId: string): Promise<ClaudeCredentials | null> {
    const key = this.buildKey(spaceId);
    const credentials = await this.get(key);

    if (!credentials) {
      this.logger.debug(`No Claude credentials found for space ${spaceId}`);
    }

    return credentials;
  }

  /**
   * Delete Claude credentials for a space
   */
  async deleteCredentials(spaceId: string): Promise<void> {
    const key = this.buildKey(spaceId);
    await this.delete(key);
    this.logger.info(`Deleted Claude credentials for space ${spaceId}`);
  }

  /**
   * Check if space has Claude credentials
   */
  async hasCredentials(spaceId: string): Promise<boolean> {
    const key = this.buildKey(spaceId);
    return this.exists(key);
  }
}
