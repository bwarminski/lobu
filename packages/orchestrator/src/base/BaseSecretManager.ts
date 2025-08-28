import { OrchestratorConfig } from '../types';

export abstract class BaseSecretManager {
  protected config: OrchestratorConfig;

  constructor(config: OrchestratorConfig) {
    this.config = config;
  }

  /**
   * Get existing password from secret or create new user credentials
   */
  abstract getOrCreateUserCredentials(username: string, createPostgresUser: (username: string, password: string) => Promise<void>): Promise<string>;

  /**
   * Create or update user secret with PostgreSQL credentials
   */
  abstract createUserSecret(username: string, password: string): Promise<void>;

  /**
   * Delete user secret
   */
  abstract deleteUserSecret(username: string): Promise<void>;

  /**
   * Generate a random password
   */
  protected generatePassword(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let password = '';
    for (let i = 0; i < 32; i++) {
      password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
  }
}