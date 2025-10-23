import { createLogger } from "@peerbot/core";
import {
  InstructionBuilder,
  McpInstructionProvider,
  SlackInstructionProvider,
  ProjectsInstructionProvider,
  ProcessManagerInstructionProvider,
} from "./index";
import type { InstructionProvider } from "./types";

const logger = createLogger("instruction-generator");

export interface InstructionContext {
  userId: string;
  sessionKey: string;
  workingDirectory: string;
  availableProjects: string[];
}

/**
 * Generate custom instructions using modular providers
 * Generic function that can be used by any AI agent
 */
export async function generateCustomInstructions(
  coreProvider: InstructionProvider,
  context: InstructionContext
): Promise<string> {
  try {
    const builder = new InstructionBuilder();

    // Register all instruction providers
    builder.registerProvider(coreProvider); // Agent-specific core provider
    builder.registerProvider(new McpInstructionProvider());
    builder.registerProvider(new SlackInstructionProvider());
    builder.registerProvider(new ProjectsInstructionProvider());
    builder.registerProvider(new ProcessManagerInstructionProvider());

    // Build instructions with context
    const instructions = await builder.build(context);

    logger.info(
      `[CUSTOM-INSTRUCTIONS] Generated ${instructions.length} characters`
    );
    logger.debug(`[CUSTOM-INSTRUCTIONS] \n${instructions}`);

    return instructions;
  } catch (error) {
    logger.error("Failed to generate custom instructions:", error);
    const fallback = `You are a helpful AI agent for user ${context.userId}.`;
    logger.warn(`[CUSTOM-INSTRUCTIONS] Using fallback: ${fallback}`);
    return fallback;
  }
}
