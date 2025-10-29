import { createLogger, verifyWorkerToken } from "@peerbot/core";
import type { Request, Response } from "express";
import type { IMessageQueue } from "../../infrastructure/queue";
import { GenericOAuth2Client } from "../oauth/generic-client";
import type { McpConfigService } from "./config-service";
import type { McpCredentialStore } from "./credential-store";
import type { McpInputStore } from "./input-store";
import { substituteObject, substituteString } from "./string-substitution";

const logger = createLogger("mcp-proxy");

export class McpProxy {
  private readonly oauth2Client = new GenericOAuth2Client();
  private readonly SESSION_TTL_SECONDS = 30 * 60; // 30 minutes
  private readonly redisClient: any;

  constructor(
    private readonly configService: McpConfigService,
    private readonly credentialStore: McpCredentialStore,
    private readonly inputStore: McpInputStore,
    queue: IMessageQueue
  ) {
    this.redisClient = queue.getRedisClient();
    logger.info("MCP proxy initialized with Redis session storage", {
      ttlMinutes: this.SESSION_TTL_SECONDS / 60,
    });
  }

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
      this.sendJsonRpcError(res, -32600, "Missing MCP ID");
      return;
    }

    if (!sessionToken) {
      this.sendJsonRpcError(res, -32600, "Missing authentication token");
      return;
    }

    const tokenData = verifyWorkerToken(sessionToken);
    if (!tokenData) {
      this.sendJsonRpcError(res, -32600, "Invalid authentication token");
      return;
    }

    const httpServer = await this.configService.getHttpServer(mcpId!);
    if (!httpServer) {
      this.sendJsonRpcError(res, -32601, `MCP server '${mcpId}' not found`);
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
        this.sendJsonRpcError(
          res,
          -32002,
          `MCP '${mcpId}' requires authentication. Please authenticate via the Slack app home tab.`
        );
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
                tokenEndpointAuthMethod:
                  clientCredentials.token_endpoint_auth_method,
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
              errorMessage:
                error instanceof Error ? error.message : String(error),
              errorStack: error instanceof Error ? error.stack : undefined,
              userId: tokenData.userId,
              mcpId,
            });
            this.sendJsonRpcError(
              res,
              -32002,
              `MCP '${mcpId}' authentication expired. Please re-authenticate via the Slack app home tab.`
            );
            return;
          }
        } else {
          logger.warn("MCP credentials expired with no refresh token", {
            userId: tokenData.userId,
            mcpId,
          });
          this.sendJsonRpcError(
            res,
            -32002,
            `MCP '${mcpId}' authentication expired. Please re-authenticate via the Slack app home tab.`
          );
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
        this.sendJsonRpcError(
          res,
          -32002,
          `MCP '${mcpId}' requires configuration. Please configure via the Slack app home tab.`
        );
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
      this.sendJsonRpcError(
        res,
        -32603,
        `Failed to connect to MCP '${mcpId}': ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }

  /**
   * Send a JSON-RPC 2.0 error response with 200 status code
   * This allows the MCP SDK to handle errors gracefully instead of failing
   */
  private sendJsonRpcError(
    res: Response,
    code: number,
    message: string,
    id: any = null
  ): void {
    res.status(200).json({
      jsonrpc: "2.0",
      id,
      error: {
        code,
        message,
      },
    });
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
    inputValues: Record<string, string>,
    userId: string,
    mcpId: string
  ): Promise<void> {
    const sessionKey = `mcp:session:${userId}:${mcpId}`;
    const sessionId = await this.getSession(sessionKey);

    // Get request body
    let bodyText = await this.getRequestBodyAsText(req);

    logger.info("Proxying MCP request", {
      mcpId,
      userId,
      method: req.method,
      hasSession: !!sessionId,
      bodyLength: bodyText.length,
      hasInputValues: Object.keys(inputValues).length > 0,
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

    // Apply input substitution to headers and body if inputs are provided
    if (Object.keys(inputValues).length > 0) {
      // Substitute placeholders in all header values
      for (const [key, value] of Object.entries(headers)) {
        headers[key] = substituteString(value, inputValues);
      }

      // Substitute placeholders in request body
      if (bodyText) {
        try {
          const bodyJson = JSON.parse(bodyText);
          const substitutedBody = substituteObject(bodyJson, inputValues);
          bodyText = JSON.stringify(substitutedBody);

          logger.debug("Applied input substitution to request body", {
            mcpId,
            userId,
          });
        } catch {
          // If body is not JSON, apply string substitution directly
          bodyText = substituteString(bodyText, inputValues);
        }
      }
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
      await this.setSession(sessionKey, newSessionId);
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

  /**
   * Get session ID from Redis
   */
  private async getSession(key: string): Promise<string | null> {
    try {
      const sessionId = await this.redisClient.get(key);
      if (sessionId) {
        // Refresh TTL on access
        await this.redisClient.expire(key, this.SESSION_TTL_SECONDS);
      }
      return sessionId;
    } catch (error) {
      logger.error("Failed to get MCP session from Redis", { key, error });
      return null;
    }
  }

  /**
   * Store session ID in Redis with TTL
   */
  private async setSession(key: string, sessionId: string): Promise<void> {
    try {
      await this.redisClient.set(
        key,
        sessionId,
        "EX",
        this.SESSION_TTL_SECONDS
      );
    } catch (error) {
      logger.error("Failed to store MCP session in Redis", { key, error });
    }
  }
}
