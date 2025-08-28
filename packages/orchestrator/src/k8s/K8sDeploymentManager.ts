import * as k8s from '@kubernetes/client-node';
import { BaseDeploymentManager, DeploymentInfo } from '../base/BaseDeploymentManager';
import { K8sSecretManager } from './K8sSecretManager';
import { 
  OrchestratorConfig, 
  SimpleDeployment, 
  OrchestratorError,
  ErrorCode 
} from '../types';
import { DatabasePool } from '../database-pool';

export class K8sDeploymentManager extends BaseDeploymentManager {
  private appsV1Api: k8s.AppsV1Api;
  private coreV1Api: k8s.CoreV1Api;

  constructor(config: OrchestratorConfig, dbPool: DatabasePool) {
    const secretManager = new K8sSecretManager(config);
    super(config, dbPool, secretManager);

    const kc = new k8s.KubeConfig();
    try {
      // Try in-cluster config first, then fall back to default
      if (process.env.KUBERNETES_SERVICE_HOST) {
        try {
          kc.loadFromCluster();
          console.log('✅ Loaded in-cluster Kubernetes config');
        } catch (clusterError) {
          console.log('⚠️  In-cluster config failed, trying default config');
          kc.loadFromDefault();
          console.log('✅ Loaded default Kubernetes config as fallback');
        }
      } else {
        kc.loadFromDefault();
        console.log('✅ Loaded default Kubernetes config');
      }
      
      // For development environments, disable TLS verification to avoid certificate issues
      if (process.env.NODE_ENV === 'development' || 
          process.env.KUBERNETES_SERVICE_HOST?.includes('127.0.0.1') ||
          process.env.KUBERNETES_SERVICE_HOST?.includes('192.168') ||
          process.env.KUBERNETES_SERVICE_HOST?.includes('localhost')) {
        const cluster = kc.getCurrentCluster();
        if (cluster && cluster.skipTLSVerify !== true) {
          console.log('🔧 Development environment detected, disabling TLS verification');
          (cluster as any).skipTLSVerify = true;
        }
      }
      
    } catch (error) {
      console.error('❌ Failed to load Kubernetes config:', error);
      throw new OrchestratorError(
        ErrorCode.DEPLOYMENT_CREATE_FAILED,
        `Failed to initialize Kubernetes client: ${error instanceof Error ? error.message : String(error)}`,
        { error },
        true
      );
    }
    
    this.appsV1Api = kc.makeApiClient(k8s.AppsV1Api);
    this.coreV1Api = kc.makeApiClient(k8s.CoreV1Api);
    
    // Pass the K8s API to the secret manager
    (this.secretManager as K8sSecretManager).setCoreV1Api(this.coreV1Api);
  }

  async listDeployments(): Promise<DeploymentInfo[]> {
    try {
      const k8sDeployments = await this.appsV1Api.listNamespacedDeployment(
        this.config.kubernetes.namespace,
        undefined,
        undefined,
        undefined,
        undefined,
        'app.kubernetes.io/component=worker'
      );

      const now = Date.now();
      const idleThresholdMinutes = this.config.worker.idleCleanupMinutes;

      return (k8sDeployments.body.items || []).map((deployment: any) => {
        const deploymentName = deployment.metadata?.name || '';
        const deploymentId = deploymentName.replace('peerbot-worker-', '');
        
        // Get last activity from annotations or fallback to creation time
        const lastActivityStr = deployment.metadata?.annotations?.['peerbot.io/last-activity'] ||
                               deployment.metadata?.annotations?.['peerbot.io/created'] ||
                               deployment.metadata?.creationTimestamp;
        
        const lastActivity = lastActivityStr ? new Date(lastActivityStr) : new Date();
        const minutesIdle = (now - lastActivity.getTime()) / (1000 * 60);
        const daysSinceActivity = minutesIdle / (60 * 24);
        const replicas = deployment.spec?.replicas || 0;
        
        return {
          deploymentName,
          deploymentId,
          lastActivity,
          minutesIdle,
          daysSinceActivity,
          replicas,
          isIdle: minutesIdle >= idleThresholdMinutes,
          isVeryOld: daysSinceActivity >= 7
        };
      });
    } catch (error) {
      throw new OrchestratorError(
        ErrorCode.DEPLOYMENT_CREATE_FAILED,
        `Failed to list deployments: ${error instanceof Error ? error.message : String(error)}`,
        { error },
        true
      );
    }
  }

