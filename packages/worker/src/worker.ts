#!/usr/bin/env bun

import fs from "node:fs";
import { createLogger } from "@peerbot/core";
import * as Sentry from "@sentry/node";
import { parseClaudeOutput } from "./claude/parser";
import { ClaudeSessionRunner } from "./claude/executor";
import { GatewayIntegration } from "./gateway/client";
import type { WorkerConfig } from "./types";
import type { WorkerExecutor, GatewayIntegrationInterface } from "./interfaces";
import { WorkspaceManager } from "./workspace";
import {
  InstructionBuilder,
  CoreInstructionProvider,
  SlackInstructionProvider,
  ProjectsInstructionProvider,
  ProcessManagerInstructionProvider,
} from "./instructions";

const logger = createLogger("worker");

// ============================================================================
// ERROR HANDLER
// ============================================================================

/**
 * Centralized error handling for worker execution
 */
class WorkerErrorHandler {
  /**
   * Check if error is a repository access/authentication issue
   */
  isRepositoryAccessError(error: unknown): boolean {
    return (
      (error as any)?.isAuthenticationError === true ||
      (error as any)?.cause?.isAuthenticationError === true ||
      (error as any)?.gitExitCode === 128
    );
  }

  /**
   * Format error message for display
   */
  formatErrorMessage(error: unknown): string {
    let errorMsg = `💥 Worker crashed`;

    if (error instanceof Error) {
      errorMsg += `: ${error.message}`;
      // Add error type if it's not generic
      if (
        error.constructor.name !== "Error" &&
        error.constructor.name !== "WorkspaceError"
      ) {
        errorMsg = `💥 Worker crashed (${error.constructor.name}): ${error.message}`;
      }
    } else {
      errorMsg += ": Unknown error";
    }

    return errorMsg;
  }

  /**
   * Handle authentication errors with helpful messages
   */
  async handleAuthenticationError(
    config: WorkerConfig,
    gateway: GatewayIntegrationInterface
  ): Promise<void> {
    const isDM = config.channelId?.startsWith("D");
    let userMessage: string;

    if (isDM) {
      // In DM, provide authentication options
      userMessage = `🔐 **Authentication Required**

I need access to a GitHub repository to help you. You have two options:

**Option 1: Authenticate with GitHub**
• Type \`login\` or click the button below to connect your GitHub account
• This gives you full access to your repositories

**Option 2: Try the Demo**
• Type \`demo\` to use a sample repository
• Great for exploring what I can do

Type \`welcome\` for more information about getting started.`;
    } else {
      // In channel, be more concise
      userMessage = `🔐 Repository access required. Please authenticate with GitHub or use the demo. Type \`welcome\` for help.`;
    }

    // Send the helpful message
    await gateway.sendContent(userMessage);
  }

  /**
   * Handle execution error - decides between authentication and generic errors
   */
  async handleExecutionError(
    error: unknown,
    config: WorkerConfig,
    gateway: GatewayIntegrationInterface
  ): Promise<void> {
    logger.error("Worker execution failed:", error);

    try {
      if (this.isRepositoryAccessError(error)) {
        // This is a repository access issue - provide helpful guidance
        await this.handleAuthenticationError(config, gateway);
      } else {
        // Other errors - show generic error message
        const errorMsg = this.formatErrorMessage(error);
        await gateway.sendContent(errorMsg);
        await gateway.signalError(
          error instanceof Error ? error : new Error(String(error))
        );
      }
    } catch (gatewayError) {
      logger.error("Failed to send error via gateway:", gatewayError);
      // Re-throw the original error
      throw error;
    }
  }
}

// Singleton error handler instance
const errorHandler = new WorkerErrorHandler();

// ============================================================================
// CLAUDE WORKER
// ============================================================================

export class ClaudeWorker implements WorkerExecutor {
  private sessionRunner: ClaudeSessionRunner;
  private workspaceManager: WorkspaceManager;
  public gatewayIntegration: GatewayIntegration;
  private config: WorkerConfig;

  constructor(config: WorkerConfig) {
    this.config = config;

    // Initialize components
    this.sessionRunner = new ClaudeSessionRunner();
    this.workspaceManager = new WorkspaceManager(config.workspace);

    // Verify required environment variables
    const dispatcherUrl = process.env.DISPATCHER_URL;
    const workerToken = process.env.WORKER_TOKEN;

    if (!dispatcherUrl || !workerToken) {
      throw new Error(
        "DISPATCHER_URL and WORKER_TOKEN environment variables are required"
      );
    }

    // Determine session ID - only use actual IDs, not "continue"
    const sessionId =
      config.sessionId ||
      (config.resumeSessionId === "continue"
        ? undefined
        : config.resumeSessionId);

    this.gatewayIntegration = new GatewayIntegration(
      dispatcherUrl,
      workerToken,
      config.userId,
      config.channelId,
      config.threadTs || "",
      config.slackResponseTs,
      sessionId,
      config.botResponseTs
    );
  }

