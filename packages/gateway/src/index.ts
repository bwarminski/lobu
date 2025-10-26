#!/usr/bin/env bun

/**
 * Main entry point for Peerbot Gateway
 * Exports types and utilities for other packages (like @peerbot/slack)
 */

// Export types and classes for external packages
export type { GatewayConfig } from "./config";
export { RedisSessionStore, SessionManager } from "./services/session-manager";

// Start CLI when run directly
import("./cli");
