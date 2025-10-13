import type { InstructionContext, InstructionProvider } from "../types";

/**
 * Provides information about available projects in the workspace
 */
export class ProjectsInstructionProvider implements InstructionProvider {
  name = "projects";
  priority = 30;

  getInstructions(context: InstructionContext): string {
    if (!context.availableProjects || context.availableProjects.length === 0) {
      return `**Available projects:**
  - none`;
    }

    const projectList = context.availableProjects
      .map((project) => `  - ${project}`)
      .join("\n");

    return `**Available projects:**
${projectList}`;
  }
}
