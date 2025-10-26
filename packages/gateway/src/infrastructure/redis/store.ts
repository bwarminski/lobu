import { createLogger } from "@peerbot/core";
import type Redis from "ioredis";
import type { IMessageQueue } from "../queue";

/**
 * Base class for Redis-backed stores
 * Provides common get/set/delete operations with JSON serialization
 */
export abstract class BaseRedisStore<T> {
  protected redis: Redis;
  protected logger: ReturnType<typeof createLogger>;
  protected abstract readonly keyPrefix: string;

  constructor(queue: IMessageQueue, loggerName: string) {
    this.redis = queue.getRedisClient();
    this.logger = createLogger(loggerName);
  }

  /**
   * Build Redis key from parts
   */
  protected buildKey(...parts: string[]): string {
    return [this.keyPrefix, ...parts].join(":");
  }

  /**
   * Get value from Redis
   */
  protected async get(key: string): Promise<T | null> {
    try {
      const value = await this.redis.get(key);
      if (!value) {
        return null;
      }
      return JSON.parse(value) as T;
    } catch (error) {
      this.logger.error("Failed to get from Redis", { error, key });
      return null;
    }
  }

  /**
   * Set value in Redis
   */
  protected async set(
    key: string,
    value: T,
    ttlSeconds?: number
  ): Promise<void> {
    try {
      if (ttlSeconds) {
        await this.redis.setex(key, ttlSeconds, JSON.stringify(value));
      } else {
        await this.redis.set(key, JSON.stringify(value));
      }
    } catch (error) {
      this.logger.error("Failed to set in Redis", { error, key });
      throw error;
    }
  }

  /**
   * Delete value from Redis
   */
  protected async delete(key: string): Promise<void> {
    try {
      await this.redis.del(key);
    } catch (error) {
      this.logger.error("Failed to delete from Redis", { error, key });
    }
  }
}
