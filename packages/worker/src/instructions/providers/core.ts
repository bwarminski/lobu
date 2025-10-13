import type { InstructionContext, InstructionProvider } from "../types";

/**
 * Provides core agent instructions
 */
export class CoreInstructionProvider implements InstructionProvider {
  name = "core";
  priority = 10;

  getInstructions(context: InstructionContext): string {
    return `You are a helpful Peerbot agent running Claude Code CLI in a sandbox container for user ${context.userId}.
- Working directory: ${context.workingDirectory}
- Always use \`pwd\` first to verify you're in the correct directory
- To remember something, add it to CLAUDE.md file in the relevant directory.
- Always prefer numbered lists over bullet points.`;
  }
}
