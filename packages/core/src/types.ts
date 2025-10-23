export interface ClaudeExecutionOptions {
  model?: string;
  timeoutMinutes?: number;
  allowedTools?: string[];
  maxTokens?: number;
  customInstructions?: string;
  workingDirectory?: string;
  sessionId?: string;
  resume?: boolean;
  permissionMode?: string;
}

export interface SessionContext {
  platform: string; // Platform identifier (e.g., "slack", "discord", "teams")
  channelId: string;
  userId: string;
  messageId?: string;
  threadId?: string;
  conversationHistory?: ConversationMessage[];
  customInstructions?: string;
  workingDirectory?: string;
}

export interface ConversationMessage {
  role: "system" | "user" | "assistant";
  content: string;
  timestamp: number;
}
