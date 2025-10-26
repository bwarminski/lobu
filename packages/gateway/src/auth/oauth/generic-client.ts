import type {
  OAuthErrorResponse,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { OAuth2Config } from "../mcp/config-service";
import type { McpCredentialRecord } from "../mcp/credential-store";
import { BaseOAuth2Client } from "./base-client";

/**
 * Generic OAuth2 client for token exchange
 * Supports multiple OAuth2 providers (GitHub, Google, etc.)
 *
 * Extends base OAuth2 client and adds client secret handling
 */
export class GenericOAuth2Client extends BaseOAuth2Client {
  constructor() {
    super("oauth-client");
  }

  /**
   * Build authorization URL with all parameters
   */
  buildAuthUrl(
    oauth: OAuth2Config,
    state: string,
    redirectUri: string
  ): string {
    const url = new URL(oauth.authUrl);
    url.searchParams.set("client_id", oauth.clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", oauth.responseType || "code");
    url.searchParams.set("state", state);

    if (oauth.scopes && oauth.scopes.length > 0) {
      url.searchParams.set("scope", oauth.scopes.join(" "));
    }

    return url.toString();
  }

  /**
   * Exchange authorization code for access token
   * Supports both JSON and form-encoded responses
   */
  async exchangeCodeForToken(
    code: string,
    oauth: OAuth2Config,
    redirectUri: string
  ): Promise<McpCredentialRecord> {
    const clientSecret = this.resolveClientSecret(oauth.clientSecret);
    if (!clientSecret) {
      throw new Error(
        `Client secret could not be resolved from: ${oauth.clientSecret}`
      );
    }

    // Build request body
    const body = new URLSearchParams({
      grant_type: oauth.grantType || "authorization_code",
      code,
      client_id: oauth.clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
    });

    const tokenData = await this.exchangeToken<
      OAuthTokens | OAuthErrorResponse
    >(oauth.tokenUrl, body, "form");

    // Check for error response
    if ("error" in tokenData) {
      throw new Error(
        `OAuth token exchange failed: ${tokenData.error}${tokenData.error_description ? ` - ${tokenData.error_description}` : ""}`
      );
    }

    // Build credential record
    const expiresAt = this.calculateExpiresAt(tokenData.expires_in);

    this.logger.info(
      `Token exchange successful, expires_in: ${tokenData.expires_in}s`
    );

    return {
      accessToken: tokenData.access_token,
      tokenType: tokenData.token_type || "Bearer",
      expiresAt,
      refreshToken: tokenData.refresh_token,
      metadata: {
        scope: tokenData.scope,
        grantedAt: new Date().toISOString(),
      },
    };
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshToken(
    refreshToken: string,
    oauth: OAuth2Config
  ): Promise<McpCredentialRecord> {
    const clientSecret = this.resolveClientSecret(oauth.clientSecret);
    if (!clientSecret) {
      throw new Error(
        `Client secret could not be resolved from: ${oauth.clientSecret}`
      );
    }

    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: oauth.clientId,
      client_secret: clientSecret,
    });

    const tokenData = await this.refreshAccessToken<
      OAuthTokens | OAuthErrorResponse
    >(oauth.tokenUrl, body, "form");

    // Check for error response
    if ("error" in tokenData) {
      throw new Error(
        `OAuth token refresh failed: ${tokenData.error}${tokenData.error_description ? ` - ${tokenData.error_description}` : ""}`
      );
    }

    const expiresAt = this.calculateExpiresAt(tokenData.expires_in);

    this.logger.info(
      `Token refresh successful, expires_in: ${tokenData.expires_in}s`
    );

    return {
      accessToken: tokenData.access_token,
      tokenType: tokenData.token_type || "Bearer",
      expiresAt,
      refreshToken: tokenData.refresh_token || refreshToken, // Keep old if not provided
      metadata: {
        scope: tokenData.scope,
        refreshedAt: new Date().toISOString(),
      },
    };
  }

  /**
   * Resolve client secret (supports ${env:VAR_NAME} substitution)
   */
  private resolveClientSecret(clientSecret: string): string {
    // Simple ${env:VAR_NAME} substitution
    return clientSecret.replace(/\$\{env:([^}]+)\}/g, (_match, varName) => {
      return process.env[varName] || "";
    });
  }
}
