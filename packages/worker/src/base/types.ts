/**
 * Generic types for AI agent workers
 * These types can be used by any AI agent (Claude Code, Codex, etc.)
 */

/**
 * Progress update from AI agent execution
 */
export type ProgressUpdate =
  | {
      type: "output";
      data: unknown; // Agent-specific message format
      timestamp: number;
    }
  | {
      type: "completion";
      data: {
        exitCode?: number;
        message?: string;
        success?: boolean;
        sessionId?: string;
      };
      timestamp: number;
    }
  | {
      type: "error";
      data: Error | { message?: string; stack?: string; error?: string };
      timestamp: number;
    }
  | {
      type: "status";
      data: { status: string; details?: string };
      timestamp: number;
    };

/**
 * Callback for receiving progress updates during AI execution
 */
export type ProgressCallback = (update: ProgressUpdate) => Promise<void>;

/**
 * Session context for AI execution
 * Contains information about the current session (platform, user, workspace)
 */
export interface SessionContext {
  platform: string; // Platform identifier (e.g., "slack", "discord", "teams")
  channelId: string;
  userId: string;
  userDisplayName?: string;
  teamId?: string;
  threadId?: string;
  messageId: string;
  workingDirectory?: string;
  customInstructions?: string;
}

/**
 * Result from AI execution
 */
export interface ExecutionResult {
  success: boolean;
  exitCode: number;
  output: string;
  error?: string;
}

/**
 * Result from session execution (includes session metadata)
 */
export interface SessionExecutionResult extends ExecutionResult {
  sessionKey: string;
  persisted?: boolean;
  storagePath?: string;
}

/**
 * Agent-specific execution options (model, parameters, etc.)
 */
export interface AgentExecuteOptions {
  model?: string;
  maxTurns?: number;
  permissionMode?: string;
  [key: string]: unknown; // Allow agent-specific extensions
}

/**
 * Options for executing an AI session
 * Agent-specific options should extend AgentExecuteOptions
 */
export interface ExecuteSessionOptions {
  sessionKey: string;
  userPrompt: string;
  context: SessionContext;
  options: AgentExecuteOptions;
  onProgress?: ProgressCallback;
}
