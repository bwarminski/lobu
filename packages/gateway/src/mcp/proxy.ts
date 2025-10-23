import { createLogger, verifyWorkerToken } from "@peerbot/core";
import type { Request, Response } from "express";
import type { McpCredentialStore } from "./credential-store";
import type { McpConfigService } from "./config-service";
import type { McpInputStore } from "./input-store";
import { OAuth2Client } from "./oauth-client";

const logger = createLogger("mcp-proxy");

export class McpProxy {
  private readonly sessions = new Map<string, string>(); // userId:mcpId -> sessionId
  private readonly oauth2Client = new OAuth2Client();

  constructor(
    private readonly configService: McpConfigService,
    private readonly credentialStore: McpCredentialStore,
    private readonly inputStore: McpInputStore
  ) {}

  setupRoutes(app: any) {
    // Handle MCP HTTP protocol endpoints (Claude Code HTTP transport)
    // Claude Code HTTP transport POSTs to the exact URL configured
    // Since we configure http://gateway:8080, it POSTs to http://gateway:8080/
    // We use X-Mcp-Id header to identify which MCP server

    // Main endpoint - Claude Code POSTs JSON-RPC to root path
    app.all("/", (req: Request, res: Response, next: any) => {
      // Only handle requests with X-Mcp-Id header as MCP proxy requests
      if (req.headers["x-mcp-id"]) {
        return this.handleProxyRequest(req, res);
      }
      // Pass through other requests to next handler
      next();
    });

    // Legacy endpoints (if needed for other MCP transports)
    app.all("/register", (req: Request, res: Response) =>
      this.handleProxyRequest(req, res)
    );
    app.all("/message", (req: Request, res: Response) =>
      this.handleProxyRequest(req, res)
    );

    // Path-based routes (for SSE or other transports)
    app.all("/mcp/:mcpId", (req: Request, res: Response) =>
      this.handleProxyRequest(req, res)
    );
    app.all("/mcp/:mcpId/*", (req: Request, res: Response) =>
      this.handleProxyRequest(req, res)
    );
  }

  private async handleProxyRequest(req: Request, res: Response) {
    // Extract MCP ID from either URL path or X-Mcp-Id header
    const mcpId = req.params.mcpId || (req.headers["x-mcp-id"] as string);
    const sessionToken = this.extractSessionToken(req);

    logger.info("Handling MCP proxy request", {
      method: req.method,
      path: req.path,
      mcpId,
      hasSessionToken: !!sessionToken,
    });

    if (!mcpId) {
      res.status(400).json({ error: "missing_mcp_id" });
      return;
    }

    if (!sessionToken) {
      res.status(401).json({ error: "missing_token" });
      return;
    }

    const tokenData = verifyWorkerToken(sessionToken);
    if (!tokenData) {
      res.status(401).json({ error: "invalid_token" });
      return;
    }

    const httpServer = await this.configService.getHttpServer(mcpId!);
    if (!httpServer) {
      res.status(404).json({ error: "unknown_mcp" });
      return;
    }

    // Check authentication - OAuth or inputs
    let credentials = null;
    let inputValues = null;

    // Check if MCP requires OAuth (static or discovered)
    const hasOAuth = !!httpServer.oauth;
    const discoveredOAuth = await this.configService.getDiscoveredOAuth(mcpId!);
    const hasDiscoveredOAuth = !!discoveredOAuth;

    // Try OAuth credentials first (supports both static and discovered OAuth)
    if (hasOAuth || hasDiscoveredOAuth) {
      credentials = await this.credentialStore.getCredentials(
        tokenData.userId,
        mcpId!
      );

      if (!credentials || !credentials.accessToken) {
        logger.info("MCP OAuth credentials missing", {
          userId: tokenData.userId,
          mcpId,
        });
        res.status(401).json({
          error: "not_authenticated",
          message:
            "OAuth authentication required. Please authenticate via home tab.",
        });
        return;
      }

      // Check if token is expired and attempt refresh
      if (credentials.expiresAt && credentials.expiresAt <= Date.now()) {
        logger.info("MCP access token expired, attempting refresh", {
          userId: tokenData.userId,
          mcpId,
          hasRefreshToken: !!credentials.refreshToken,
        });

        if (credentials.refreshToken) {
          try {
            // Get OAuth config (static or discovered)
            let oauthConfig = httpServer.oauth;

            if (!oauthConfig && discoveredOAuth?.metadata) {
              // Build OAuth config from discovered metadata
              const discoveryService = this.configService.getDiscoveryService();
              if (!discoveryService) {
                throw new Error("OAuth discovery service not available");
              }

              const clientCredentials =
                await discoveryService.getOrCreateClientCredentials(
                  mcpId!,
                  discoveredOAuth.metadata
                );

              if (!clientCredentials?.client_id) {
                throw new Error("Failed to get client credentials for refresh");
              }

              oauthConfig = {
                authUrl: discoveredOAuth.metadata.authorization_endpoint,
                tokenUrl: discoveredOAuth.metadata.token_endpoint,
                clientId: clientCredentials.client_id,
                clientSecret: clientCredentials.client_secret || "",
                scopes: discoveredOAuth.metadata.scopes_supported || [],
                grantType: "authorization_code",
                responseType: "code",
              };
            }

            if (!oauthConfig) {
              throw new Error("No OAuth config available for refresh");
            }

            // Attempt to refresh the token
            const refreshedCredentials = await this.oauth2Client.refreshToken(
              credentials.refreshToken,
              oauthConfig
            );

            // Store the new credentials (without TTL)
            await this.credentialStore.setCredentials(
              tokenData.userId,
              mcpId!,
              refreshedCredentials
            );

            // Use the refreshed credentials
            credentials = refreshedCredentials;

            logger.info("Successfully refreshed MCP access token", {
              userId: tokenData.userId,
              mcpId,
            });
          } catch (error) {
            logger.error("Failed to refresh MCP access token", {
              error,
              userId: tokenData.userId,
              mcpId,
            });
            res.status(401).json({
              error: "token_refresh_failed",
              message:
                "Failed to refresh expired token. Please re-authenticate via home tab.",
            });
            return;
          }
        } else {
          logger.warn("MCP credentials expired with no refresh token", {
            userId: tokenData.userId,
            mcpId,
          });
          res.status(401).json({
            error: "token_expired",
            message: "Token expired. Please re-authenticate via home tab.",
          });
          return;
        }
      }
    }

    // Load input values if MCP uses inputs
    if (httpServer.inputs && httpServer.inputs.length > 0) {
      inputValues = await this.inputStore.getInputs(tokenData.userId, mcpId!);

      if (!inputValues) {
        logger.info("MCP input values missing", {
          userId: tokenData.userId,
          mcpId,
        });
        res.status(401).json({
          error: "not_configured",
          message:
            "Input values not configured. Please configure via home tab.",
        });
        return;
      }
    }

    try {
      await this.forwardRequestWithProtocolTranslation(
        req,
        res,
        httpServer,
        credentials,
        inputValues || {},
        tokenData.userId,
        mcpId!
      );
    } catch (error) {
      logger.error("Failed to proxy MCP request", { error, mcpId });
      res.status(502).json({ error: "proxy_failure" });
    }
  }

