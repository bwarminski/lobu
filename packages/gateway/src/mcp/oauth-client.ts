import { createLogger } from "@peerbot/core";
import type {
  OAuthTokens,
  OAuthErrorResponse,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { OAuth2Config } from "./config-service";
import type { McpCredentialRecord } from "./credential-store";

const logger = createLogger("oauth-client");

/**
 * Generic OAuth2 client for token exchange
 * Supports multiple OAuth2 providers (GitHub, Google, etc.)
 */
export class OAuth2Client {
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

    logger.info(`Exchanging code for token at ${oauth.tokenUrl}`);

    try {
      // Try JSON response first (most common)
      const response = await fetch(oauth.tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: body.toString(),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(`Token exchange failed: ${response.status}`, {
          errorText,
        });
        throw new Error(
          `Token exchange failed: ${response.status} ${response.statusText}`
        );
      }

      // Parse response - handle both JSON and form-encoded
      const contentType = response.headers.get("content-type") || "";
      let tokenData: OAuthTokens | OAuthErrorResponse;

      if (contentType.includes("application/json")) {
        tokenData = (await response.json()) as OAuthTokens | OAuthErrorResponse;
      } else {
        // Form-encoded response (e.g., GitHub when not requesting JSON)
        const text = await response.text();
        const params = new URLSearchParams(text);
        tokenData = {
          access_token: params.get("access_token") || "",
          token_type: params.get("token_type") || "Bearer",
          expires_in: params.get("expires_in")
            ? parseInt(params.get("expires_in")!, 10)
            : undefined,
          refresh_token: params.get("refresh_token") || undefined,
          scope: params.get("scope") || undefined,
        };
      }

      // Check for error in response
      if ("error" in tokenData) {
        throw new Error(
          `OAuth error: ${tokenData.error} - ${tokenData.error_description || ""}`
        );
      }

      if (!tokenData.access_token) {
        throw new Error("No access token in response");
      }

      // Build credential record
      const expiresAt = tokenData.expires_in
        ? Date.now() + tokenData.expires_in * 1000
        : undefined;

      logger.info(
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
    } catch (error) {
      logger.error("Token exchange failed", { error });
      throw error;
    }
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

    logger.info(`Refreshing token at ${oauth.tokenUrl}`);

    try {
      const response = await fetch(oauth.tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: body.toString(),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(`Token refresh failed: ${response.status}`, { errorText });
        throw new Error(
          `Token refresh failed: ${response.status} ${response.statusText}`
        );
      }

      const tokenData: OAuthTokens | OAuthErrorResponse =
        (await response.json()) as OAuthTokens | OAuthErrorResponse;

      if ("error" in tokenData) {
        throw new Error(
          `OAuth error: ${tokenData.error} - ${tokenData.error_description || ""}`
        );
      }

      if (!tokenData.access_token) {
        throw new Error("No access token in refresh response");
      }

      const expiresAt = tokenData.expires_in
        ? Date.now() + tokenData.expires_in * 1000
        : undefined;

      logger.info(
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
    } catch (error) {
      logger.error("Token refresh failed", { error });
      throw error;
    }
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
   * Resolve client secret (supports ${env:VAR_NAME} substitution)
   */
  private resolveClientSecret(clientSecret: string): string {
    // Simple ${env:VAR_NAME} substitution
    return clientSecret.replace(/\$\{env:([^}]+)\}/g, (_match, varName) => {
      return process.env[varName] || "";
    });
  }
}
