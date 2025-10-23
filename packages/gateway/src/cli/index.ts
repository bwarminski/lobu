#!/usr/bin/env bun

import { initSentry } from "@peerbot/core";
import { createLogger } from "@peerbot/core";
import { Command } from "commander";
import {
  buildGatewayConfig,
  ConfigError,
  displayConfig,
  loadEnvFile,
} from "./config";
import { startGateway } from "./gateway";

const logger = createLogger("cli");

/**
 * CLI entry point - handles all command-line arguments and configuration
 */
async function main() {
  // Initialize Sentry monitoring (fire and forget)
  initSentry().catch(console.error);

  const program = new Command();

  program
    .name("peerbot-gateway")
    .description("Peerbot gateway service - connects Slack to Claude workers")
    .version("1.0.0")
    .option("--env <path>", "Path to .env file (default: .env)")
    .option("--validate", "Validate configuration and exit")
    .option("--show-config", "Display parsed configuration and exit")
    .action(async (options) => {
      try {
        // Load environment variables
        loadEnvFile(options.env);

        // Build configuration from environment
        const config = buildGatewayConfig();

        // Handle --validate flag
        if (options.validate) {
          console.log("✅ Configuration is valid");
          displayConfig(config);
          process.exit(0);
        }

        // Handle --show-config flag
        if (options.showConfig) {
          displayConfig(config);
          process.exit(0);
        }

        // Start the gateway
        await startGateway(config);
      } catch (error) {
        if (error instanceof ConfigError) {
          logger.error("❌ Configuration error:", error.message);
          process.exit(1);
        }
        logger.error("❌ Failed to start gateway:", error);
        process.exit(1);
      }
    });

  await program.parseAsync(process.argv);
}

// Run CLI
main().catch((error) => {
  logger.error("❌ CLI error:", error);
  process.exit(1);
});
