import {
  createLogger,
  type IMessageQueue,
  type IRedisClient,
  RedisClient,
} from "@peerbot/core";

const logger = createLogger("mcp-input-store");

export interface InputValues {
  [inputId: string]: string;
}

/**
 * Storage for MCP input credentials (PATs, API keys, etc.)
 * Unlike OAuth tokens, these don't expire so we store them without TTL
 */
export class McpInputStore {
  private redis: IRedisClient;
  private static KEY_PREFIX = "mcp:inputs";

  constructor(queue: IMessageQueue) {
    this.redis = new RedisClient(queue.getRedisClient());
  }

  /**
   * Store input values for a user and MCP server
   * No TTL - these are persistent until explicitly deleted
   */
  async set(userId: string, mcpId: string, inputs: InputValues): Promise<void> {
    const key = this.buildKey(userId, mcpId);
    try {
      await this.redis.set(key, JSON.stringify(inputs));
      logger.info(`Stored inputs for user ${userId}, MCP ${mcpId}`);
    } catch (error) {
      logger.error("Failed to store inputs", { error, userId, mcpId });
      throw new Error("Failed to store inputs");
    }
  }

  /**
   * Retrieve input values for a user and MCP server
   */
  async get(userId: string, mcpId: string): Promise<InputValues | null> {
    const key = this.buildKey(userId, mcpId);
    try {
      const value = await this.redis.get(key);
      if (!value) {
        return null;
      }
      return JSON.parse(value) as InputValues;
    } catch (error) {
      logger.error("Failed to get inputs", { error, userId, mcpId });
      return null;
    }
  }

  /**
   * Delete input values for a user and MCP server
   */
  async delete(userId: string, mcpId: string): Promise<void> {
    const key = this.buildKey(userId, mcpId);
    try {
      await this.redis.del(key);
      logger.info(`Deleted inputs for user ${userId}, MCP ${mcpId}`);
    } catch (error) {
      logger.error("Failed to delete inputs", { error, userId, mcpId });
    }
  }

  /**
   * Check if user has inputs stored for an MCP server
   */
  async has(userId: string, mcpId: string): Promise<boolean> {
    const values = await this.get(userId, mcpId);
    return values !== null;
  }

  /**
   * Build Redis key for input storage
   */
  private buildKey(userId: string, mcpId: string): string {
    return `${McpInputStore.KEY_PREFIX}:${userId}:${mcpId}`;
  }
}
