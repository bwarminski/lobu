import type { AgentTool } from "@mariozechner/pi-agent-core";
import {
  createBashTool,
  createEditTool,
  createFindTool,
  createGrepTool,
  createLsTool,
  createReadTool,
  createWriteTool,
} from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

type RequiredParamGroup = {
  keys: readonly string[];
  allowEmpty?: boolean;
  label?: string;
};

const CLAUDE_PARAM_GROUPS: Record<
  "read" | "write" | "edit",
  RequiredParamGroup[]
> = {
  read: [{ keys: ["path", "file_path"], label: "path (path or file_path)" }],
  write: [{ keys: ["path", "file_path"], label: "path (path or file_path)" }],
  edit: [
    { keys: ["path", "file_path"], label: "path (path or file_path)" },
    {
      keys: ["oldText", "old_string"],
      label: "oldText (oldText or old_string)",
    },
    {
      keys: ["newText", "new_string"],
      label: "newText (newText or new_string)",
    },
  ],
};

function normalizeToolParams(
  params: unknown
): Record<string, unknown> | undefined {
  if (!params || typeof params !== "object") {
    return undefined;
  }
  const record = params as Record<string, unknown>;
  const normalized = { ...record };

  if ("file_path" in normalized && !("path" in normalized)) {
    normalized.path = normalized.file_path;
    delete normalized.file_path;
  }
  if ("old_string" in normalized && !("oldText" in normalized)) {
    normalized.oldText = normalized.old_string;
    delete normalized.old_string;
  }
  if ("new_string" in normalized && !("newText" in normalized)) {
    normalized.newText = normalized.new_string;
    delete normalized.new_string;
  }
  return normalized;
}

function assertRequiredParams(
  params: Record<string, unknown>,
  groups: RequiredParamGroup[]
): void {
  for (const group of groups) {
    const hasValue = group.keys.some((key) => {
      const value = params[key];
      if (value === undefined || value === null) {
        return false;
      }
      if (
        !group.allowEmpty &&
        typeof value === "string" &&
        value.trim() === ""
      ) {
        return false;
      }
      return true;
    });
    if (!hasValue) {
      const label = group.label ?? group.keys.join(" or ");
      throw new Error(`Missing required parameter: ${label}`);
    }
  }
}

function wrapToolWithNormalization(params: {
  tool: AgentTool<any>;
  required: RequiredParamGroup[];
  schema: unknown;
}): AgentTool<any> {
  const { tool, required, schema } = params;
  return {
    ...tool,
    parameters: schema as any,
    execute: async (toolCallId, rawParams, signal, onUpdate) => {
      const normalized = normalizeToolParams(rawParams) ?? {};
      assertRequiredParams(normalized, required);
      return tool.execute(toolCallId, normalized as any, signal, onUpdate);
    },
  };
}

function buildReadSchema() {
  return Type.Object({
    path: Type.Optional(Type.String({ description: "Path to the file" })),
    file_path: Type.Optional(Type.String({ description: "Path to the file" })),
    offset: Type.Optional(
      Type.Number({ description: "Start reading at this byte offset" })
    ),
    limit: Type.Optional(Type.Number({ description: "Maximum bytes to read" })),
  });
}

function buildWriteSchema() {
  return Type.Object({
    path: Type.Optional(Type.String({ description: "Path to the file" })),
    file_path: Type.Optional(Type.String({ description: "Path to the file" })),
    content: Type.String({ description: "Content to write" }),
  });
}

function buildEditSchema() {
  return Type.Object({
    path: Type.Optional(Type.String({ description: "Path to the file" })),
    file_path: Type.Optional(Type.String({ description: "Path to the file" })),
    oldText: Type.Optional(Type.String({ description: "Text to replace" })),
    old_string: Type.Optional(Type.String({ description: "Text to replace" })),
    newText: Type.Optional(Type.String({ description: "Replacement text" })),
    new_string: Type.Optional(Type.String({ description: "Replacement text" })),
  });
}

export function createOpenClawTools(cwd: string): AgentTool<any>[] {
  const read = wrapToolWithNormalization({
    tool: createReadTool(cwd),
    required: CLAUDE_PARAM_GROUPS.read,
    schema: buildReadSchema(),
  });

  const write = wrapToolWithNormalization({
    tool: createWriteTool(cwd),
    required: CLAUDE_PARAM_GROUPS.write,
    schema: buildWriteSchema(),
  });

  const edit = wrapToolWithNormalization({
    tool: createEditTool(cwd),
    required: CLAUDE_PARAM_GROUPS.edit,
    schema: buildEditSchema(),
  });

  return [
    read,
    write,
    edit,
    createBashTool(cwd),
    createGrepTool(cwd),
    createFindTool(cwd),
    createLsTool(cwd),
  ];
}
