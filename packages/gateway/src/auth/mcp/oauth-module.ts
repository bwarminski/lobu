import { BaseModule, createLogger, decrypt, encrypt } from "@peerbot/core";
import type { Request, Response } from "express";
import { GenericOAuth2Client } from "../oauth/generic-client";
import {
  formatMcpName,
  renderOAuthErrorPage,
  renderOAuthSuccessPage,
} from "../oauth-templates";
import type { McpConfigService } from "./config-service";
import type { McpCredentialStore } from "./credential-store";
import type { McpInputStore } from "./input-store";
import type { McpOAuthStateStore } from "./oauth-state-store";

const logger = createLogger("mcp-oauth-module");

interface McpStatus {
  id: string;
  name: string;
  isAuthenticated: boolean;
  authType: "oauth" | "discovered-oauth" | "inputs";
  metadata?: Record<string, unknown>;
  upstreamUrl: string;
}

/**
 * MCP OAuth Module - Handles OAuth authentication for MCP servers
 * Provides login/logout functionality via Slack home tab
 */
export class McpOAuthModule extends BaseModule {
  name = "mcp-oauth";
  private oauth2Client: GenericOAuth2Client;
  private publicGatewayUrl: string;
  private callbackUrl: string;

  constructor(
    private configService: McpConfigService,
    private credentialStore: McpCredentialStore,
    private stateStore: McpOAuthStateStore,
    private inputStore: McpInputStore,
    publicGatewayUrl: string,
    callbackUrl: string
  ) {
    super();

    this.oauth2Client = new GenericOAuth2Client();
    this.publicGatewayUrl = publicGatewayUrl;
    this.callbackUrl = callbackUrl;
  }

  isEnabled(): boolean {
    // Always enabled if MCP config service is available
    return true;
  }

  /**
   * Generate a secure token for OAuth init URL
   * Token contains encrypted userId, spaceId, mcpId, and expiry
   */
  private generateSecureToken(
    userId: string,
    spaceId: string,
    mcpId: string
  ): string {
    const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes
    const payload = JSON.stringify({ userId, spaceId, mcpId, expiresAt });
    return encrypt(payload);
  }

  /**
   * Validate and decode a secure token
   * Returns { userId, spaceId, mcpId } if valid, null if invalid or expired
   */
  private validateSecureToken(
    token: string
  ): { userId: string; spaceId: string; mcpId: string } | null {
    try {
      const decrypted = decrypt(token);
      const data = JSON.parse(decrypted);
      const { userId, spaceId, mcpId, expiresAt } = data;

      // Check expiry
      if (Date.now() > expiresAt) {
        logger.warn("Token expired", { userId, spaceId, mcpId });
        return null;
      }

      return { userId, spaceId, mcpId };
    } catch (error) {
      logger.error("Failed to validate token", { error });
      return null;
    }
  }

  /**
   * Register OAuth endpoints
   */
  registerEndpoints(app: any): void {
    // Initialize OAuth flow
    app.get("/mcp/oauth/init/:mcpId", async (req: Request, res: Response) => {
      await this.handleOAuthInit(req, res);
    });

    // OAuth callback endpoint
    app.get("/mcp/oauth/callback", async (req: Request, res: Response) => {
      await this.handleOAuthCallback(req, res);
    });

    // Logout endpoint
    app.post(
      "/mcp/oauth/logout/:mcpId",
      async (req: Request, res: Response) => {
        await this.handleLogout(req, res);
      }
    );

    logger.info("MCP OAuth endpoints registered");
  }

