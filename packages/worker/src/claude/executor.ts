#!/usr/bin/env bun

import { createLogger } from "@peerbot/core";
import { runClaudeWithProgress } from "./session-executor";
import { createPromptFile } from "./prompt";

const logger = createLogger("worker");

// ============================================================================
// TYPES
// ============================================================================

// Core Claude execution types
export interface ClaudeExecutionOptions {
  allowedTools?: string;
  disallowedTools?: string;
  maxTurns?: string;
  systemPrompt?: string;
  appendSystemPrompt?: string;
  claudeEnv?: string;
  fallbackModel?: string;
  timeoutMinutes?: string;
  model?: string;
  sessionId?: string;
  resumeSessionId?: string;
}

export interface ClaudeExecutionResult {
  success: boolean;
  exitCode: number;
  output: string;
  error?: string;
}

export interface ProgressUpdate {
  type: "output" | "completion" | "error";
  data: any;
  timestamp: number;
}

export type ProgressCallback = (update: ProgressUpdate) => Promise<void>;

// Session management types
export interface SessionContext {
  platform: "slack";
  channelId: string;
  userId: string;
  userDisplayName?: string;
  teamId?: string;
  threadTs?: string;
  messageTs: string;
  workingDirectory?: string;
  customInstructions?: string;
  conversationHistory?: ConversationMessage[];
}

export interface ConversationMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  metadata?: {
    messageTs?: string;
    threadTs?: string;
    userId?: string;
    progressUpdate?: ProgressUpdate;
  };
}

export interface SessionState {
  sessionKey: string;
  context: SessionContext;
  conversation: ConversationMessage[];
  createdAt: number;
  lastActivity: number;
  status: "active" | "idle" | "completed" | "error" | "timeout";
  workspaceInfo?: {
    branch: string;
    workingDirectory: string;
  };
  progress?: {
    currentStep?: string;
    totalSteps?: number;
    lastUpdate?: ProgressUpdate;
  };
}

// Re-export from shared package
export { CoreWorkerError as WorkerError, SessionError } from "@peerbot/core";

// ============================================================================
// SESSION UTILITIES
// ============================================================================

/**
 * Create a new session state object
 */
export function createSessionState(
  sessionKey: string,
  context: SessionContext
): SessionState {
  const now = Date.now();

  const sessionState: SessionState = {
    sessionKey,
    context,
    conversation: [],
    createdAt: now,
    lastActivity: now,
    status: "active",
  };

  // Add system message for context if provided
  if (context.customInstructions) {
    sessionState.conversation.push({
      role: "system",
      content: context.customInstructions,
      timestamp: now,
    });
  }

  return sessionState;
}

/**
 * Add a message to the conversation
 * This is a pure function that returns a new conversation array
 */
export function addMessageToConversation(
  conversation: ConversationMessage[],
  message: ConversationMessage
): ConversationMessage[] {
  return [...conversation, message];
}

// ============================================================================
// SESSION EXECUTOR
// ============================================================================

export interface ExecuteClaudeSessionOptions {
  sessionKey: string;
  userPrompt: string;
  context: SessionContext;
  options: ClaudeExecutionOptions;
  onProgress?: ProgressCallback;
}

export interface SessionExecutionResult extends ClaudeExecutionResult {
  sessionKey: string;
  persisted?: boolean;
  storagePath?: string;
}

/**
 * Main interface for executing Claude sessions with thread-based persistence
 */
export class ClaudeSessionRunner {
  constructor() {
    logger.info(
      `ClaudeSessionRunner initialized (stateless - using Slack as source of truth)`
    );
  }

  /**
   * Execute a Claude session with conversation history
   */
  async executeSession(
    options: ExecuteClaudeSessionOptions
  ): Promise<SessionExecutionResult> {
    const {
      sessionKey,
      userPrompt,
      context,
      options: claudeOptions,
      onProgress,
    } = options;

    try {
      // Create session with conversation history from context
      logger.info(
        `Creating session ${sessionKey} with ${context.conversationHistory?.length || 0} messages from history`
      );
      const sessionState = createSessionState(sessionKey, context);

      // Add conversation history to session if provided
      if (
        context.conversationHistory &&
        context.conversationHistory.length > 0
      ) {
        sessionState.conversation = [...context.conversationHistory];
        logger.info(
          `Loaded ${context.conversationHistory.length} messages into session`
        );
      }

      // Add user message to conversation
      const userMessage: ConversationMessage = {
        role: "user",
        content: userPrompt,
        timestamp: Date.now(),
      };

      // Add to session state's conversation
      sessionState.conversation = addMessageToConversation(
        sessionState.conversation,
        userMessage
      );

      // Create prompt file with full conversation context (now includes the user message)
      const promptPath = await createPromptFile(
        context,
        sessionState.conversation
      );

      // Execute Claude with progress monitoring
      const result = await runClaudeWithProgress(
        promptPath,
        claudeOptions,
        async (update) => {
          // Call external progress callback
          if (onProgress) {
            await onProgress(update);
          }
        },
        context.workingDirectory // Pass working directory
      );

      // Add Claude's response to conversation if needed
      // Note: In stateless mode, we don't persist this
      if (result.success && result.output) {
        logger.info(
          `Would add assistant response to session ${sessionKey} (no-op in stateless mode)`
        );
      }

      return {
        ...result,
        sessionKey,
        persisted: false, // No persistence needed - Slack is the source of truth
        storagePath: "slack://thread", // Indicate data is in Slack
      };
    } catch (error) {
      logger.error(`Session ${sessionKey} execution failed:`, error);

      return {
        success: false,
        exitCode: 1,
        output: "",
        error: error instanceof Error ? error.message : "Unknown error",
        sessionKey,
      };
    }
  }

  /**
   * Clean up session resources
   */
  async cleanupSession(sessionKey: string): Promise<void> {
    logger.info(`Cleanup for ${sessionKey} (no-op in stateless mode)`);
  }
}

// Re-export sub-modules
export { runClaudeWithProgress } from "./session-executor";
export { createPromptFile } from "./prompt";
