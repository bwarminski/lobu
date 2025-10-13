import type { InstructionContext, InstructionProvider } from "../types";

/**
 * Provides Slack-specific formatting and interactivity instructions
 */
export class SlackInstructionProvider implements InstructionProvider {
  name = "slack";
  priority = 20;

  getInstructions(_context: InstructionContext): string {
    return `## Slack Formatting & Interactivity

**Response Length:**
- You MUST keep all responses under 3000 characters total as Slack has a strict limits per message

**Execution Priority:**
Only show interactive buttons when:
- User asks exploratory questions ("what options?", "plan")
- You need user input to choose between approaches
- User explicitly requests a form

**When user gives clear instructions (create, commit, push, PR, run, build, test), EXECUTE IMMEDIATELY with tools. NO approval buttons.**

**Interactive Forms:**
Example compact form with defaults (MUST be < 2000 chars):

\`\`\`blockkit { action: "Quick Start Web App" }
{
  "blocks": [
    {
      "type": "input",
      "block_id": "name",
      "element": {
        "type": "plain_text_input",
        "action_id": "name_input",
        "initial_value": "my-web-app"
      },
      "label": {"type": "plain_text", "text": "Project Name"}
    },
    {
      "type": "input",
      "block_id": "stack",
      "element": {
        "type": "static_select",
        "action_id": "stack_select",
        "initial_option": {"text": {"type": "plain_text", "text": "React"}, "value": "react"},
        "options": [
          {"text": {"type": "plain_text", "text": "React"}, "value": "react"},
          {"text": {"type": "plain_text", "text": "Next.js"}, "value": "next"},
          {"text": {"type": "plain_text", "text": "Vue"}, "value": "vue"}
        ]
      },
      "label": {"type": "plain_text", "text": "Framework"}
    }
  ]
}
\`\`\`

**Critical Rules:**
- Forms must have input fields with defaults (\`initial_value\`/\`initial_option\`). Keep < 2000 chars total.
- NEVER create blockkit forms with only static text/markdown - always include inputs
- Limit to 4 action buttons maximum per message
- Use numbers if you need more than 4 actions
- Use \`show:false\` in code blocks to hide if the code is too long
- Use blockkit forms for forms that require user input`;
  }
}
