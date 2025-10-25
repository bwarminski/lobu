import { createLogger } from "@peerbot/core";
import type Redis from "ioredis";

const logger = createLogger("claude-model-preference");

/**
 * Store and retrieve user's Claude model preference from Redis
 * Pattern: claude:model_preference:{userId}
 */
export class ClaudeModelPreferenceStore {
  constructor(private redis: Redis) {}

  /**
   * Set user's model preference
   */
  async setModelPreference(userId: string, model: string): Promise<void> {
    const key = this.getKey(userId);
    await this.redis.set(key, model);
    logger.info(`Set model preference for user ${userId}: ${model}`);
  }

  /**
   * Get user's model preference
   * Returns null if no preference is set
   */
  async getModelPreference(userId: string): Promise<string | null> {
    const key = this.getKey(userId);
    const model = await this.redis.get(key);
    return model;
  }

  /**
   * Delete user's model preference
   */
  async deleteModelPreference(userId: string): Promise<void> {
    const key = this.getKey(userId);
    await this.redis.del(key);
    logger.info(`Deleted model preference for user ${userId}`);
  }

  private getKey(userId: string): string {
    return `claude:model_preference:${userId}`;
  }

  public async getAvailableModels(): Promise<any[]> {
    return [
      {
        id: "claude-sonnet-4-5",
        display_name: "Claude Sonnet 4.5",
        type: "model",
      },
      {
        id: "claude-haiku-4-5",
        display_name: "Claude Haiku 4.5",
        type: "model",
      },
      {
        id: "claude-opus-4-1",
        display_name: "Claude Opus 4.1",
        type: "model",
      },
    ];
  }
}