  /**
   * Get platform-agnostic authentication status for all MCP servers
   * Returns abstract provider data that can be rendered by any platform adapter
   */
  async getAuthStatus(
    userId: string,
    spaceId: string
  ): Promise<
    Array<{
      id: string;
      name: string;
      isAuthenticated: boolean;
      loginUrl?: string;
      logoutUrl?: string;
      metadata?: Record<string, any>;
    }>
  > {
    try {
      const mcpStatuses = await this.getMcpStatuses(spaceId);

      return mcpStatuses.map((mcp) => {
        const provider: {
          id: string;
          name: string;
          isAuthenticated: boolean;
          loginUrl?: string;
          logoutUrl?: string;
          metadata?: Record<string, any>;
        } = {
          id: mcp.id,
          name: mcp.name,
          isAuthenticated: mcp.isAuthenticated,
          metadata: {
            authType: mcp.authType,
            upstreamUrl: mcp.upstreamUrl,
            ...mcp.metadata,
          },
        };

        // Add login URL for OAuth-based MCPs
        if (
          !mcp.isAuthenticated &&
          (mcp.authType === "oauth" || mcp.authType === "discovered-oauth")
        ) {
          const token = this.generateSecureToken(userId, spaceId, mcp.id);
          provider.loginUrl = `${this.publicGatewayUrl}/mcp/oauth/init/${mcp.id}?token=${encodeURIComponent(token)}`;
        }

        return provider;
      });
    } catch (error) {
      logger.error("Failed to get MCP auth status", { error, userId, spaceId });
      return [];
    }
  }

  /**
   * Handle home tab action (login/logout/configure buttons)
   */
  async handleAction(
    actionId: string,
    userId: string,
    context: any
  ): Promise<boolean> {
    const spaceId = context.spaceId;
    if (!spaceId) {
      logger.error("Missing spaceId in action context", { actionId, userId });
      return false;
    }

    // Handle configure button (inputs)
    if (actionId.startsWith("mcp_configure_")) {
      const mcpId = actionId.replace("mcp_configure_", "");

      try {
        const httpServer = await this.configService.getHttpServer(mcpId);
        if (
          !httpServer ||
          !httpServer.inputs ||
          httpServer.inputs.length === 0
        ) {
          logger.error(`MCP ${mcpId} not found or has no inputs`);
          return false;
        }

        // Build modal with input fields (include spaceId in metadata)
        const modal = this.buildInputModal(mcpId, spaceId, httpServer.inputs);

        // Open modal
        if (context.client && context.body?.trigger_id) {
          await context.client.views.open({
            trigger_id: context.body.trigger_id,
            view: modal,
          });
        }

        logger.info(
          `Opened input modal for user ${userId}, space ${spaceId}, MCP ${mcpId}`
        );
        return true;
      } catch (error) {
        logger.error("Failed to handle configure action", {
          error,
          mcpId,
          userId,
          spaceId,
        });
        return false;
      }
    }

    // Handle logout/clear button
    if (actionId.startsWith("mcp_logout_")) {
      const mcpId = actionId.replace("mcp_logout_", "");

      // Delete both OAuth credentials and input values
      await this.credentialStore.deleteCredentials(spaceId, mcpId);
      await this.inputStore.deleteInputs(spaceId, mcpId);

      logger.info(`Space ${spaceId} logged out/cleared from ${mcpId}`);

      // Update home tab
      if (context.updateAppHome) {
        await context.updateAppHome(userId, context.client);
      }

      return true;
    }

    return false;
  }

  /**
   * Handle view submission (modal submitted)
   */
  async handleViewSubmission(
    _viewId: string,
    userId: string,
    values: any,
    privateMetadata: string
  ): Promise<void> {
    try {
      // Parse metadata to get mcpId and spaceId
      const metadata = JSON.parse(privateMetadata);
      const { mcpId, spaceId } = metadata;

      if (!mcpId || !spaceId) {
        logger.error("Missing mcpId or spaceId in modal metadata", {
          metadata,
        });
        return;
      }

      // Extract input values from modal submission
      const inputValues: Record<string, string> = {};
      for (const [blockId, block] of Object.entries(values)) {
        const actionIds = Object.keys(block as any);
        if (actionIds.length > 0 && actionIds[0]) {
          const actionId: string = actionIds[0];
          const value = (block as any)[actionId]?.value;
          if (value) {
            inputValues[blockId] = value;
          }
        }
      }

      // Store input values using spaceId
      await this.inputStore.setInputs(spaceId, mcpId, inputValues);
      logger.info(`Stored input values for space ${spaceId}, MCP ${mcpId}`);
    } catch (error) {
      logger.error("Failed to handle view submission", { error, userId });
      throw error;
    }
  }