  private extractSessionToken(req: Request): string | null {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      return authHeader.substring(7);
    }

    const tokenFromQuery = req.query.workerToken;
    if (typeof tokenFromQuery === "string") {
      return tokenFromQuery;
    }

    if (
      Array.isArray(tokenFromQuery) &&
      typeof tokenFromQuery[0] === "string"
    ) {
      return tokenFromQuery[0];
    }

    return null;
  }

  private async forwardRequestWithProtocolTranslation(
    req: Request,
    res: Response,
    httpServer: any,
    credentials: { accessToken: string; tokenType?: string } | null,
    _inputValues: Record<string, string>,
    userId: string,
    mcpId: string
  ): Promise<void> {
    const sessionKey = `${userId}:${mcpId}`;
    const sessionId = this.sessions.get(sessionKey);

    // Get request body
    const bodyText = await this.getRequestBodyAsText(req);

    logger.info("Proxying MCP request", {
      mcpId,
      userId,
      method: req.method,
      hasSession: !!sessionId,
      bodyLength: bodyText.length,
    });

    // Build headers for upstream request
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };

    // Add session ID if we have one
    if (sessionId) {
      headers["Mcp-Session-Id"] = sessionId;
    }

    // Add OAuth token if provided
    if (credentials?.accessToken) {
      headers.Authorization = `Bearer ${credentials.accessToken}`;
    }

    // Forward to upstream MCP - stream response directly back
    const response = await fetch(httpServer.upstreamUrl, {
      method: req.method,
      headers,
      body: bodyText || undefined,
    });

    // Extract and store session ID from response
    const newSessionId = response.headers.get("Mcp-Session-Id");
    if (newSessionId) {
      this.sessions.set(sessionKey, newSessionId);
      logger.debug("Stored MCP session ID", {
        mcpId,
        userId,
        sessionId: newSessionId,
      });
    }

    // Stream response back to Claude Code
    const contentType = response.headers.get("content-type");
    if (contentType) {
      res.setHeader("Content-Type", contentType);
    }
    if (newSessionId) {
      res.setHeader("Mcp-Session-Id", newSessionId);
    }

    res.status(response.status);

    // Stream the response body
    if (response.body) {
      const reader = response.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
      } finally {
        reader.releaseLock();
      }
    }

    res.end();
  }

  private async getRequestBodyAsText(req: Request): Promise<string> {
    if (req.method === "GET" || req.method === "HEAD") {
      return "";
    }

    if (Buffer.isBuffer(req.body)) {
      return req.body.toString("utf-8");
    }

    if (typeof req.body === "string") {
      return req.body;
    }

    if (req.body && typeof req.body === "object") {
      return JSON.stringify(req.body);
    }

    return "";
  }
}
