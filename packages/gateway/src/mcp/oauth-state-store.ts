import {
  createLogger,
  type IMessageQueue,
  type IRedisClient,
  RedisClient,
} from "@peerbot/core";
import { randomBytes } from "node:crypto";

const logger = createLogger("mcp-oauth-state");

export interface OAuthStateData {
  userId: string;
  mcpId: string;
  timestamp: number;
  nonce: string;
  redirectPath?: string;
}

/**
 * Secure storage for OAuth state parameters to prevent CSRF attacks
 * States expire after 5 minutes
 */
export class OAuthStateStore {
  private redis: IRedisClient;
  private static KEY_PREFIX = "mcp:oauth:state";
  private static STATE_TTL_SECONDS = 300; // 5 minutes

  constructor(queue: IMessageQueue) {
    this.redis = new RedisClient(queue.getRedisClient());
  }

  /**
   * Generate a secure state parameter and store the associated data
   * Returns the state string to be used in OAuth redirect
   */
  async create(
    data: Omit<OAuthStateData, "timestamp" | "nonce">
  ): Promise<string> {
    const state = this.generateSecureState();
    const stateData: OAuthStateData = {
      ...data,
      timestamp: Date.now(),
      nonce: randomBytes(16).toString("hex"),
    };

    const key = this.buildKey(state);
    try {
      await this.redis.set(
        key,
        JSON.stringify(stateData),
        OAuthStateStore.STATE_TTL_SECONDS
      );
      logger.info(
        `Created OAuth state for user ${data.userId}, MCP ${data.mcpId}`
      );
      return state;
    } catch (error) {
      logger.error("Failed to store OAuth state", { error, state });
      throw new Error("Failed to create OAuth state");
    }
  }

  /**
   * Retrieve and validate state data
   * Automatically deletes the state after retrieval (one-time use)
   */
  async consume(state: string): Promise<OAuthStateData | null> {
    const key = this.buildKey(state);
    try {
      const value = await this.redis.get(key);
      if (!value) {
        logger.warn(`Invalid or expired OAuth state: ${state}`);
        return null;
      }

      // Delete the state immediately (one-time use)
      await this.redis.del(key);

      const data = JSON.parse(value) as OAuthStateData;

      // Validate timestamp (extra safety check)
      const age = Date.now() - data.timestamp;
      if (age > OAuthStateStore.STATE_TTL_SECONDS * 1000) {
        logger.warn(`OAuth state expired (age: ${age}ms)`);
        return null;
      }

      logger.info(
        `Consumed OAuth state for user ${data.userId}, MCP ${data.mcpId}`
      );
      return data;
    } catch (error) {
      logger.error("Failed to consume OAuth state", { error, state });
      return null;
    }
  }

  /**
   * Generate cryptographically secure state parameter
   */
  private generateSecureState(): string {
    return randomBytes(32).toString("base64url");
  }

  /**
   * Build Redis key for state
   */
  private buildKey(state: string): string {
    return `${OAuthStateStore.KEY_PREFIX}:${state}`;
  }
}
