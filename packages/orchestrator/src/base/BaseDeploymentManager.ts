import { DatabasePool } from '../database-pool';
import { DatabaseManager } from '../database-manager';
import { BaseSecretManager } from './BaseSecretManager';
import { OrchestratorConfig, OrchestratorError, ErrorCode } from '../types';

export interface DeploymentInfo {
  deploymentName: string;
  deploymentId: string;
  lastActivity: Date;
  minutesIdle: number;
  daysSinceActivity: number;
  replicas: number;
  isIdle: boolean;
  isVeryOld: boolean;
}

export abstract class BaseDeploymentManager {
  protected config: OrchestratorConfig;
  protected dbPool: DatabasePool;
  protected databaseManager: DatabaseManager;
  protected secretManager: BaseSecretManager;

  constructor(config: OrchestratorConfig, dbPool: DatabasePool, secretManager: BaseSecretManager) {
    this.config = config;
    this.dbPool = dbPool;
    this.databaseManager = new DatabaseManager(dbPool);
    this.secretManager = secretManager;
  }

  // Abstract methods that must be implemented by concrete classes
  abstract listDeployments(): Promise<DeploymentInfo[]>;
  abstract createDeployment(deploymentName: string, username: string, userId: string, messageData?: any): Promise<void>;
  abstract scaleDeployment(deploymentName: string, replicas: number): Promise<void>;
  abstract deleteDeployment(deploymentId: string): Promise<void>;
  abstract updateDeploymentActivity(deploymentName: string): Promise<void>;

  /**
   * Create worker deployment for handling messages
   */
  async createWorkerDeployment(userId: string, threadId: string, teamId?: string, messageData?: any): Promise<void> {
    const deploymentName = `peerbot-worker-${threadId}`;
    
    try {
      // Always ensure user credentials exist first
      const username = this.databaseManager.generatePostgresUsername(userId);
      
      console.log(`Ensuring PostgreSQL user and secret for ${username}...`);
      
      // Check if secret already exists and get existing password, or generate new one
      await this.secretManager.getOrCreateUserCredentials(username, 
        (username: string, password: string) => this.databaseManager.createPostgresUser(username, password));

      // Check if deployment already exists by getting the list and filtering
      const deployments = await this.listDeployments();
      const existingDeployment = deployments.find(d => d.deploymentName === deploymentName);
      
      if (existingDeployment) {
        console.log(`Deployment ${deploymentName} already exists, scaling to 1`);
        await this.scaleDeployment(deploymentName, 1);
        return;
      }

      console.log(`Creating deployment ${deploymentName}...`);
      await this.createDeployment(deploymentName, username, userId, messageData);
      console.log(`✅ Successfully created deployment ${deploymentName}`);
      
    } catch (error) {
      throw new OrchestratorError(
        ErrorCode.DEPLOYMENT_CREATE_FAILED,
        `Failed to create worker deployment: ${error instanceof Error ? error.message : String(error)}`,
        { userId, threadId, error },
        true
      );
    }
  }

  /**
   * Delete a worker deployment and associated resources
   */
  async deleteWorkerDeployment(deploymentId: string): Promise<void> {
    try {
      const deploymentName = `peerbot-worker-${deploymentId}`;
      console.log(`🧹 Cleaning up idle worker deployment: ${deploymentName}`);
      
      await this.deleteDeployment(deploymentId);
      
    } catch (error) {
      throw new OrchestratorError(
        ErrorCode.DEPLOYMENT_DELETE_FAILED,
        `Failed to delete deployment for ${deploymentId}: ${error instanceof Error ? error.message : String(error)}`,
        { deploymentId, error },
        true
      );
    }
  }

  /**
   * Reconcile deployments: unified method for cleanup and resource management
   * This method uses the abstract methods to work with any deployment backend
   */
  async reconcileDeployments(): Promise<void> {
    try {
      console.log('🔄 Starting deployment reconciliation...');
      
      // Get all worker deployments from the backend
      const activeDeployments = await this.listDeployments();

      console.log(`📊 Found ${activeDeployments.length} worker deployments to reconcile`);
      
      if (activeDeployments.length === 0) {
        console.log('✅ No deployments to reconcile');
        return;
      }

      const now = Date.now();
      const idleThresholdMinutes = this.config.worker.idleCleanupMinutes;
      const maxDeployments = this.config.worker.maxDeployments || 20;
      
      // Sort deployments by last activity (oldest first)
      const sortedDeployments = [...activeDeployments].sort((a, b) => a.lastActivity.getTime() - b.lastActivity.getTime());
      
      let processedCount = 0;
      
      // Process each deployment based on its state
      for (const analysis of sortedDeployments) {
        const { deploymentName, deploymentId, minutesIdle, daysSinceActivity, replicas, isIdle, isVeryOld } = analysis;
        
        if (isVeryOld) {
          // Delete very old deployments (>= 7 days)
          console.log(`🗑️  Deleting very old deployment: ${deploymentName} (${daysSinceActivity.toFixed(1)} days old)`);
          try {
            await this.deleteWorkerDeployment(deploymentId);
            processedCount++;
            console.log(`✅ Deleted old deployment: ${deploymentName}`);
          } catch (error) {
            console.error(`❌ Failed to delete deployment ${deploymentName}:`, error);
          }
        } else if (isIdle && replicas > 0) {
          // Scale down idle deployments
          console.log(`⏸️  Scaling down idle deployment: ${deploymentName} (idle ${minutesIdle.toFixed(1)}min)`);
          try {
            await this.scaleDeployment(deploymentName, 0);
            processedCount++;
            console.log(`✅ Scaled down deployment: ${deploymentName}`);
          } catch (error) {
            console.error(`❌ Failed to scale down deployment ${deploymentName}:`, error);
          }
        }
      }
      
      // Check if we exceed max deployments (after cleanup)
      const remainingDeployments = sortedDeployments.filter(d => !d.isVeryOld);
      if (remainingDeployments.length > maxDeployments) {
        const excessCount = remainingDeployments.length - maxDeployments;
        console.log(`⚠️  Too many deployments (${remainingDeployments.length} > ${maxDeployments}), cleaning up ${excessCount} oldest`);
        
        const deploymentsToDelete = remainingDeployments.slice(0, excessCount);
        for (const { deploymentName, deploymentId } of deploymentsToDelete) {
          console.log(`🧹 Removing excess deployment: ${deploymentName}`);
          try {
            await this.deleteWorkerDeployment(deploymentId);
            processedCount++;
            console.log(`✅ Removed excess deployment: ${deploymentName}`);
          } catch (error) {
            console.error(`❌ Failed to remove deployment ${deploymentName}:`, error);
          }
        }
      }
      
      console.log(`🔄 Deployment reconciliation completed. Processed ${processedCount} deployments.`);
      
    } catch (error) {
      console.error('Error during deployment reconciliation:', error instanceof Error ? error.message : String(error));
    }
  }
}