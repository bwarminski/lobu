import { createLogger } from "@peerbot/core";
import type { InstructionContext, InstructionProvider } from "./types";

const logger = createLogger("worker");

/**
 * Builds custom instructions by collecting from multiple providers
 */
export class InstructionBuilder {
  private providers: InstructionProvider[] = [];

  /**
   * Register an instruction provider
   * @param provider - The provider to register
   */
  registerProvider(provider: InstructionProvider): void {
    this.providers.push(provider);
    // Sort by priority (lower priority = earlier in output)
    this.providers.sort((a, b) => a.priority - b.priority);
    logger.debug(
      `Registered instruction provider: ${provider.name} (priority: ${provider.priority})`
    );
  }

  /**
   * Build complete custom instructions from all providers
   * @param context - Context information for instruction generation
   * @returns Complete instruction text
   */
  async build(context: InstructionContext): Promise<string> {
    const sections: string[] = [];

    logger.debug(
      `Building instructions with ${this.providers.length} providers`
    );

    // Collect instructions from all registered providers
    for (const provider of this.providers) {
      try {
        const instructions = await provider.getInstructions(context);
        if (instructions?.trim()) {
          sections.push(instructions.trim());
          logger.debug(
            `Provider ${provider.name} contributed ${instructions.length} characters`
          );
        }
      } catch (error) {
        logger.error(
          `Failed to get instructions from provider ${provider.name}:`,
          error
        );
      }
    }

    const finalInstructions = sections.join("\n\n");
    logger.info(
      `Built custom instructions: ${finalInstructions.length} characters from ${sections.length} providers`
    );

    return finalInstructions;
  }
}
