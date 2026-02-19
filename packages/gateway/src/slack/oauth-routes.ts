/**
 * Slack OAuth routes for multi-workspace distribution.
 *
 * GET /slack/install       - Redirects to Slack authorize URL
 * GET /slack/oauth_callback - Handles OAuth callback, stores installation
 */

import { createLogger } from "@lobu/core";
import { Hono } from "hono";
import type Redis from "ioredis";
import type { SlackInstallationStore } from "./installation-store";

const logger = createLogger("slack-oauth");

const OAUTH_STATE_TTL_SECONDS = 300; // 5 minutes
const OAUTH_STATE_PREFIX = "slack:oauth_state:";

export interface SlackOAuthConfig {
  clientId: string;
  clientSecret: string;
  installationStore: SlackInstallationStore;
  redis: Redis;
  publicGatewayUrl: string;
  scopes?: string[];
}

function generateState(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Buffer.from(array).toString("base64url");
}

export function createSlackOAuthRoutes(config: SlackOAuthConfig): Hono {
  const app = new Hono();

  const scopes = config.scopes ?? [
    "app_mentions:read",
    "assistant:write",
    "channels:history",
    "channels:read",
    "chat:write",
    "chat:write.public",
    "commands",
    "files:read",
    "files:write",
    "groups:history",
    "groups:read",
    "im:history",
    "im:read",
    "im:write",
    "mpim:read",
    "reactions:read",
    "reactions:write",
    "users:read",
  ];

  const redirectUri = `${config.publicGatewayUrl}/slack/oauth_callback`;

  /**
   * GET /slack/install - Redirects user to Slack's authorize page
   */
  app.get("/install", async (c) => {
    const state = generateState();

    // Store state in Redis for CSRF validation
    await config.redis.setex(
      `${OAUTH_STATE_PREFIX}${state}`,
      OAUTH_STATE_TTL_SECONDS,
      JSON.stringify({ createdAt: Date.now() })
    );

    const authUrl = new URL("https://slack.com/oauth/v2/authorize");
    authUrl.searchParams.set("client_id", config.clientId);
    authUrl.searchParams.set("scope", scopes.join(","));
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("state", state);

    logger.info("Redirecting to Slack OAuth authorize page");
    return c.redirect(authUrl.toString());
  });

  /**
   * GET /slack/oauth_callback - Handles the OAuth callback from Slack
   */
  app.get("/oauth_callback", async (c) => {
    const code = c.req.query("code");
    const state = c.req.query("state");
    const error = c.req.query("error");

    if (error) {
      logger.error(`Slack OAuth error: ${error}`);
      return c.html(renderErrorPage(`Slack OAuth failed: ${error}`), 400);
    }

    if (!code || !state) {
      return c.html(renderErrorPage("Missing code or state parameter"), 400);
    }

    // Validate state (CSRF protection)
    const stateKey = `${OAUTH_STATE_PREFIX}${state}`;
    const stateData = await config.redis.get(stateKey);
    if (!stateData) {
      return c.html(
        renderErrorPage("Invalid or expired OAuth state. Please try again."),
        400
      );
    }
    // Consume state (one-time use)
    await config.redis.del(stateKey);

    // Exchange code for access token
    try {
      const tokenResponse = await fetch(
        "https://slack.com/api/oauth.v2.access",
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: config.clientId,
            client_secret: config.clientSecret,
            code,
            redirect_uri: redirectUri,
          }),
        }
      );

      const tokenData = (await tokenResponse.json()) as {
        ok: boolean;
        error?: string;
        access_token?: string;
        team?: { id: string; name: string };
        bot_user_id?: string;
        app_id?: string;
        authed_user?: { id: string };
      };

      if (!tokenData.ok || !tokenData.access_token) {
        logger.error(`Slack OAuth token exchange failed: ${tokenData.error}`);
        return c.html(
          renderErrorPage(
            `Token exchange failed: ${tokenData.error || "unknown"}`
          ),
          400
        );
      }

      const teamId = tokenData.team?.id;
      const teamName = tokenData.team?.name || "Unknown Workspace";
      const botToken = tokenData.access_token;
      const botUserId = tokenData.bot_user_id || "";
      const appId = tokenData.app_id || "";
      const installedBy = tokenData.authed_user?.id || "";

      if (!teamId) {
        return c.html(
          renderErrorPage("Missing team ID in OAuth response"),
          400
        );
      }

      // Fetch bot_id via auth.test (not included in oauth.v2.access response)
      let botId = "";
      try {
        const authTestResponse = await fetch(
          "https://slack.com/api/auth.test",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${botToken}`,
              "Content-Type": "application/json",
            },
          }
        );
        const authTestData = (await authTestResponse.json()) as {
          ok: boolean;
          bot_id?: string;
        };
        if (authTestData.ok && authTestData.bot_id) {
          botId = authTestData.bot_id;
        }
      } catch (err) {
        logger.warn("Could not fetch bot_id via auth.test", { error: err });
      }

      // Store installation
      await config.installationStore.setInstallation(teamId, {
        teamId,
        teamName,
        botToken,
        botUserId,
        botId,
        installedBy,
        installedAt: Date.now(),
        appId,
      });

      logger.info(`Slack installation stored for team ${teamId} (${teamName})`);

      return c.html(renderSuccessPage(teamName), 200);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`Slack OAuth callback error: ${message}`);
      return c.html(renderErrorPage("OAuth authentication failed"), 500);
    }
  });

  return app;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderSuccessPage(teamName: string): string {
  const safe = escapeHtml(teamName);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Lobu - Installation Complete</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #f8f9fa; }
    .card { background: white; border-radius: 12px; padding: 48px; text-align: center; box-shadow: 0 2px 8px rgba(0,0,0,0.1); max-width: 480px; }
    h1 { color: #1a1a1a; margin-bottom: 8px; }
    p { color: #666; line-height: 1.6; }
    .success { color: #16a34a; font-size: 48px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="success">&#10003;</div>
    <h1>Installation Complete</h1>
    <p>Lobu has been installed to <strong>${safe}</strong>.</p>
    <p>You can close this window and start using the bot in Slack.</p>
  </div>
</body>
</html>`;
}

function renderErrorPage(error: string): string {
  const safe = escapeHtml(error);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Lobu - Installation Error</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #f8f9fa; }
    .card { background: white; border-radius: 12px; padding: 48px; text-align: center; box-shadow: 0 2px 8px rgba(0,0,0,0.1); max-width: 480px; }
    h1 { color: #dc2626; margin-bottom: 8px; }
    p { color: #666; line-height: 1.6; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Installation Failed</h1>
    <p>${safe}</p>
    <p><a href="/slack/install">Try again</a></p>
  </div>
</body>
</html>`;
}
