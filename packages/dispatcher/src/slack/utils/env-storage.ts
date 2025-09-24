#!/usr/bin/env bun

import { encrypt } from "@peerbot/shared";
import { getDbPool } from "@peerbot/shared";
import { createLogger } from "@peerbot/shared";

const logger = createLogger("dispatcher");

const ENV_PREFIX = "env:";

interface EnvVariable {
  name: string;
  value: string;
}

/**
 * Extracts environment variables from form submission
 * Only processes fields with action_ids starting with "env:"
 */
export function extractEnvVariables(stateValues: any): EnvVariable[] {
  const envVars: EnvVariable[] = [];

  for (const [_blockId, block] of Object.entries(stateValues || {})) {
    for (const [actionId, action] of Object.entries(block as any)) {
      // Check if this action_id indicates an environment variable
      if (actionId.startsWith(ENV_PREFIX)) {
        const value = (action as any).value;

        if (value?.toString().trim()) {
          const envVarName = actionId.slice(ENV_PREFIX.length);
          envVars.push({
            name: envVarName,
            value: value.toString().trim(),
          });

          logger.info(`Found env variable to store: ${envVarName}`);
        }
      }
    }
  }

  return envVars;
}

/**
 * Checks if a form contains any environment variables to store
 */
export function hasEnvVariables(stateValues: any): boolean {
  for (const block of Object.values(stateValues || {})) {
    for (const actionId of Object.keys(block as any)) {
      if (actionId.startsWith(ENV_PREFIX)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Stores environment variables in the database
 */
export async function storeEnvVariables(
  userId: string,
  envVars: EnvVariable[],
  channelId?: string,
  repository?: string
): Promise<{ stored: string[]; failed: string[] }> {
  const dbPool = getDbPool(process.env.DATABASE_URL!);
  const stored: string[] = [];
  const failed: string[] = [];

  try {
    // Ensure user exists
    await dbPool.query(
      `INSERT INTO users (platform, platform_user_id)
       VALUES ('slack', $1)
       ON CONFLICT (platform, platform_user_id) DO NOTHING`,
      [userId.toUpperCase()]
    );

    // Get user ID
    const userResult = await dbPool.query(
      `SELECT id FROM users WHERE platform = 'slack' AND platform_user_id = $1`,
      [userId.toUpperCase()]
    );
    const userDbId = userResult.rows[0]?.id;

    if (!userDbId) {
      throw new Error(`User not found: ${userId}`);
    }

    // Determine storage context
    const isChannel = channelId && !channelId.startsWith("D");
    const storageType = isChannel ? "channel" : "user";

    // Store each environment variable
    for (const envVar of envVars) {
      try {
        const encryptedValue = encrypt(envVar.value);

        await dbPool.query(
          `INSERT INTO user_environ (user_id, channel_id, repository, name, value, type, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
           ON CONFLICT (user_id, channel_id, repository, name)
           DO UPDATE SET value = EXCLUDED.value, type = EXCLUDED.type, updated_at = NOW()`,
          [
            userDbId,
            isChannel ? channelId : null,
            repository || null,
            envVar.name,
            encryptedValue,
            storageType,
          ]
        );

        stored.push(envVar.name);
        logger.info(
          `✅ Stored env variable: ${envVar.name} for user ${userId}`
        );
      } catch (error) {
        logger.error(`Failed to store env variable ${envVar.name}:`, error);
        failed.push(envVar.name);
      }
    }

    return { stored, failed };
  } catch (error) {
    logger.error(`Failed to store env variables for user ${userId}:`, error);
    return { stored: [], failed: envVars.map((v) => v.name) };
  }
}
