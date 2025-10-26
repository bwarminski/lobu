#!/usr/bin/env bun

import type { InstructionProvider } from "@peerbot/core";
import type { ClaudeCredentialStore } from "../auth/claude/credential-store";
import type { ClaudeModelPreferenceStore } from "../auth/claude/model-preference-store";
import type { McpProxy } from "../auth/mcp/proxy";
import type { WorkerGateway } from "../gateway";
import type { AnthropicProxy } from "../infrastructure/model-provider";
import type { IMessageQueue, QueueProducer } from "../infrastructure/queue";
import type { InstructionService } from "../services/instruction-service";
import type { ISessionManager } from "../session";

// ============================================================================
// Core Services Interface
// ============================================================================

/**
 * Core services interface that platforms receive during initialization
 * This allows platforms to access shared infrastructure without tight coupling
 */
export interface CoreServices {
  getQueue(): IMessageQueue;
  getQueueProducer(): QueueProducer;
  getAnthropicProxy(): AnthropicProxy | undefined;
  getWorkerGateway(): WorkerGateway | undefined;
  getMcpProxy(): McpProxy | undefined;
  getClaudeCredentialStore(): ClaudeCredentialStore | undefined;
  getClaudeModelPreferenceStore(): ClaudeModelPreferenceStore | undefined;
  getSessionManager(): ISessionManager;
  getInstructionService(): InstructionService | undefined;
}

// ============================================================================
// Platform Adapter Interface
// ============================================================================

/**
 * Interface that all platform adapters must implement
 * Platforms include: Slack, Discord, Teams, etc.
 *
 * Each platform adapter:
 * 1. Receives CoreServices during initialization
 * 2. Sets up platform-specific event handlers
 * 3. Manages its own platform client/connection
 * 4. Uses core services (MCP, Anthropic, Redis) provided by Gateway
 */
export interface PlatformAdapter {
  /**
   * Platform name (e.g., "slack", "discord")
   */
  readonly name: string;

  /**
   * Initialize the platform with core services
   * This is called by Gateway after core services are initialized
   *
   * @param services - Core services provided by Gateway
   */
  initialize(services: CoreServices): Promise<void>;

  /**
   * Start the platform (connect to platform API, start event listeners)
   * This is called after initialization
   */
  start(): Promise<void>;

  /**
   * Stop the platform gracefully
   */
  stop(): Promise<void>;

  /**
   * Check if platform is healthy and running
   */
  isHealthy(): boolean;

  /**
   * Optionally provide platform-specific instruction provider
   * Returns null if platform doesn't have custom instructions
   */
  getInstructionProvider?(): InstructionProvider | null;

  /**
   * Build platform-specific deployment metadata
   * This metadata is used for deployment annotations (e.g., thread URLs, team IDs)
   *
   * @param threadId - The thread identifier
   * @param channelId - The channel identifier
   * @param platformMetadata - Platform-specific metadata from the queue payload
   * @returns Record of metadata key-value pairs for deployment annotations
   */
  buildDeploymentMetadata(
    threadId: string,
    channelId: string,
    platformMetadata: Record<string, any>
  ): Record<string, string>;
}

// ============================================================================
// Platform Registry
// ============================================================================

/**
 * Global registry for platform adapters
 * Allows deployment managers and other services to access platform-specific functionality
 */
export class PlatformRegistry {
  private platforms: Map<string, PlatformAdapter> = new Map();

  /**
   * Register a platform adapter
   */
  register(platform: PlatformAdapter): void {
    this.platforms.set(platform.name, platform);
  }

  /**
   * Get a platform by name
   */
  get(name: string): PlatformAdapter | undefined {
    return this.platforms.get(name);
  }
}

/**
 * Global platform registry instance
 */
export const platformRegistry = new PlatformRegistry();
