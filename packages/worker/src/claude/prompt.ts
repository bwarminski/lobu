#!/usr/bin/env bun

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createLogger } from "@peerbot/core";
import type { ConversationMessage, SessionContext } from "./executor";

const logger = createLogger("worker");

const TEMP_DIR = process.env.RUNNER_TEMP || "/tmp";

export interface PromptContext {
  platform: string;
  channelId: string;
  userId: string;
  userDisplayName?: string;
  threadContext?: boolean;
  workingDirectory?: string;
  customInstructions?: string;
}

/**
 * Generate formatted conversation history for Claude prompt
 */
function formatConversationHistory(
  conversation: ConversationMessage[]
): string {
  if (conversation.length === 0) {
    return "No previous conversation history.";
  }

  const formatted = conversation
    .filter((msg) => msg.role !== "system") // System messages handled separately
    .map((msg) => {
      const timestamp = new Date(msg.timestamp).toISOString();
      const role = msg.role === "user" ? "Human" : "Assistant";

      return `[${timestamp}] ${role}: ${msg.content}`;
    })
    .join("\n\n");

  return `## Previous Conversation\n\n${formatted}\n\n`;
}

/**
 * Generate context section for the prompt
 */
function generateContextSection(context: SessionContext): string {
  const sections = [];

  sections.push("## Context Information");
  sections.push(`Platform: ${context.platform}`);
  sections.push(`Channel: ${context.channelId}`);
  sections.push(`User: ${context.userDisplayName || context.userId}`);

  if (context.threadTs) {
    sections.push(
      "Session Type: Thread-based conversation (resuming previous discussion)"
    );
  } else {
    sections.push("Session Type: New conversation");
  }

  if (context.workingDirectory) {
    sections.push(`Working Directory: ${context.workingDirectory}`);
  }

  return `${sections.join("\n")}\n\n`;
}

/**
 * Generate working environment information
 */
function generateEnvironmentSection(context: SessionContext): string {
  const sections = [];

  sections.push("## Working Environment");
  sections.push("You are working in an isolated container environment:");
  sections.push(
    `- Working Directory: ${context.workingDirectory || "/workspace"}`
  );
  sections.push("- You have access to standard development tools");

  sections.push("");
  sections.push("Container Information:");
  sections.push("- This is a persistent worker container");
  sections.push("- Progress updates are streamed to Slack in real-time");

  return `${sections.join("\n")}\n\n`;
}

/**
 * Generate instructions for Slack integration
 */
function generateSlackInstructions(): string {
  return `## Slack Integration

You are responding to a user in Slack through a persistent worker system:

1. **Progress Updates**: Your progress is automatically streamed to Slack
2. **Thread Context**: This conversation may be part of an ongoing thread
3. **Session Continuity**: Your workspace persists across messages in the same thread

Keep responses concise but helpful. Focus on solving the user's specific request.

`;
}

/**
 * Create prompt file with conversation context
 */
export async function createPromptFile(
  context: SessionContext,
  conversation: ConversationMessage[] = []
): Promise<string> {
  const promptParts = [];

  // Add context information
  promptParts.push(generateContextSection(context));

  // Add environment information
  promptParts.push(generateEnvironmentSection(context));

  // Add Slack integration instructions
  promptParts.push(generateSlackInstructions());

  // Add custom instructions if provided
  if (context.customInstructions) {
    promptParts.push("## Custom Instructions\n\n");
    promptParts.push(context.customInstructions);
    promptParts.push("\n\n");
  }

  // Add conversation history if exists
  if (conversation.length > 0) {
    promptParts.push(formatConversationHistory(conversation));
  }

  // Add system messages from conversation
  const systemMessages = conversation.filter((msg) => msg.role === "system");
  if (systemMessages.length > 0) {
    promptParts.push("## System Context\n\n");
    systemMessages.forEach((msg) => {
      promptParts.push(msg.content);
      promptParts.push("\n");
    });
    promptParts.push("\n");
  }

  // Add final user request section
  promptParts.push("## Current Request\n\n");
  promptParts.push("Please respond to the user's request below:\n\n");

  const promptContent = promptParts.join("");

  // Write to temporary file
  const promptPath = join(TEMP_DIR, `claude-prompt-${Date.now()}.md`);
  await writeFile(promptPath, promptContent, "utf-8");

  logger.info(
    `Created prompt file: ${promptPath} (${promptContent.length} characters)`
  );
  return promptPath;
}