  private listAppDirectories(rootDirectory: string): string[] {
    const foundDirectories: string[] = [];
    const ignored = new Set([
      "node_modules",
      ".git",
      ".next",
      "dist",
      "build",
      "vendor",
      "target",
      ".venv",
      "venv",
    ]);

    const buildConfigFiles = new Set([
      "Makefile",
      "makefile",
      "package.json",
      "pyproject.toml",
      "Cargo.toml",
      "pom.xml",
      "build.gradle",
      "build.gradle.kts",
      "CMakeLists.txt",
      "go.mod",
    ]);

    const walk = (dir: string): void => {
      let entries: fs.Dirent[] = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }

      // Check if current directory has any build config files
      const hasConfigFile = entries.some(
        (entry) => entry.isFile() && buildConfigFiles.has(entry.name)
      );

      if (hasConfigFile) {
        foundDirectories.push(dir);
      }

      // Recursively walk subdirectories
      for (const entry of entries) {
        const p = `${dir}/${entry.name}`;
        if (entry.isDirectory() && !ignored.has(entry.name)) {
          walk(p);
        }
      }
    };

    walk(rootDirectory);
    return foundDirectories;
  }

  /**
   * Execute the worker job
   */
  async execute(): Promise<void> {
    const executeStartTime = Date.now();

    try {
      logger.info(
        `🚀 Starting Claude worker for session: ${this.config.sessionKey}`
      );
      logger.info(
        `[TIMING] Worker execute() started at: ${new Date(executeStartTime).toISOString()}`
      );

      // Decode user prompt
      const userPrompt = Buffer.from(this.config.userPrompt, "base64").toString(
        "utf-8"
      );
      logger.info(`User prompt: ${userPrompt.substring(0, 100)}...`);

      const isResumedSession = !!this.config.resumeSessionId;

      // Setup workspace
      logger.info(
        isResumedSession ? "Resuming workspace..." : "Setting up workspace..."
      );
      await Sentry.startSpan(
        {
          name: "worker.workspace_setup",
          op: "worker.setup",
          attributes: {
            "user.id": this.config.userId,
            "session.key": this.config.sessionKey,
          },
        },
        async () => {
          await this.workspaceManager.setupWorkspace(
            this.config.userId,
            this.config.sessionKey
          );

          const { initModuleWorkspace } = await import(
            "./integrations/modules"
          );
          await initModuleWorkspace({
            workspaceDir: this.workspaceManager.getCurrentWorkingDirectory(),
            username: this.config.userId,
            sessionKey: this.config.sessionKey,
          });
        }
      );

      // Prepare session context
      let customInstructions = await this.generateCustomInstructions();

      // Call module onSessionStart hooks to allow modules to modify system prompt
      try {
        const { onSessionStart } = await import("./integrations/modules");
        const moduleContext = await onSessionStart({
          platform: "slack" as const,
          channelId: this.config.channelId,
          userId: this.config.userId,
          threadTs: this.config.threadTs,
          messageTs: this.config.slackResponseTs,
          workingDirectory: this.workspaceManager.getCurrentWorkingDirectory(),
          customInstructions,
        });
        // Update custom instructions with module modifications
        if (moduleContext.customInstructions) {
          customInstructions = moduleContext.customInstructions;
        }
      } catch (error) {
        logger.error("Failed to call onSessionStart hooks:", error);
      }

      const sessionContext = {
        platform: "slack" as const,
        channelId: this.config.channelId,
        userId: this.config.userId,
        userDisplayName: this.config.userId,
        threadTs: this.config.threadTs,
        messageTs: this.config.slackResponseTs,
        workingDirectory: this.workspaceManager.getCurrentWorkingDirectory(),
        customInstructions,
      };

      // Execute Claude session
      logger.info(
        `[TIMING] Starting Claude session at: ${new Date().toISOString()}`
      );
      const claudeStartTime = Date.now();
      logger.info(
        `[TIMING] Total worker startup time: ${claudeStartTime - executeStartTime}ms`
      );

      let firstOutputLogged = false;
      const result = await Sentry.startSpan(
        {
          name: "worker.claude_execution",
          op: "ai.inference",
          attributes: {
            "user.id": this.config.userId,
            "session.key": this.config.sessionKey,
            "thread.id": this.config.threadTs,
            model: JSON.parse(this.config.claudeOptions).model || "unknown",
            is_resume: !!this.config.resumeSessionId,
          },
        },
        async () => {
          return await this.sessionRunner.executeSession({
            sessionKey: this.config.sessionKey,
            userPrompt,
            context: sessionContext,
            options: {
              ...JSON.parse(this.config.claudeOptions),
              ...(this.config.resumeSessionId
                ? { resumeSessionId: this.config.resumeSessionId }
                : this.config.sessionId
                  ? { sessionId: this.config.sessionId }
                  : {}),
            },
            onProgress: async (update) => {
              if (!firstOutputLogged && update.type === "output") {
                logger.info(
                  `[TIMING] First Claude output at: ${new Date().toISOString()} (${Date.now() - claudeStartTime}ms after Claude start)`
                );
                firstOutputLogged = true;
              }
              if (update.type === "output" && update.data) {
                // Skip system messages - they should not be sent to Slack
                if (
                  typeof update.data === "object" &&
                  update.data.type === "system"
                ) {
                  logger.debug(
                    `Skipping system message: ${update.data.subtype || "unknown"}`
                  );
                  return;
                }
                await this.gatewayIntegration.sendContent(update.data);
              }
            },
          });
        }
      );

      // Handle final result
      logger.info("=== FINAL RESULT DEBUG ===");
      logger.info("result.success:", result.success);
      logger.info("result.output exists:", !!result.output);
      logger.info("result.output length:", result.output?.length);
      logger.info("result.output sample:", result.output?.substring(0, 300));
      logger.info("About to update Slack...");

      // Collect module data before sending final response
      const { collectModuleData } = await import("./integrations/modules");
      const moduleData = await collectModuleData({
        workspaceDir: this.workspaceManager.getCurrentWorkingDirectory(),
        userId: this.config.userId,
        threadId: this.config.threadTs || "",
      });
      this.gatewayIntegration.setModuleData(moduleData);

      if (result.success) {
        const claudeResponse = this.formatClaudeResponse(result.output);
        const finalMessage = claudeResponse?.trim()
          ? claudeResponse
          : "✅ Task completed successfully";

        logger.info(`Sending final message via queue: ${finalMessage}...`);
        await this.gatewayIntegration.signalDone(finalMessage);
      } else {
        const errorMsg = result.error || "Unknown error";
        await this.gatewayIntegration.sendContent(
          `❌ Session failed: ${errorMsg}`
        );
        await this.gatewayIntegration.signalError(new Error(errorMsg));
      }

      logger.info(
        `Worker completed with ${result.success ? "success" : "failure"}`
      );
    } catch (error) {
      // Use error handler to process and send appropriate error message
      await errorHandler.handleExecutionError(
        error,
        this.config,
        this.gatewayIntegration
      );
    }
  }

  /**
   * Generate custom instructions for Claude using modular providers
   */
  private async generateCustomInstructions(): Promise<string> {
    try {
      const builder = new InstructionBuilder();

      // Register all instruction providers
      builder.registerProvider(new CoreInstructionProvider());
      builder.registerProvider(new SlackInstructionProvider());
      builder.registerProvider(new ProjectsInstructionProvider());
      builder.registerProvider(new ProcessManagerInstructionProvider());

      // Build instructions with context
      const instructions = await builder.build({
        userId: this.config.userId,
        sessionKey: this.config.sessionKey,
        workingDirectory: this.workspaceManager.getCurrentWorkingDirectory(),
        availableProjects: this.listAppDirectories(
          this.workspaceManager.getCurrentWorkingDirectory()
        ),
      });

      logger.info(
        `[CUSTOM-INSTRUCTIONS] Generated ${instructions.length} characters`
      );
      logger.debug(`[CUSTOM-INSTRUCTIONS] \n${instructions}`);

      return instructions;
    } catch (error) {
      logger.error("Failed to generate custom instructions:", error);
      const fallback = `You are a helpful Claude Code agent for user ${this.config.userId}.`;
      logger.warn(`[CUSTOM-INSTRUCTIONS] Using fallback: ${fallback}`);
      return fallback;
    }
  }

  private formatClaudeResponse(output: string | undefined): string {
    logger.info("=== formatClaudeResponse DEBUG ===");
    logger.info(`output exists? ${!!output}`);
    logger.info(`output length: ${output?.length}`);
    logger.info(`output first 200 chars: ${output?.substring(0, 200)}`);

    if (!output) {
      return "";
    }

    const parsed = parseClaudeOutput(output);
    logger.info(`parsed response: ${parsed}`);
    logger.info(`parsed length: ${parsed.length}`);

    return parsed || "";
  }

  /**
   * Cleanup worker resources
   */
  async cleanup(): Promise<void> {
    try {
      logger.info("Cleaning up worker resources...");
      await this.sessionRunner.cleanupSession(this.config.sessionKey);
      logger.info("Worker cleanup completed");
    } catch (error) {
      logger.error("Error during cleanup:", error);
    }
  }

  /**
   * Get the gateway integration for sending updates
   * Implements WorkerExecutor interface
   */
  getGatewayIntegration(): GatewayIntegrationInterface | null {
    return this.gatewayIntegration;
  }
}

export type { WorkerConfig } from "./types";
