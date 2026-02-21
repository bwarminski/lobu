import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { InteractionClient } from "../common/interaction-client";
import type { GatewayParams } from "../shared/tool-implementations";
import {
  askUserQuestion,
  cancelReminder,
  generateAudio,
  getChannelHistory,
  getSettingsLink,
  installMcpServer,
  listReminders,
  scheduleReminder,
  searchMcpServers,
  uploadUserFile,
} from "../shared/tool-implementations";

// Reusable Zod fragments for nested schemas used by multiple tools
const mcpServerSchema = z.object({
  id: z.string().describe("Unique identifier for the MCP server"),
  name: z.string().optional().describe("Display name for the MCP server"),
  url: z.string().optional().describe("Server URL for SSE-type MCPs"),
  type: z
    .enum(["sse", "stdio"])
    .optional()
    .describe("Server type: 'sse' for HTTP or 'stdio' for command-based"),
  command: z.string().optional().describe("Command to run for stdio-type MCPs"),
  args: z
    .array(z.string())
    .optional()
    .describe("Arguments for stdio-type MCPs"),
  envVars: z
    .array(z.string())
    .optional()
    .describe("Required environment variable names (user fills values)"),
});

const skillSchema = z.object({
  repo: z.string().describe("Skill repository (e.g., 'anthropics/skills/pdf')"),
  name: z.string().optional().describe("Display name for the skill"),
  description: z
    .string()
    .optional()
    .describe("Brief description of what the skill does"),
});

const formFieldDescription =
  "Object with field schemas. Keys are field names, values are {type: 'text'|'select'|'textarea'|'number'|'checkbox'|'multiselect', label?: string, placeholder?: string, options?: string[], required?: boolean, default?: any}";