  async createDeployment(deploymentName: string, username: string, userId: string, messageData?: any): Promise<void> {
    const deployment: SimpleDeployment = {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: {
        name: deploymentName,
        namespace: this.config.kubernetes.namespace,
        labels: {
          'app.kubernetes.io/name': 'peerbot',
          'app.kubernetes.io/component': 'worker',
          'peerbot/managed-by': 'orchestrator'
        }
      },
      spec: {
        replicas: 1,
        selector: {
          matchLabels: {
            'app.kubernetes.io/name': 'peerbot',
            'app.kubernetes.io/component': 'worker'
          }
        },
        template: {
          metadata: {
            annotations: {
              // Add Slack thread link for visibility
              ...(messageData?.channelId && messageData?.threadId ? {
                'thread_url': `https://app.slack.com/client/${messageData?.platformMetadata?.teamId || 'unknown'}/${messageData.channelId}/thread/${messageData.threadId}`
              } : {}),
              // Add Slack user profile link
              ...(messageData?.platformUserId && messageData?.platformMetadata?.teamId ? {
                'user_url': `https://app.slack.com/team/${messageData.platformMetadata.teamId}/${messageData.platformUserId}`
              } : {}),
              'peerbot.io/created': new Date().toISOString()
            },
            labels: {
              'app.kubernetes.io/name': 'peerbot',
              'app.kubernetes.io/component': 'worker'
            }
          },
          spec: {
            serviceAccountName: 'peerbot-worker',
            containers: [{
              name: 'worker',
              image: `${this.config.worker.image.repository}:${this.config.worker.image.tag}`,
              imagePullPolicy: 'IfNotPresent',
              env: [
                // User-specific database connection from secret
                {
                  name: 'DATABASE_URL',
                  valueFrom: {
                    secretKeyRef: {
                      name: `peerbot-user-secret-${username.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}`,
                      key: 'DATABASE_URL'
                    }
                  }
                },
                // Worker configuration
                {
                  name: 'WORKER_MODE',
                  value: 'queue'
                },
                {
                  name: 'USER_ID',
                  value: userId
                },
                {
                  name: 'DEPLOYMENT_NAME',
                  value: deploymentName
                },
                {
                  name: 'SESSION_KEY', 
                  value: messageData?.agentSessionId || `session-${userId}-${Date.now()}`
                },
                {
                  name: 'CHANNEL_ID',
                  value: messageData?.channelId || 'unknown-channel'
                },
                {
                  name: 'REPOSITORY_URL',
                  value: messageData?.platformMetadata?.repositoryUrl || process.env.GITHUB_REPOSITORY || 'https://github.com/anthropics/claude-code-examples'
                },
                {
                  name: 'ORIGINAL_MESSAGE_TS',
                  value: messageData?.platformMetadata?.originalMessageTs || messageData?.messageId || 'unknown'
                },
                {
                  name: 'GITHUB_TOKEN',
                  valueFrom: {
                    secretKeyRef: {
                      name: 'peerbot-secrets',
                      key: 'github-token'
                    }
                  }
                },
                {
                  name: 'CLAUDE_CODE_OAUTH_TOKEN',
                  valueFrom: {
                    secretKeyRef: {
                      name: 'peerbot-secrets',
                      key: 'claude-code-oauth-token'
                    }
                  }
                },
                {
                  name: 'LOG_LEVEL',
                  value: 'info'
                },
                // Workspace configuration
                {
                  name: 'WORKSPACE_PATH',
                  value: '/workspace'
                },
                // Slack thread information for visibility and tooling
                {
                  name: 'SLACK_TEAM_ID',
                  value: messageData?.platformMetadata?.teamId || ''
                },
                {
                  name: 'SLACK_CHANNEL_ID', 
                  value: messageData?.channelId || ''
                },
                {
                  name: 'SLACK_THREAD_TS',
                  value: messageData?.threadId || ''
                },
                // Security: Claude tool restrictions (only if env vars exist)
                ...(process.env.CLAUDE_ALLOWED_TOOLS ? [{
                  name: 'CLAUDE_ALLOWED_TOOLS',
                  value: process.env.CLAUDE_ALLOWED_TOOLS
                }] : []),
                ...(process.env.CLAUDE_DISALLOWED_TOOLS ? [{
                  name: 'CLAUDE_DISALLOWED_TOOLS',
                  value: process.env.CLAUDE_DISALLOWED_TOOLS
                }] : []),
                ...(process.env.CLAUDE_TIMEOUT_MINUTES ? [{
                  name: 'CLAUDE_TIMEOUT_MINUTES',
                  value: process.env.CLAUDE_TIMEOUT_MINUTES
                }] : []),
                // Worker environment variables from configuration
                ...Object.entries(this.config.worker.env || {}).map(([key, value]) => ({
                  name: key,
                  value: String(value)
                }))
              ],
              resources: {
                requests: this.config.worker.resources.requests,
                limits: this.config.worker.resources.limits
              },
              volumeMounts: [{
                name: 'workspace',
                mountPath: '/workspace'
              }]
            }],
            volumes: [{
              name: 'workspace',
              emptyDir: {}
            }]
          }
        }
      }
    };

    await this.appsV1Api.createNamespacedDeployment(this.config.kubernetes.namespace, deployment);
  }

