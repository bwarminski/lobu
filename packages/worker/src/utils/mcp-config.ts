import { createLogger } from "@peerbot/core";
import { getProcessManagerInstance } from "../integrations/process-manager";

const logger = createLogger("worker-mcp-config");

interface GatewayMcpConfigResponse {
  mcpServers?: Record<string, any>;
}

export async function getMCPConfigForClaude(): Promise<string | undefined> {
  const gatewayConfig = await fetchGatewayMcpConfig();
  const mergedServers: Record<string, any> = {
    ...(gatewayConfig?.mcpServers ?? {}),
  };

  const processManagerEntry = buildProcessManagerServer();
  if (processManagerEntry && !mergedServers["process-manager"]) {
    mergedServers["process-manager"] = processManagerEntry;
  }

  if (Object.keys(mergedServers).length === 0) {
    return undefined;
  }

  return JSON.stringify({ mcpServers: mergedServers }, null, 2);
}

async function fetchGatewayMcpConfig(): Promise<GatewayMcpConfigResponse | null> {
  const dispatcherUrl = process.env.DISPATCHER_URL;
  const workerToken = process.env.WORKER_TOKEN;

  if (!dispatcherUrl || !workerToken) {
    logger.warn("Missing dispatcher URL or worker token for MCP config fetch");
    return null;
  }

  try {
    const url = new URL("/worker/mcp/config", ensureBaseUrl(dispatcherUrl));
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${workerToken}`,
      },
    });

    if (!response.ok) {
      logger.warn("Gateway returned non-success status for MCP config", {
        status: response.status,
      });
      return null;
    }

    const data = (await response.json()) as GatewayMcpConfigResponse;
    if (!data || typeof data !== "object") {
      logger.warn("Gateway MCP config response malformed");
      return null;
    }

    return data;
  } catch (error) {
    logger.error("Failed to fetch MCP config from gateway", { error });
    return null;
  }
}

function buildProcessManagerServer(): Record<string, any> | null {
  const processManager = getProcessManagerInstance();
  if (!processManager) {
    return null;
  }

  return {
    type: "sse",
    url: `http://localhost:${processManager.port}/sse`,
    description:
      "Process management MCP server for background tasks with cloudflared tunnel support (HTTP streaming)",
  };
}

function ensureBaseUrl(base: string): string {
  if (!base.startsWith("http")) {
    return `http://${base.replace(/^\/+/, "")}`;
  }
  return base;
}
