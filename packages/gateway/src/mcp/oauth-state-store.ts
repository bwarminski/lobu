import type { IMessageQueue } from "@peerbot/core";
import { randomBytes } from "node:crypto";
import { BaseRedisStore } from "../utils/redis-store";

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
export class OAuthStateStore extends BaseRedisStore<OAuthStateData> {
  protected readonly keyPrefix = "mcp:oauth:state";
  private static readonly STATE_TTL_SECONDS = 300; // 5 minutes

  constructor(queue: IMessageQueue) {
    super(queue, "mcp-oauth-state");
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
    await super.set(key, stateData, OAuthStateStore.STATE_TTL_SECONDS);
    this.logger.info(
      `Created OAuth state for user ${data.userId}, MCP ${data.mcpId}`
    );
    return state;
  }

  /**
   * Retrieve and validate state data
   * Automatically deletes the state after retrieval (one-time use)
   */
  async consume(state: string): Promise<OAuthStateData | null> {
    const key = this.buildKey(state);
    const data = await super.get(key);

    if (!data) {
      this.logger.warn(`Invalid or expired OAuth state: ${state}`);
      return null;
    }

    // Delete the state immediately (one-time use)
    await super.delete(key);

    // Validate timestamp (extra safety check)
    const age = Date.now() - data.timestamp;
    if (age > OAuthStateStore.STATE_TTL_SECONDS * 1000) {
      this.logger.warn(`OAuth state expired (age: ${age}ms)`);
      return null;
    }

    this.logger.info(
      `Consumed OAuth state for user ${data.userId}, MCP ${data.mcpId}`
    );
    return data;
  }

  /**
   * Generate cryptographically secure state parameter
   */
  private generateSecureState(): string {
    return randomBytes(32).toString("base64url");
  }
}