  async scaleDeployment(deploymentName: string, replicas: number): Promise<void> {
    try {
      const deployment = await this.appsV1Api.readNamespacedDeployment(
        deploymentName,
        this.config.kubernetes.namespace
      );
      
      if (deployment.body.spec?.replicas !== replicas) {
        deployment.body.spec!.replicas = replicas;
        await this.appsV1Api.patchNamespacedDeployment(
          deploymentName,
          this.config.kubernetes.namespace,
          deployment.body
        );
        console.log(`Scaled deployment ${deploymentName} to ${replicas} replicas`);
      }
    } catch (error) {
      throw new OrchestratorError(
        ErrorCode.DEPLOYMENT_SCALE_FAILED,
        `Failed to scale deployment ${deploymentName}: ${error instanceof Error ? error.message : String(error)}`,
        { deploymentName, replicas, error },
        true
      );
    }
  }

  async deleteDeployment(deploymentId: string): Promise<void> {
    const deploymentName = `peerbot-worker-${deploymentId}`;
    
    // Delete the deployment
    try {
      await this.appsV1Api.deleteNamespacedDeployment(
        deploymentName,
        this.config.kubernetes.namespace
      );
      console.log(`✅ Deleted deployment: ${deploymentName}`);
    } catch (error: any) {
      if (error.statusCode === 404) {
        console.log(`⚠️  Deployment ${deploymentName} not found (already deleted)`);
      } else {
        throw error;
      }
    }

    // Delete associated PVC if it exists
    try {
      const pvcName = `peerbot-workspace-${deploymentId}`;
      await this.coreV1Api.deleteNamespacedPersistentVolumeClaim(
        pvcName,
        this.config.kubernetes.namespace
      );
      console.log(`✅ Deleted PVC: ${pvcName}`);
    } catch (error: any) {
      if (error.statusCode === 404) {
        console.log(`⚠️  PVC for ${deploymentName} not found (already deleted)`);
      } else {
        console.log(`⚠️  Failed to delete PVC for ${deploymentName}:`, error.message);
      }
    }

    // Delete associated secret if it exists
    try {
      const secretName = `peerbot-user-secret-${deploymentId.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}`;
      await this.coreV1Api.deleteNamespacedSecret(
        secretName,
        this.config.kubernetes.namespace
      );
      console.log(`✅ Deleted secret: ${secretName}`);
    } catch (error: any) {
      if (error.statusCode === 404) {
        console.log(`⚠️  Secret for ${deploymentName} not found (already deleted)`);
      } else {
        console.log(`⚠️  Failed to delete secret for ${deploymentName}:`, error.message);
      }
    }
  }

  async updateDeploymentActivity(deploymentName: string): Promise<void> {
    try {
      const timestamp = new Date().toISOString();
      const patch = {
        metadata: {
          annotations: {
            'peerbot.io/last-activity': timestamp
          }
        }
      };

      await this.appsV1Api.patchNamespacedDeployment(
        deploymentName,
        this.config.kubernetes.namespace,
        patch
      );
      
      console.log(`✅ Updated activity timestamp for deployment: ${deploymentName}`);
    } catch (error) {
      console.error(`❌ Failed to update activity for deployment ${deploymentName}:`, error instanceof Error ? error.message : String(error));
      // Don't throw - activity tracking should not block message processing
    }
  }
}