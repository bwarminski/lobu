import { Pool, type PoolClient } from "pg";
import { createLogger } from "../logger";

const logger = createLogger("shared");

export interface DatabaseConfig {
  connectionString: string;
  max?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
}

/**
 * Generic database error for shared utilities
 */
export class DatabaseError extends Error {
  constructor(
    message: string,
    public originalError?: any,
    public shouldRetry: boolean = false
  ) {
    super(message);
    this.name = "DatabaseError";
  }

  static fromError(error: any): DatabaseError {
    return new DatabaseError(
      `Database error: ${error instanceof Error ? error.message : String(error)}`,
      error,
      true
    );
  }
}

export class DatabasePool {
  private pool: Pool;

  constructor(config: DatabaseConfig | string) {
    const dbConfig = typeof config === 'string' 
      ? { connectionString: config }
      : config;
      
    this.pool = new Pool({
      connectionString: dbConfig.connectionString,
      max: dbConfig.max ?? 20,
      idleTimeoutMillis: dbConfig.idleTimeoutMillis ?? 30000,
      connectionTimeoutMillis: dbConfig.connectionTimeoutMillis ?? 10000,
    });

    this.pool.on("error", (err) => {
      logger.error("Database pool error:", err);
    });
  }

  async getClient(): Promise<PoolClient> {
    try {
      return await this.pool.connect();
    } catch (error) {
      throw DatabaseError.fromError(error);
    }
  }

  async query(text: string, params?: any[]): Promise<any> {
    try {
      const result = await this.pool.query(text, params);
      return result;
    } catch (error) {
      throw DatabaseError.fromError(error);
    }
  }

  async queryWithUserContext(
    userId: string,
    text: string,
    params?: any[]
  ): Promise<any> {
    const client = await this.getClient();
    try {
      // Set user context for RLS
      await client.query("SELECT set_config($1, $2, true)", [
        "app.current_user_id",
        userId,
      ]);
      const result = await client.query(text, params);
      return result;
    } catch (error) {
      throw DatabaseError.fromError(error);
    } finally {
      client.release();
    }
  }

  async transactionWithUserContext<T>(
    userId: string,
    callback: (client: PoolClient) => Promise<T>
  ): Promise<T> {
    const client = await this.getClient();
    try {
      await client.query("BEGIN");
      // Set user context for RLS
      await client.query("SELECT set_config($1, $2, true)", [
        "app.current_user_id",
        userId,
      ]);
      const result = await callback(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw DatabaseError.fromError(error);
    } finally {
      client.release();
    }
  }

  /**
   * Update job status in database
   */
  async updateJobStatus(
    jobId: string,
    status: string,
    output?: any,
    errorMessage?: string
  ): Promise<void> {
    try {
      await this.query("SELECT update_job_status($1, $2, $3, $4)", [
        jobId,
        status,
        output ? JSON.stringify(output) : null,
        errorMessage,
      ]);
    } catch (error) {
      logger.error(`Failed to update job status for ${jobId}:`, error);
      // Don't throw - job status updates are best effort
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  /**
   * Get the underlying pg.Pool instance for compatibility
   */
  getPool(): Pool {
    return this.pool;
  }
}

// Simple factory function for backward compatibility with dispatcher
let globalPool: Pool | null = null;

export function getDbPool(connectionString?: string): Pool {
  if (!globalPool) {
    globalPool = new Pool({
      connectionString: connectionString || process.env.DATABASE_URL,
    });
  }
  return globalPool;
}