  /**
   * Build Slack modal for collecting input values
   */
  private buildInputModal(mcpId: string, spaceId: string, inputs: any[]): any {
    const blocks: any[] = [];

    // Add input blocks for each required input
    for (const input of inputs) {
      blocks.push({
        type: "input",
        block_id: input.id,
        label: {
          type: "plain_text",
          text: input.description || input.id,
        },
        element: {
          type: "plain_text_input",
          action_id: input.id,
          placeholder: {
            type: "plain_text",
            text: `Enter ${input.description || input.id}`,
          },
        },
      });
    }

    return {
      type: "modal",
      callback_id: `mcp_input_modal_${mcpId}`,
      private_metadata: JSON.stringify({ mcpId, spaceId }),
      title: {
        type: "plain_text",
        text: `Configure ${formatMcpName(mcpId)}`,
      },
      submit: {
        type: "plain_text",
        text: "Save",
      },
      close: {
        type: "plain_text",
        text: "Cancel",
      },
      blocks,
    };
  }

  /**
   * Get status of all configured MCP servers for a space
   */
  private async getMcpStatuses(spaceId: string): Promise<McpStatus[]> {
    const httpServers = await this.configService.getAllHttpServers();
    logger.info(
      `getMcpStatuses: Found ${httpServers.size} HTTP servers for space ${spaceId}`
    );

    const statuses: McpStatus[] = [];

    for (const [id, serverConfig] of httpServers) {
      logger.debug(`Checking MCP ${id} for status`);

      // Support OAuth, discovered OAuth, and input-based authentication
      const hasOAuth = !!serverConfig.oauth;
      const hasInputs = !!(
        serverConfig.inputs && serverConfig.inputs.length > 0
      );

      // Check for discovered OAuth
      const discoveredOAuth = await this.configService.getDiscoveredOAuth(id);
      const hasDiscoveredOAuth = !!discoveredOAuth;

      logger.info(
        `MCP ${id}: hasOAuth=${hasOAuth}, hasInputs=${hasInputs}, hasDiscoveredOAuth=${hasDiscoveredOAuth}`
      );

      // Skip MCPs without any authentication method
      if (!hasOAuth && !hasInputs && !hasDiscoveredOAuth) {
        logger.debug(`Skipping MCP ${id} - no auth method configured`);
        continue;
      }

      let isAuthenticated = false;
      let metadata: Record<string, unknown> | undefined;
      let authType: "oauth" | "discovered-oauth" | "inputs";

      if (hasOAuth || hasDiscoveredOAuth) {
        // Check OAuth credentials (works for static and discovered OAuth)
        authType = hasOAuth ? "oauth" : "discovered-oauth";
        const credentials = await this.credentialStore.getCredentials(
          spaceId,
          id
        );
        // Show as authenticated if credentials exist, even if expired
        // Auto-refresh will handle expired tokens when MCP is used
        isAuthenticated = !!credentials?.accessToken;
        metadata = credentials?.metadata;
      } else {
        // Input-based authentication
        authType = "inputs";
        const inputValues = await this.inputStore.getInputs(spaceId, id);
        isAuthenticated = !!inputValues;
      }

      statuses.push({
        id,
        name: formatMcpName(id),
        isAuthenticated,
        authType,
        metadata,
        upstreamUrl: serverConfig.upstreamUrl,
      });
    }

    return statuses;
  }

