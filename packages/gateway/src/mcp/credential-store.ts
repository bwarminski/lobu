import { RedisClient, type IMessageQueue, type IRedisClient } from "@peerbot/core";
import { createLogger } from "@peerbot/core";

const logger = createLogger("mcp-credentials");

export interface McpCredentialRecord {
  accessToken: string;
  tokenType?: string;
  expiresAt?: number;
  refreshToken?: string;
  metadata?: Record<string, unknown>;
}

export class McpCredentialStore {
  private redis: IRedisClient;
  private static KEY_PREFIX = "mcp:credential";

  constructor(queue: IMessageQueue) {
    this.redis = new RedisClient(queue.getRedisClient());
  }

  async get(userId: string, mcpId: string): Promise<McpCredentialRecord | null> {
    const key = this.buildKey(userId, mcpId);
    try {
      const value = await this.redis.get(key);
      if (!value) {
        return null;
      }
      return JSON.parse(value) as McpCredentialRecord;
    } catch (error) {
      logger.error("Failed to fetch MCP credentials", { error, key });
      return null;
    }
  }

  async set(
    userId: string,
    mcpId: string,
    record: McpCredentialRecord,
    ttlSeconds?: number
  ): Promise<void> {
    const key = this.buildKey(userId, mcpId);
    try {
      await this.redis.set(key, JSON.stringify(record), ttlSeconds);
    } catch (error) {
      logger.error("Failed to store MCP credentials", { error, key });
      throw error;
    }
  }

  async delete(userId: string, mcpId: string): Promise<void> {
    const key = this.buildKey(userId, mcpId);
    try {
      await this.redis.del(key);
    } catch (error) {
      logger.error("Failed to delete MCP credentials", { error, key });
    }
  }

  private buildKey(userId: string, mcpId: string): string {
    return `${McpCredentialStore.KEY_PREFIX}:${userId}:${mcpId}`;
  }
}
