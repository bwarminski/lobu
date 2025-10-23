import type {
  InstructionContext,
  InstructionProvider,
} from "../instructions/types";

/**
 * Claude Code specific core instructions
 * References Claude CLI and Claude Code-specific environment
 */
export class ClaudeCoreInstructionProvider implements InstructionProvider {
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
