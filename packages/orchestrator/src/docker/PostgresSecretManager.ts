import { BaseSecretManager } from "../base/BaseSecretManager";
import { OrchestratorConfig, OrchestratorError, ErrorCode } from "../types";
import { DatabasePool } from "../db-connection-pool";

export class PostgresSecretManager extends BaseSecretManager {
  private dbPool: DatabasePool;

  constructor(config: OrchestratorConfig, dbPool: DatabasePool) {
    super(config);
    this.dbPool = dbPool;
  }

  /**
   * Get existing password from database or create new user credentials
   */
  async getOrCreateUserCredentials(
    username: string,
    createPostgresUser: (username: string, password: string) => Promise<void>,
  ): Promise<string> {
    try {
      // First ensure the user exists in the users table
      const platformUserId = username.toUpperCase(); // Convert back to original format
      const userResult = await this.dbPool.query(
        `INSERT INTO users (platform, platform_user_id, created_at, updated_at) 
         VALUES ('slack', $1, NOW(), NOW())
         ON CONFLICT (platform, platform_user_id) 
         DO UPDATE SET updated_at = NOW()
         RETURNING id`,
        [platformUserId],
      );
      const userId = userResult.rows[0].id;

      // Try to read existing credentials from database
      const result = await this.dbPool.query(
        `SELECT value as password FROM user_environ WHERE user_id = $1 AND name = 'PEERBOT_DATABASE_PASSWORD'`,
        [userId],
      );

      if (result.rows.length > 0 && result.rows[0].password) {
        const existingPassword = result.rows[0].password;
        console.log(`Found existing credentials for user ${username}`);
        return existingPassword;
      }
    } catch (error) {
      console.log(
        `Error reading existing credentials for ${username}, creating new ones:`,
        error,
      );
    }

    // Generate new credentials
    const password = this.generatePassword();

    console.log(`Creating new credentials for user ${username}`);
    await createPostgresUser(username, password);
    await this.storeUserCredentials(username, password);
    return password;
  }

  /**
   * Store user credentials in database as individual environment variables
   * This is a private method that should only be called from getOrCreateUserCredentials
   */
  async storeUserCredentials(
    username: string,
    password: string,
  ): Promise<void> {
    try {
      // First get the user_id from the users table
      const platformUserId = username.toUpperCase(); // Convert back to original format
      const userResult = await this.dbPool.query(
        `SELECT id FROM users WHERE platform = 'slack' AND platform_user_id = $1`,
        [platformUserId],
      );

      if (userResult.rows.length === 0) {
        throw new Error(`User not found: ${platformUserId}`);
      }

      const userId = userResult.rows[0].id;

      // Parse the DATABASE_URL to extract components and reconstruct with user credentials
      const dbUrl = new URL(this.config.database.connectionString);
      dbUrl.username = username;
      dbUrl.password = password;

      // Store each credential as a separate row in user_environ
      const credentials = [
        { name: 'PEERBOT_DATABASE_URL', value: dbUrl.toString(), type: 'system' },
        { name: 'PEERBOT_DATABASE_USERNAME', value: username, type: 'system' },
        { name: 'PEERBOT_DATABASE_PASSWORD', value: password, type: 'system' }
      ];

      // Insert or update each environment variable
      for (const cred of credentials) {
        await this.dbPool.query(
          `
          INSERT INTO user_environ (user_id, name, value, type, created_at, updated_at) 
          VALUES ($1, $2, $3, $4, NOW(), NOW())
          ON CONFLICT (user_id, name) 
          DO UPDATE SET 
            value = EXCLUDED.value,
            type = EXCLUDED.type,
            updated_at = NOW()
        `,
          [userId, cred.name, cred.value, cred.type],
        );
      }

      console.log(
        `✅ Stored permanent credentials in database for user: ${username}`,
      );
    } catch (error) {
      throw new OrchestratorError(
        ErrorCode.DEPLOYMENT_CREATE_FAILED,
        `Failed to store user credentials in database: ${error instanceof Error ? error.message : String(error)}`,
        { username, error },
        true,
      );
    }
  }
}