  /**
   * Handle OAuth initialization - redirect user to MCP login
   */
  private async handleOAuthInit(req: Request, res: Response): Promise<void> {
    const { mcpId } = req.params;
    const token = req.query.token as string;

    if (!token) {
      res.status(400).json({ error: "Missing token parameter" });
      return;
    }

    if (!mcpId) {
      res.status(400).json({ error: "Missing mcpId parameter" });
      return;
    }

    // Validate and decode token
    const tokenData = this.validateSecureToken(token);
    if (!tokenData) {
      res.status(401).json({ error: "Invalid or expired token" });
      return;
    }

    // Verify mcpId matches token
    if (tokenData.mcpId !== mcpId) {
      res.status(400).json({ error: "Token mcpId mismatch" });
      return;
    }

    const { userId, spaceId } = tokenData;

    try {
      // Get MCP config
      const httpServer = await this.configService.getHttpServer(mcpId);
      if (!httpServer) {
        res.status(404).json({ error: "MCP not found" });
        return;
      }

      let oauthConfig = httpServer.oauth;

      // If no static OAuth config, check for discovered OAuth
      if (!oauthConfig) {
        const discoveredOAuth =
          await this.configService.getDiscoveredOAuth(mcpId);
        if (discoveredOAuth?.metadata) {
          logger.info(
            `Using discovered OAuth for ${mcpId} from ${discoveredOAuth.metadata.issuer}`
          );

          // Get or create client credentials via dynamic registration
          const discoveryService = this.configService.getDiscoveryService();
          if (!discoveryService) {
            res
              .status(500)
              .json({ error: "OAuth discovery service not available" });
            return;
          }

          const clientCredentials =
            await discoveryService.getOrCreateClientCredentials(
              mcpId,
              discoveredOAuth.metadata
            );

          if (!clientCredentials?.client_id) {
            // Check if MCP supports dynamic registration
            const hasRegistrationEndpoint =
              !!discoveredOAuth.metadata.registration_endpoint;

            if (!hasRegistrationEndpoint) {
              logger.warn(
                `MCP ${mcpId} does not support dynamic client registration (RFC 7591)`
              );
              res.status(400).json({
                error: `${formatMcpName(mcpId)} requires manual OAuth app setup`,
                details: `This MCP does not support automatic client registration. Please:
1. Create an OAuth app at the provider's website
2. Configure the OAuth client ID and secret in your MCP configuration
3. Add the callback URL: ${this.callbackUrl}`,
              });
            } else {
              logger.error(
                `Failed to register OAuth client for ${mcpId} despite having registration endpoint`
              );
              res.status(400).json({
                error: "Failed to register OAuth client for this MCP",
                details:
                  "Dynamic registration failed. Check server logs for details.",
              });
            }
            return;
          }

          logger.info(`Using client credentials for ${mcpId}`, {
            client_id: clientCredentials.client_id,
            has_secret: !!clientCredentials.client_secret,
          });

          // Build OAuth config from discovered metadata
          // If no client_secret (PKCE flow), set to empty string
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
        } else {
          res.status(404).json({ error: "MCP has no OAuth configuration" });
          return;
        }
      }

      // Check if we have valid OAuth config
      if (!oauthConfig) {
        res
          .status(400)
          .json({ error: "No OAuth configuration available for this MCP" });
        return;
      }

      // Generate and store state (include spaceId for credential storage)
      const state = await this.stateStore.create({ userId, spaceId, mcpId });

      // Build OAuth URL
      const loginUrl = this.oauth2Client.buildAuthUrl(
        oauthConfig,
        state,
        this.callbackUrl
      );

      // Redirect to OAuth provider
      res.redirect(loginUrl);
      logger.info(
        `Initiated OAuth for user ${userId}, space ${spaceId}, MCP ${mcpId}`
      );
    } catch (error) {
      logger.error("Failed to init OAuth", { error, mcpId, userId });
      res.status(500).json({ error: "Failed to initialize OAuth" });
    }
  }