export function createCustomToolsServer(
  gatewayUrl: string,
  workerToken: string,
  channelId: string,
  conversationId: string,
  interactionClient?: InteractionClient,
  options?: { platform?: string }
) {
  const gw: GatewayParams = {
    gatewayUrl,
    workerToken,
    channelId,
    conversationId,
    platform: options?.platform || "slack",
  };

  const tools: any[] = [
    tool(
      "UploadUserFile",
      "Use this whenever you create a visualization, chart, image, document, report, or any file that helps answer the user's request. This is how you share your work with the user.",
      {
        file_path: z
          .string()
          .describe(
            "Path to the file to show (absolute or relative to workspace)"
          ),
        description: z
          .string()
          .optional()
          .describe("Optional description of what the file contains or shows"),
      } as const,
      async (args) => uploadUserFile(gw, args)
    ),
  ];

  if (interactionClient) {
    tools.push(
      tool(
        "AskUserQuestion",
        "Ask the user a question with options. Supports three patterns: (1) Simple buttons: pass string array for immediate response. (2) Single form: pass object with field schemas to open a modal. (3) Multi-form workflow: pass array of {label, fields} to let user fill multiple forms before submitting.",
        {
          question: z.string().describe("The question to ask the user"),
          options: z.union([
            z
              .array(z.string())
              .describe(
                "Array of button labels for simple choice (e.g., ['React', 'Vue', 'Angular'])"
              ),
            z.any().describe(formFieldDescription),
            z
              .array(
                z.object({
                  label: z
                    .string()
                    .describe(
                      "Short section label (1-2 words max, under 25 chars). " +
                        "Examples: 'Personal Info', 'Work History', 'Preferences'. " +
                        "Avoid long descriptive names - keep it concise for button display."
                    ),
                  fields: z.any().describe(formFieldDescription),
                })
              )
              .describe("Array of forms for multi-step workflow"),
          ]),
        } as const,
        async (args) =>
          askUserQuestion(interactionClient, {
            question: args.question,
            options: args.options,
          })
      )
    );
  }

  tools.push(
    tool(
      "ScheduleReminder",
      "Schedule a task for yourself to execute later. Use delayMinutes for one-time reminders, or cron for recurring schedules. The reminder will be delivered as a message in this thread.",
      {
        task: z
          .string()
          .min(1)
          .max(2000)
          .describe("Description of what you need to do when reminded"),
        delayMinutes: z
          .number()
          .min(1)
          .max(1440)
          .optional()
          .describe(
            "Minutes from now to trigger (1-1440, max 24 hours). Use this OR cron, not both."
          ),
        cron: z
          .string()
          .optional()
          .describe(
            "Cron expression for recurring schedule (e.g., '*/30 * * * *' for every 30 min, '0 9 * * 1-5' for 9am weekdays). Use this OR delayMinutes, not both."
          ),
        maxIterations: z
          .number()
          .min(1)
          .max(100)
          .optional()
          .describe(
            "Maximum iterations for recurring schedules (default: 10, max: 100). Only used with cron."
          ),
      } as const,
      async (args) => scheduleReminder(gw, args)
    ),

    tool(
      "CancelReminder",
      "Cancel a previously scheduled reminder. Use the scheduleId returned from ScheduleReminder.",
      {
        scheduleId: z
          .string()
          .describe("The schedule ID returned from ScheduleReminder"),
      } as const,
      async (args) => cancelReminder(gw, args)
    ),

    tool(
      "ListReminders",
      "List all pending reminders you have scheduled. Shows upcoming reminders with their schedule IDs and remaining time.",
      {} as const,
      async () => listReminders(gw)
    ),

    tool(
      "SearchMcpServers",
      "Search for installable remote MCP servers. Returns up to 5 candidates. Use this when the user asks to connect a service (for example Gmail, Notion, Linear) and you need to find matching MCP options.",
      {
        query: z
          .string()
          .min(1)
          .describe("What to search for (e.g., 'gmail', 'notion', 'github')"),
        limit: z
          .number()
          .min(1)
          .max(5)
          .optional()
          .describe("Maximum candidates to return (default 5, max 5)"),
      } as const,
      async (args) => searchMcpServers(gw, args)
    ),

    tool(
      "InstallMcpServer",
      "Generate a settings link that pre-fills one selected MCP server for explicit user confirmation.",
      {
        mcpId: z.string().describe("MCP ID from SearchMcpServers results"),
        reason: z
          .string()
          .optional()
          .describe("Optional user-facing reason for this installation"),
      } as const,
      async (args) => installMcpServer(gw, args)
    ),

    tool(
      "GetSettingsLink",
      "Generate a settings link for the user to configure their agent. Use when the user needs to add API keys, enable skills, configure MCP servers, or change other settings. The link opens a web page where they can securely configure options. You can pre-fill environment variables, skills, and MCP servers for easy setup.",
      {
        reason: z
          .string()
          .describe(
            "Brief explanation of what the user should configure (e.g., 'add your OpenAI API key for voice transcription')"
          ),
        message: z
          .string()
          .optional()
          .describe(
            "Optional message to display on the settings page with instructions (e.g., 'Get your API key from https://platform.openai.com/api-keys')"
          ),
        prefillEnvVars: z
          .array(z.string())
          .optional()
          .describe(
            "Optional list of environment variable names to pre-fill in the settings form (e.g., ['OPENAI_API_KEY', 'TRANSCRIPTION_PROVIDER'])"
          ),
        prefillSkills: z
          .array(skillSchema)
          .optional()
          .describe(
            "Optional list of skills to pre-fill for the user to enable (e.g., [{ repo: 'anthropics/skills/pdf', name: 'PDF Reader' }])"
          ),
        prefillNixPackages: z
          .array(z.string())
          .optional()
          .describe(
            "Optional list of Nix packages to pre-fill in the system packages section (e.g., ['chromium', 'ffmpeg'])"
          ),
        prefillMcpServers: z
          .array(mcpServerSchema)
          .optional()
          .describe(
            "Optional list of MCP servers to pre-fill for the user to enable"
          ),
      } as const,
      async (args) => getSettingsLink(gw, args)
    ),

    tool(
      "GenerateAudio",
      "Generate audio from text (text-to-speech). Use when you want to respond with a voice message, read content aloud, or when the user asks for audio output. The generated audio will be sent as a voice message to the user.",
      {
        text: z
          .string()
          .max(4096)
          .describe("The text to convert to speech (max 4096 characters)"),
        voice: z
          .string()
          .optional()
          .describe(
            "Voice ID (provider-specific). OpenAI: alloy, echo, fable, onyx, nova, shimmer. ElevenLabs: voice ID. Leave empty for default."
          ),
        speed: z
          .number()
          .min(0.5)
          .max(2.0)
          .optional()
          .describe(
            "Speech speed (0.5-2.0, default 1.0). Only supported by some providers."
          ),
      } as const,
      async (args) => generateAudio(gw, args)
    ),

    tool(
      "GetChannelHistory",
      "Fetch previous messages from this conversation thread. Use when the user references past discussions, asks 'what did we talk about', or you need context. Returns messages in reverse chronological order (newest first).",
      {
        limit: z
          .number()
          .optional()
          .describe("Number of messages to fetch (default 50, max 100)"),
        before: z
          .string()
          .optional()
          .describe(
            "ISO timestamp cursor - fetch messages before this time (for pagination)"
          ),
      } as const,
      async (args) => getChannelHistory(gw, args)
    )
  );

  return createSdkMcpServer({
    name: "lobu",
    version: "1.0.0",
    tools,
  });
}
