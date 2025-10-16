import { z } from "zod";

/**
 * Centralized configuration management module
 * Handles environment variables consistently across all packages
 */

// Slack configuration schema
export const SlackConfigSchema = z.object({
  botToken: z.string().min(1, "Slack bot token is required"),
  appToken: z.string().optional(),
  signingSecret: z.string().min(1, "Slack signing secret is required"),
  socketMode: z.boolean().optional().default(true),
  logLevel: z
    .enum(["DEBUG", "INFO", "WARN", "ERROR"])
    .optional()
    .default("INFO"),
});

// Claude configuration schema
export const ClaudeConfigSchema = z.object({
  apiKey: z.string().optional(),
  model: z.string().optional().default("claude-3-sonnet-20240229"),
  maxTokens: z.number().optional().default(4096),
});

// Kubernetes configuration schema
export const KubernetesConfigSchema = z.object({
  namespace: z.string().optional().default("default"),
  workerImage: z.string().optional().default("claude-worker"),
  imagePullPolicy: z
    .enum(["Always", "Never", "IfNotPresent"])
    .optional()
    .default("IfNotPresent"),
  resources: z
    .object({
      requests: z
        .object({
          cpu: z.string().optional().default("100m"),
          memory: z.string().optional().default("256Mi"),
        })
        .optional(),
      limits: z
        .object({
          cpu: z.string().optional().default("500m"),
          memory: z.string().optional().default("512Mi"),
        })
        .optional(),
    })
    .optional(),
});

export type SlackConfig = z.infer<typeof SlackConfigSchema>;
export type ClaudeConfig = z.infer<typeof ClaudeConfigSchema>;
export type KubernetesConfig = z.infer<typeof KubernetesConfigSchema>;

/**
 * Loads Slack configuration from environment variables
 */
export function loadSlackConfig(): SlackConfig {
  const config = {
    botToken: process.env.SLACK_BOT_TOKEN || "",
    appToken: process.env.SLACK_APP_TOKEN,
    signingSecret: process.env.SLACK_SIGNING_SECRET || "",
    socketMode: process.env.SLACK_SOCKET_MODE !== "false",
    logLevel: (process.env.SLACK_LOG_LEVEL as any) || "INFO",
  };

  return SlackConfigSchema.parse(config);
}

/**
 * Loads Claude configuration from environment variables
 */
export function loadClaudeConfig(): ClaudeConfig {
  return ClaudeConfigSchema.parse({
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: process.env.CLAUDE_MODEL,
    maxTokens: process.env.CLAUDE_MAX_TOKENS
      ? parseInt(process.env.CLAUDE_MAX_TOKENS, 10)
      : undefined,
  });
}

/**
 * Loads Kubernetes configuration from environment variables
 */
export function loadKubernetesConfig(): KubernetesConfig {
  return KubernetesConfigSchema.parse({
    namespace: process.env.KUBERNETES_NAMESPACE,
    workerImage: process.env.WORKER_IMAGE,
    imagePullPolicy: process.env.IMAGE_PULL_POLICY as any,
    resources: {
      requests: {
        cpu: process.env.WORKER_CPU_REQUEST,
        memory: process.env.WORKER_MEMORY_REQUEST,
      },
      limits: {
        cpu: process.env.WORKER_CPU_LIMIT,
        memory: process.env.WORKER_MEMORY_LIMIT,
      },
    },
  });
}

/**
 * Validates that required environment variables are present
 * @param requiredVars Array of required environment variable names
 * @throws Error if any required variables are missing
 */
export function validateRequiredEnvVars(requiredVars: string[]): void {
  const missing = requiredVars.filter((varName) => !process.env[varName]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}`
    );
  }
}

/**
 * Gets an environment variable with optional default value
 * @param name Environment variable name
 * @param defaultValue Default value if environment variable is not set
 * @returns The environment variable value or default
 */
export function getEnvVar(
  name: string,
  defaultValue?: string
): string | undefined {
  return process.env[name] || defaultValue;
}
