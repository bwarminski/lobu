import { moduleRegistry } from "@peerbot/core";
import type { PlatformAdapter } from "../platform";
import { platformRegistry } from "../platform";
import type {
  DeploymentInfo,
  OrchestratorConfig,
  QueueJobData,
} from "./base-deployment-manager";

/**
 * Shared types and utilities for deployment managers
 * Reduces code duplication between Docker and K8s implementations
 */

// ============================================================================
// Metadata Types
// ============================================================================

export interface PlatformMetadata {
  teamId?: string;
  originalMessageTs?: string;
  botResponseTs?: string;
}

export interface RoutingMetadata {
  targetThreadId?: string;
  deploymentName?: string;
  threadId?: string;
  userId?: string;
  timestamp?: string;
}

// Re-export core error types for convenience
export type {
  ErrorCode,
  OrchestratorError,
} from "@peerbot/core";

// Re-export orchestration types
export type {
  OrchestratorConfig,
  QueueJobData,
} from "./base-deployment-manager";

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Resource parsing utilities for memory and CPU limits
 */
export class ResourceParser {
  /**
   * Parse memory string (e.g., "256Mi", "1Gi", "512M") to bytes
   */
  static parseMemory(memoryStr: string): number {
    const units: Record<string, number> = {
      Ki: 1024,
      Mi: 1024 * 1024,
      Gi: 1024 * 1024 * 1024,
      k: 1000,
      M: 1000 * 1000,
      G: 1000 * 1000 * 1000,
    };

    for (const [unit, multiplier] of Object.entries(units)) {
      if (memoryStr.endsWith(unit)) {
        const value = parseFloat(memoryStr.replace(unit, ""));
        return value * multiplier;
      }
    }

    // If no unit is specified, assume bytes
    return parseInt(memoryStr, 10);
  }

  /**
   * Parse CPU string (e.g., "100m", "1", "2.5") to nanocores
   * Used by Docker which expects nanocores (1 core = 1e9 nanocores)
   */
  static parseCpu(cpuStr: string): number {
    if (cpuStr.endsWith("m")) {
      // Millicores to nanocores
      const millicores = parseInt(cpuStr.replace("m", ""), 10);
      return (millicores / 1000) * 1e9;
    }

    // Assume whole cores to nanocores
    const cores = parseFloat(cpuStr);
    return cores * 1e9;
  }
}

/**
 * Build standardized deployment labels
 */
export function buildDeploymentLabels(
  userId: string,
  threadId: string,
  channelId: string
): Record<string, string> {
  return {
    "peerbot.io/user-id": userId,
    "peerbot.io/thread-id": threadId,
    "peerbot.io/channel-id": channelId,
    "peerbot.io/managed-by": "orchestrator",
  };
}

/**
 * Build platform metadata annotations
 * Delegates to the platform adapter to create platform-specific metadata
 */
export function buildPlatformMetadata(
  platform: PlatformAdapter,
  threadId: string,
  channelId: string,
  platformMetadata: Record<string, any>
): Record<string, string> {
  return platform.buildDeploymentMetadata(
    threadId,
    channelId,
    platformMetadata
  );
}

/**
 * Build environment variables by integrating all registered modules
 */
export async function buildModuleEnvVars(
  userId: string,
  baseEnv: Record<string, string>
): Promise<Record<string, string>> {
  let envVars = { ...baseEnv };

  const orchestratorModules = moduleRegistry.getOrchestratorModules();
  for (const module of orchestratorModules) {
    if (module.buildEnvVars) {
      envVars = await module.buildEnvVars(userId, envVars);
    }
  }

  return envVars;
}

export const BASE_WORKER_LABELS = {
  "app.kubernetes.io/name": "peerbot",
  "app.kubernetes.io/component": "worker",
  "peerbot/managed-by": "orchestrator",
} as const;

export const WORKER_SELECTOR_LABELS = {
  "app.kubernetes.io/name": BASE_WORKER_LABELS["app.kubernetes.io/name"],
  "app.kubernetes.io/component":
    BASE_WORKER_LABELS["app.kubernetes.io/component"],
} as const;

export function resolvePlatformDeploymentMetadata(
  messageData?: QueueJobData
): Record<string, string> {
  if (
    !messageData?.platform ||
    !messageData.channelId ||
    !messageData.threadId ||
    !messageData.platformMetadata
  ) {
    return {};
  }

  const platform = platformRegistry.get(messageData.platform);
  if (!platform) {
    return {};
  }

  return buildPlatformMetadata(
    platform,
    messageData.threadId,
    messageData.channelId,
    messageData.platformMetadata
  );
}

export function getVeryOldThresholdDays(config: OrchestratorConfig): number {
  return (config.cleanup?.veryOldDays as number | undefined) || 7;
}

export function buildDeploymentInfoSummary({
  deploymentName,
  deploymentId,
  lastActivity,
  now,
  idleThresholdMinutes,
  veryOldDays,
  replicas,
}: {
  deploymentName: string;
  deploymentId: string;
  lastActivity: Date;
  now: number;
  idleThresholdMinutes: number;
  veryOldDays: number;
  replicas: number;
}): DeploymentInfo {
  const minutesIdle = (now - lastActivity.getTime()) / (1000 * 60);
  const daysSinceActivity = minutesIdle / (60 * 24);

  return {
    deploymentName,
    deploymentId,
    lastActivity,
    minutesIdle,
    daysSinceActivity,
    replicas,
    isIdle: minutesIdle >= idleThresholdMinutes,
    isVeryOld: daysSinceActivity >= veryOldDays,
  };
}
