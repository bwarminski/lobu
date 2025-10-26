import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface McpServerDefinition {
  id: string;
  name: string;
  description: string;
  type: "oauth" | "api-key" | "command" | "none";
  config: any;
  setupInstructions?: string;
}

// Load MCP servers from JSON file
const mcpServersJson = readFileSync(
  join(__dirname, "mcp-servers.json"),
  "utf-8"
);
const mcpServersData = JSON.parse(mcpServersJson);

export const MCP_SERVERS: McpServerDefinition[] = mcpServersData.servers;

// Helper function to get OAuth servers
export function getOAuthServers(): McpServerDefinition[] {
  return MCP_SERVERS.filter((s) => s.type === "oauth");
}

// Helper function to generate env variable names
export function getRequiredEnvVars(servers: McpServerDefinition[]): string[] {
  const envVars = new Set<string>();

  servers.forEach((server) => {
    const configStr = JSON.stringify(server.config);
    // Extract all ${VARIABLE} and ${env:VARIABLE} patterns
    const matches = configStr.match(/\$\{(?:env:)?([A-Z_]+)\}/g) || [];
    matches.forEach((match) => {
      const varName = match.replace(/\$\{(?:env:)?([A-Z_]+)\}/, "$1");
      if (varName !== "PUBLIC_URL") {
        // PUBLIC_URL is handled separately
        envVars.add(varName);
      }
    });
  });

  return Array.from(envVars);
}
