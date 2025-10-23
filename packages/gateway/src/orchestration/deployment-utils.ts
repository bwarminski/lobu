import { moduleRegistry } from "@peerbot/core";

/**
 * Shared utilities for deployment managers
 * Reduces code duplication between Docker and K8s implementations
 */

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
 * Creates platform-specific URLs and metadata for deployments
 */
export function buildPlatformMetadata(
  threadId: string,
  channelId: string,
  teamId?: string
): Record<string, string> {
  const metadata: Record<string, string> = {};

  // Add platform thread URL if we have team ID (currently Slack-specific)
  if (teamId) {
    metadata.thread_url = `https://app.slack.com/client/${teamId}/${channelId}/thread/${threadId}`;
    metadata.team_id = teamId;
  }

  return metadata;
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
