import { createLogger, verifyWorkerToken } from "@peerbot/core";
import type { Request, Response } from "express";
import { McpCredentialStore } from "./credential-store";
import { McpConfigService } from "./config-service";

const logger = createLogger("mcp-proxy");

export class McpProxy {
  constructor(
    private readonly configService: McpConfigService,
    private readonly credentialStore: McpCredentialStore
  ) {}

  setupRoutes(app: any) {
    app.all("/mcp/:mcpId", (req: Request, res: Response) =>
      this.handleProxyRequest(req, res)
    );
    app.all("/mcp/:mcpId/*", (req: Request, res: Response) =>
      this.handleProxyRequest(req, res)
    );
  }

  private async handleProxyRequest(req: Request, res: Response) {
    const { mcpId } = req.params;
    const sessionToken = this.extractSessionToken(req);

    if (!sessionToken) {
      res.status(401).json({ error: "missing_token" });
      return;
    }

    const tokenData = verifyWorkerToken(sessionToken);
    if (!tokenData) {
      res.status(401).json({ error: "invalid_token" });
      return;
    }

    const httpServer = await this.configService.getHttpServer(mcpId);
    if (!httpServer) {
      res.status(404).json({ error: "unknown_mcp" });
      return;
    }

    const credentials = await this.credentialStore.get(
      tokenData.userId,
      mcpId
    );

    if (!credentials || !credentials.accessToken) {
      logger.info("MCP credentials missing", {
        userId: tokenData.userId,
        mcpId,
      });
      res.status(401).json({
        error: "not_authenticated",
        loginUrl: httpServer.loginUrl,
      });
      return;
    }

    if (credentials.expiresAt && credentials.expiresAt <= Date.now()) {
      logger.warn("MCP credentials expired", {
        userId: tokenData.userId,
        mcpId,
      });
      res.status(401).json({
        error: "token_expired",
        loginUrl: httpServer.loginUrl,
      });
      return;
    }

    try {
      await this.forwardRequest(req, res, httpServer.upstreamUrl, credentials);
    } catch (error) {
      logger.error("Failed to proxy MCP request", { error, mcpId });
      res.status(502).json({ error: "proxy_failure" });
    }
  }

  private extractSessionToken(req: Request): string | null {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      return authHeader.substring(7);
    }

    const tokenFromQuery = req.query.workerToken;
    if (typeof tokenFromQuery === "string") {
      return tokenFromQuery;
    }

    if (Array.isArray(tokenFromQuery)) {
      return tokenFromQuery[0];
    }

    return null;
  }

  private async forwardRequest(
    req: Request,
    res: Response,
    upstreamBaseUrl: string,
    credentials: { accessToken: string; tokenType?: string }
  ): Promise<void> {
    const upstreamUrl = this.buildUpstreamUrl(req, upstreamBaseUrl);
    const headers = this.buildUpstreamHeaders(req, credentials);
    const body = this.getRequestBody(req);

    const response = await fetch(upstreamUrl, {
      method: req.method,
      headers,
      body,
      redirect: "manual",
    });

    res.status(response.status);
    response.headers.forEach((value, key) => {
      if (key.toLowerCase() === "content-length") {
        return;
      }
      res.setHeader(key, value);
    });

    if (!response.body) {
      res.end();
      return;
    }

    const reader = response.body.getReader();

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (value) {
        res.write(typeof value === "string" ? value : Buffer.from(value));
      }
    }

    res.end();
  }

  private buildUpstreamUrl(req: Request, upstreamBaseUrl: string): string {
    const baseUrl = new URL(upstreamBaseUrl);
    const remainder = (req.params as any)[0] ? `/${(req.params as any)[0]}` : "";
    baseUrl.pathname = joinPaths(baseUrl.pathname, remainder);

    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(req.query)) {
      if (key === "workerToken") {
        continue;
      }
      if (Array.isArray(value)) {
        for (const entry of value) {
          if (entry !== undefined) {
            searchParams.append(key, String(entry));
          }
        }
      } else if (value !== undefined) {
        searchParams.append(key, String(value));
      }
    }

    baseUrl.search = searchParams.toString();
    return baseUrl.toString();
  }

  private buildUpstreamHeaders(
    req: Request,
    credentials: { accessToken: string; tokenType?: string }
  ): Record<string, string> {
    const headers: Record<string, string> = {};

    for (const [key, value] of Object.entries(req.headers)) {
      const lowerKey = key.toLowerCase();
      if (lowerKey === "host" || lowerKey === "content-length") {
        continue;
      }
      if (Array.isArray(value)) {
        headers[key] = value.join(",");
      } else if (typeof value === "string") {
        headers[key] = value;
      }
    }

    headers["authorization"] = `${
      credentials.tokenType || "Bearer"
    } ${credentials.accessToken}`;
    return headers;
  }

  private getRequestBody(req: Request): BodyInit | undefined {
    if (req.method === "GET" || req.method === "HEAD") {
      return undefined;
    }

    if (Buffer.isBuffer(req.body)) {
      return req.body;
    }

    if (typeof req.body === "string") {
      return req.body;
    }

    if (req.body && typeof req.body === "object") {
      return JSON.stringify(req.body);
    }

    return undefined;
  }
}

function joinPaths(basePath: string, suffix: string): string {
  const trimmedBase = basePath.endsWith("/")
    ? basePath.slice(0, -1)
    : basePath;
  if (!suffix) {
    return trimmedBase || "/";
  }
  const extra = suffix.startsWith("/") ? suffix : `/${suffix}`;
  return `${trimmedBase}${extra}`;
}
