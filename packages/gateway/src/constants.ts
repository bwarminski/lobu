#!/usr/bin/env bun

/**
 * Gateway constants - centralized configuration values
 * Extract magic numbers and strings to maintain consistency across the codebase
 */

// Time constants (milliseconds)
export const TIME = {
  /** One hour in milliseconds */
  HOUR_MS: 60 * 60 * 1000,
  /** One day in milliseconds */
  DAY_MS: 24 * 60 * 60 * 1000,
  /** One hour in seconds */
  HOUR_SECONDS: 3600,
  /** One day in seconds */
  DAY_SECONDS: 24 * 60 * 60,
  /** One minute in milliseconds */
  MINUTE_MS: 60 * 1000,
  /** Five seconds in milliseconds */
  FIVE_SECONDS_MS: 5000,
  /** Thirty seconds */
  THIRTY_SECONDS: 30,
} as const;

// Redis key prefixes
export const REDIS_KEYS = {
  /** Prefix for bot message timestamps */
  BOT_MESSAGES: "bot_messages:",
  /** Prefix for session data */
  SESSION: "session:",
  /** Prefix for thread ownership */
  THREAD_OWNER: "thread_owner:",
  /** Prefix for MCP credentials */
  MCP_CREDENTIAL: "mcp:credential:",
  /** Prefix for MCP OAuth state */
  MCP_OAUTH_STATE: "mcp:oauth:state:",
  /** Prefix for MCP inputs */
  MCP_INPUT: "mcp:input:",
} as const;

// Default configuration values
export const DEFAULTS = {
  /** Default session TTL in milliseconds */
  SESSION_TTL_MS: TIME.DAY_MS,
  /** Default session TTL in seconds */
  SESSION_TTL_SECONDS: TIME.DAY_SECONDS,
  /** Default queue expiration in hours */
  QUEUE_EXPIRE_HOURS: 24,
  /** Default retry limit for queue operations */
  QUEUE_RETRY_LIMIT: 3,
  /** Default retry delay in seconds */
  QUEUE_RETRY_DELAY_SECONDS: TIME.THIRTY_SECONDS,
  /** Default session timeout in minutes */
  SESSION_TIMEOUT_MINUTES: 5,
  /** Default HTTP server port */
  HTTP_PORT: 3000,
  /** Default Slack API URL */
  SLACK_API_URL: "https://slack.com/api",
  /** Default public gateway URL */
  PUBLIC_GATEWAY_URL: "http://localhost:8080",
  /** Default queue names */
  QUEUE_DIRECT_MESSAGE: "direct_message",
  QUEUE_MESSAGE_QUEUE: "message_queue",
  /** Default worker settings */
  WORKER_IMAGE_REPOSITORY: "peerbot-worker",
  WORKER_IMAGE_TAG: "latest",
  WORKER_IMAGE_PULL_POLICY: "Always",
  WORKER_RUNTIME_CLASS_NAME: "kata",
  WORKER_CPU_REQUEST: "100m",
  WORKER_MEMORY_REQUEST: "256Mi",
  WORKER_CPU_LIMIT: "1000m",
  WORKER_MEMORY_LIMIT: "2Gi",
  WORKER_IDLE_CLEANUP_MINUTES: 60,
  MAX_WORKER_DEPLOYMENTS: 100,
  WORKER_STALE_TIMEOUT_MINUTES: 10,
  /** Default Kubernetes namespace */
  KUBERNETES_NAMESPACE: "peerbot",
  /** Default cleanup settings */
  CLEANUP_INITIAL_DELAY_MS: TIME.FIVE_SECONDS_MS,
  CLEANUP_INTERVAL_MS: 60000, // 1 minute
  CLEANUP_VERY_OLD_DAYS: 7,
  /** Default socket health settings */
  SOCKET_HEALTH_CHECK_INTERVAL_MS: 5 * TIME.MINUTE_MS, // 5 minutes
  SOCKET_STALE_THRESHOLD_MS: 15 * TIME.MINUTE_MS, // 15 minutes
  SOCKET_PROTECT_ACTIVE_WORKERS: true,
  /** Default deployment settings */
  HOST_PROJECT_PATH: "/app",
  COMPOSE_PROJECT_NAME: "peerbot",
  DISPATCHER_SERVICE_NAME: "peerbot-dispatcher",
  /** Default log level */
  LOG_LEVEL: "INFO" as const,
  /** Default kubeconfig path */
  KUBECONFIG: "~/.kube/config",
} as const;

// OAuth constants
export const OAUTH = {
  /** OAuth state TTL in seconds (5 minutes) */
  STATE_TTL_SECONDS: 5 * 60,
  /** OAuth grant types */
  GRANT_TYPE_AUTHORIZATION_CODE: "authorization_code",
  GRANT_TYPE_REFRESH_TOKEN: "refresh_token",
  /** OAuth response types */
  RESPONSE_TYPE_CODE: "code",
} as const;

// HTTP status codes
export const HTTP_STATUS = {
  OK: 200,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INTERNAL_SERVER_ERROR: 500,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
} as const;

// Display formatting
export const DISPLAY = {
  /** Horizontal separator length */
  SEPARATOR_LENGTH: 50,
  /** Token preview length for logging */
  TOKEN_PREVIEW_LENGTH: 10,
} as const;
