import type { IMessageQueue } from "@peerbot/core";
import { BaseRedisStore } from "../utils/redis-store";

export interface McpCredentialRecord {
  accessToken: string;
  tokenType?: string;
  expiresAt?: number;
  refreshToken?: string;
  metadata?: Record<string, unknown>;
}

export class McpCredentialStore extends BaseRedisStore<McpCredentialRecord> {
  protected readonly keyPrefix = "mcp:credential";

  constructor(queue: IMessageQueue) {
    super(queue, "mcp-credentials");
  }

  async getCredentials(
    userId: string,
    mcpId: string
  ): Promise<McpCredentialRecord | null> {
    const key = this.buildKey(userId, mcpId);
    return this.get(key);
  }

  async setCredentials(
    userId: string,
    mcpId: string,
    record: McpCredentialRecord,
    ttlSeconds?: number
  ): Promise<void> {
    const key = this.buildKey(userId, mcpId);
    return this.set(key, record, ttlSeconds);
  }

  async deleteCredentials(userId: string, mcpId: string): Promise<void> {
    const key = this.buildKey(userId, mcpId);
    return this.delete(key);
  }
}
