#!/usr/bin/env bun

import type { WorkerConfig } from "./types";

/**
 * Interface for worker executors
 * Allows different implementations (Claude, GPT, etc.)
 */
export interface WorkerExecutor {
  /**
   * Execute the worker job
   */
  execute(): Promise<void>;

  /**
   * Cleanup worker resources
   */
  cleanup(): Promise<void>;

  /**
   * Get the gateway integration for sending updates
   */
  getGatewayIntegration(): GatewayIntegrationInterface | null;
}

/**
 * Interface for gateway integration
 * Provides methods for communicating with the dispatcher
 */
export interface GatewayIntegrationInterface {
  setJobId(jobId: string): void;
  setProcessedMessages(messageIds: string[]): void;
  setBotResponseTs(botResponseTs: string): void;
  setModuleData(moduleData: Record<string, unknown>): void;
  sendContent(content: string): Promise<void>;
  signalDone(content: string): Promise<void>;
  signalCompletion(): Promise<void>;
  signalError(error: Error): Promise<void>;
}

/**
 * Factory function type for creating worker executors
 */
export type WorkerExecutorFactory = (config: WorkerConfig) => WorkerExecutor;