  /**
   * Handle OAuth callback - exchange code for token and store credentials
   */
  private async handleOAuthCallback(
    req: Request,
    res: Response
  ): Promise<void> {
    const { code, state, error, error_description } = req.query;

    // Handle OAuth errors (user denied, etc.)
    if (error) {
      logger.warn(`OAuth error: ${error}`, { error_description });
      res.send(
        renderOAuthErrorPage(error as string, error_description as string)
      );
      return;
    }

    if (!code || !state) {
      res
        .status(400)
        .send(renderOAuthErrorPage("invalid_request", "Missing code or state"));
      return;
    }

    try {
      // Validate and consume state
      const stateData = await this.stateStore.consume(state as string);
      if (!stateData) {
        res
          .status(400)
          .send(
            renderOAuthErrorPage(
              "invalid_state",
              "Invalid or expired state parameter"
            )
          );
        return;
      }

      // Get MCP config for token exchange
      const httpServer = await this.configService.getHttpServer(
        stateData.mcpId
      );
      if (!httpServer) {
        res
          .status(404)
          .send(renderOAuthErrorPage("mcp_not_found", "MCP server not found"));
        return;
      }

      // Exchange code for token
      let credentials;
      let oauthConfig = httpServer.oauth;

      // If no static OAuth config, check for discovered OAuth
      if (!oauthConfig) {
        const discoveredOAuth = await this.configService.getDiscoveredOAuth(
          stateData.mcpId
        );
        if (discoveredOAuth?.metadata) {
          logger.info(
            `Using discovered OAuth for ${stateData.mcpId} from ${discoveredOAuth.metadata.issuer}`
          );

          // Get or create client credentials via dynamic registration
          const discoveryService = this.configService.getDiscoveryService();
          if (discoveryService) {
            const clientCredentials =
              await discoveryService.getOrCreateClientCredentials(
                stateData.mcpId,
                discoveredOAuth.metadata
              );

            if (clientCredentials?.client_id) {
              logger.info(`Using client credentials for ${stateData.mcpId}`, {
                client_id: clientCredentials.client_id,
                has_secret: !!clientCredentials.client_secret,
              });

              // Build OAuth config from discovered metadata
              // If no client_secret (PKCE flow), set to empty string
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
          }
        }
      }

      if (oauthConfig) {
        // Full OAuth2 token exchange
        credentials = await this.oauth2Client.exchangeCodeForToken(
          code as string,
          oauthConfig,
          this.callbackUrl
        );
      } else {
        // Fallback: use code as token (for simple cases)
        logger.warn(
          `MCP ${stateData.mcpId} has no oauth config, using code as token`
        );
        credentials = {
          accessToken: code as string,
          tokenType: "Bearer",
          expiresAt: Date.now() + 3600000, // 1 hour default
          metadata: {
            grantedAt: new Date().toISOString(),
          },
        };
      }

      // Store credentials without TTL to preserve refresh token
      // Even if access token expires, we keep credentials so we can refresh
      await this.credentialStore.setCredentials(
        stateData.spaceId,
        stateData.mcpId,
        credentials
      );

      logger.info(
        `OAuth successful for space ${stateData.spaceId}, MCP ${stateData.mcpId}`
      );

      // Show success page
      res.send(renderOAuthSuccessPage(formatMcpName(stateData.mcpId)));
    } catch (error) {
      logger.error("Failed to handle OAuth callback", {
        error,
        errorMessage: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined,
      });
      res
        .status(500)
        .send(
          renderOAuthErrorPage(
            "server_error",
            "Failed to complete authentication"
          )
        );
    }
  }

  /**
   * Handle logout - delete credentials
   */
  private async handleLogout(req: Request, res: Response): Promise<void> {
    const { mcpId } = req.params;
    const spaceId = req.body.spaceId || req.query.spaceId;

    if (!spaceId) {
      res.status(400).json({ error: "Missing spaceId" });
      return;
    }

    try {
      await this.credentialStore.deleteCredentials(spaceId as string, mcpId!);
      logger.info(`Space ${spaceId} logged out from ${mcpId}`);
      res.json({ success: true });
    } catch (error) {
      logger.error("Failed to logout", { error, mcpId, spaceId });
      res.status(500).json({ error: "Failed to logout" });
    }
  }
}
