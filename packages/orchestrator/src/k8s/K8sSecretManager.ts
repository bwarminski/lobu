import type * as k8s from "@kubernetes/client-node";
import { BaseSecretManager } from "../base/BaseSecretManager";
import { ErrorCode, OrchestratorError } from "../types";

export class K8sSecretManager extends BaseSecretManager {
  private coreV1Api?: k8s.CoreV1Api;

  // Method to set the CoreV1Api after construction
  setCoreV1Api(coreV1Api: k8s.CoreV1Api): void {
    this.coreV1Api = coreV1Api;
  }

  private ensureCoreV1Api(): k8s.CoreV1Api {
    if (!this.coreV1Api) {
      throw new Error("CoreV1Api not initialized. Call setCoreV1Api first.");
    }
    return this.coreV1Api;
  }

  /**
   * Get existing password from secret or create new user credentials
   */
  async getOrCreateUserCredentials(
    username: string,
    createPostgresUser: (username: string, password: string) => Promise<void>
  ): Promise<string> {
    const secretName = `peerbot-user-secret-${username.replace(/[^a-zA-Z0-9]/g, "-").toLowerCase()}`;
    const coreV1Api = this.ensureCoreV1Api();

    try {
      // Try to read existing secret first
      const existingSecret = await coreV1Api.readNamespacedSecret(
        secretName,
        this.config.kubernetes.namespace
      );
      const existingPassword = Buffer.from(
        existingSecret.body.data?.PEERBOT_DATABASE_PASSWORD || "",
        "base64"
      ).toString();

      if (existingPassword) {
        console.log(
          `Found existing secret for user ${username}, ensuring database user exists`
        );
        // Ensure the database user exists (in case database was recreated)
        try {
          await createPostgresUser(username, existingPassword);
          console.log(`Ensured database user ${username} exists`);
        } catch (error: any) {
          // User might already exist, which is fine
          if (!error.message?.includes("already exists")) {
            console.error(`Failed to ensure database user ${username}:`, error.message);
            throw error;
          }
        }
        return existingPassword;
      }
    } catch (_error) {
      // Secret doesn't exist, will create new credentials
      console.log(
        `Secret ${secretName} does not exist, creating new credentials`
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
   * Create Kubernetes secret with PostgreSQL credentials
   * This is a private method that should only be called from getOrCreateUserCredentials
   */
  async storeUserCredentials(
    username: string,
    password: string
  ): Promise<void> {
    const secretName = `peerbot-user-secret-${username.replace(/[^a-zA-Z0-9]/g, "-").toLowerCase()}`;
    const coreV1Api = this.ensureCoreV1Api();

    try {
      const secretData = {
        PEERBOT_DATABASE_USERNAME: Buffer.from(username).toString("base64"),
        PEERBOT_DATABASE_PASSWORD: Buffer.from(password).toString("base64"),
      };

      const secret = {
        apiVersion: "v1",
        kind: "Secret",
        metadata: {
          name: secretName,
          namespace: this.config.kubernetes.namespace,
          labels: {
            "app.kubernetes.io/name": "peerbot",
            "app.kubernetes.io/component": "worker",
            "peerbot/managed-by": "orchestrator",
            "peerbot/permanent": "true", // Mark as permanent to prevent deletion
          },
        },
        type: "Opaque",
        data: secretData,
      };

      await coreV1Api.createNamespacedSecret(
        this.config.kubernetes.namespace,
        secret
      );
      console.log(`✅ Created permanent secret: ${secretName}`);
    } catch (error) {
      throw new OrchestratorError(
        ErrorCode.DEPLOYMENT_CREATE_FAILED,
        `Failed to create user secret: ${error instanceof Error ? error.message : String(error)}`,
        { username, secretName, error },
        true
      );
    }
  }
}
