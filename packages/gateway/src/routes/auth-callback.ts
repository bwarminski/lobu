/**
 * Auth Callback Routes - Handle OAuth code submission from web form.
 * Used by WhatsApp users (and other non-modal platforms) to complete OAuth flow.
 */

import { createLogger } from "@peerbot/core";
import type { Request, Response, Router } from "express";
import type { ClaudeCredentialStore } from "../auth/claude/credential-store";
import type { ClaudeOAuthStateStore } from "../auth/claude/oauth-state-store";
import { ClaudeOAuthClient } from "../auth/oauth/claude-client";
import { platformAuthRegistry } from "../auth/platform-auth";

const logger = createLogger("auth-callback");

export interface AuthCallbackConfig {
  stateStore: ClaudeOAuthStateStore;
  credentialStore: ClaudeCredentialStore;
}

/**
 * Register auth callback routes on the Express app.
 */
export function registerAuthCallbackRoutes(
  router: Router,
  config: AuthCallbackConfig
): void {
  const oauthClient = new ClaudeOAuthClient();

  // GET /auth/callback - Serve the HTML form
  router.get("/auth/callback", (_req: Request, res: Response) => {
    res.setHeader("Content-Type", "text/html");
    res.send(renderCallbackPage());
  });

  // POST /auth/callback - Process the code
  router.post("/auth/callback", async (req: Request, res: Response) => {
    try {
      const { code: rawCode } = req.body;

      if (!rawCode || typeof rawCode !== "string") {
        res.status(400).send(renderErrorPage("Missing authentication code"));
        return;
      }

      // Parse CODE#STATE format
      const parts = rawCode.trim().split("#");
      if (parts.length !== 2) {
        res
          .status(400)
          .send(
            renderErrorPage(
              "Invalid format. Expected CODE#STATE format from Claude authorization."
            )
          );
        return;
      }

      const [authCode, state] = parts;

      if (!authCode || !state) {
        res
          .status(400)
          .send(renderErrorPage("Missing code or state in submission"));
        return;
      }

      logger.info(
        { hasCode: !!authCode, hasState: !!state },
        "Processing auth code submission"
      );

      // Validate and consume state
      const stateData = await config.stateStore.consume(state);
      if (!stateData) {
        res
          .status(400)
          .send(
            renderErrorPage(
              "Invalid or expired authentication state. Please try again from the beginning."
            )
          );
        return;
      }

      // Exchange code for token
      const credentials = await oauthClient.exchangeCodeForToken(
        authCode,
        stateData.codeVerifier,
        "https://console.anthropic.com/oauth/code/callback",
        state
      );

      // Store credentials using spaceId for multi-tenant isolation
      await config.credentialStore.setCredentials(
        stateData.spaceId,
        credentials
      );
      logger.info(
        { userId: stateData.userId, spaceId: stateData.spaceId },
        "OAuth successful via web callback"
      );

      // Send success message via platform adapter if context is available
      if (stateData.context) {
        const { platform, channelId } = stateData.context;
        const authAdapter = platformAuthRegistry.get(platform);
        if (authAdapter) {
          await authAdapter.sendAuthSuccess(stateData.userId, channelId, {
            id: "claude",
            name: "Claude",
          });
          logger.info(
            { platform, channelId },
            "Sent auth success message via platform adapter"
          );
        }
      }

      res.send(renderSuccessPage());
    } catch (error) {
      logger.error({ error }, "Failed to process auth callback");
      res
        .status(500)
        .send(
          renderErrorPage(
            "Failed to complete authentication. Please try again."
          )
        );
    }
  });

  logger.info("Auth callback routes registered at /auth/callback");
}

function renderCallbackPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Complete Authentication - Peerbot</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      margin: 0;
      padding: 20px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .container {
      background: white;
      border-radius: 16px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
      padding: 40px;
      max-width: 500px;
      width: 100%;
    }
    .logo {
      font-size: 48px;
      text-align: center;
      margin-bottom: 20px;
    }
    h1 {
      color: #1a1a2e;
      text-align: center;
      margin: 0 0 10px 0;
      font-size: 24px;
    }
    .subtitle {
      color: #666;
      text-align: center;
      margin-bottom: 30px;
      font-size: 14px;
    }
    .steps {
      background: #f8f9fa;
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 24px;
    }
    .step {
      display: flex;
      align-items: flex-start;
      margin-bottom: 16px;
    }
    .step:last-child { margin-bottom: 0; }
    .step-number {
      background: #667eea;
      color: white;
      width: 24px;
      height: 24px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      font-weight: bold;
      flex-shrink: 0;
      margin-right: 12px;
      margin-top: 2px;
    }
    .step-text {
      color: #333;
      font-size: 14px;
      line-height: 1.5;
    }
    .step-done {
      background: #10b981;
    }
    label {
      display: block;
      font-weight: 600;
      color: #333;
      margin-bottom: 8px;
      font-size: 14px;
    }
    input[type="text"] {
      width: 100%;
      padding: 14px 16px;
      border: 2px solid #e1e1e1;
      border-radius: 10px;
      font-size: 14px;
      font-family: monospace;
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    input[type="text"]:focus {
      outline: none;
      border-color: #667eea;
      box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.2);
    }
    input[type="text"]::placeholder {
      color: #aaa;
    }
    button {
      width: 100%;
      padding: 14px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border: none;
      border-radius: 10px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      margin-top: 16px;
      transition: transform 0.2s, box-shadow 0.2s;
    }
    button:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(102, 126, 234, 0.4);
    }
    button:active {
      transform: translateY(0);
    }
    .help-text {
      color: #888;
      font-size: 12px;
      margin-top: 8px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">🤖</div>
    <h1>Complete Authentication</h1>
    <p class="subtitle">Connect your Claude account to Peerbot</p>

    <div class="steps">
      <div class="step">
        <span class="step-number step-done">✓</span>
        <span class="step-text">Clicked the authorization link in WhatsApp</span>
      </div>
      <div class="step">
        <span class="step-number step-done">✓</span>
        <span class="step-text">Authorized with Claude and received a code</span>
      </div>
      <div class="step">
        <span class="step-number">3</span>
        <span class="step-text"><strong>Paste the code below</strong> to complete authentication</span>
      </div>
    </div>

    <form method="POST" action="/auth/callback">
      <label for="code">Authentication Code</label>
      <input
        type="text"
        id="code"
        name="code"
        placeholder="ABC123...#XYZ789..."
        autocomplete="off"
        autofocus
        required
      />
      <p class="help-text">Paste the entire code including the # symbol</p>
      <button type="submit">Complete Authentication</button>
    </form>
  </div>
</body>
</html>`;
}

function renderSuccessPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Authentication Successful - Peerbot</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background: linear-gradient(135deg, #10b981 0%, #059669 100%);
      min-height: 100vh;
      margin: 0;
      padding: 20px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .container {
      background: white;
      border-radius: 16px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
      padding: 40px;
      max-width: 500px;
      width: 100%;
      text-align: center;
    }
    .checkmark {
      font-size: 64px;
      margin-bottom: 20px;
    }
    h1 {
      color: #10b981;
      margin: 0 0 16px 0;
      font-size: 28px;
    }
    p {
      color: #666;
      font-size: 16px;
      line-height: 1.6;
      margin: 0;
    }
    .close-hint {
      margin-top: 24px;
      padding-top: 24px;
      border-top: 1px solid #eee;
      color: #888;
      font-size: 14px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="checkmark">✅</div>
    <h1>Authentication Successful!</h1>
    <p>You're now connected to Claude. Return to WhatsApp and send your message again to start chatting.</p>
    <p class="close-hint">You can safely close this page.</p>
  </div>
</body>
</html>`;
}

function renderErrorPage(message: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Authentication Error - Peerbot</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
      min-height: 100vh;
      margin: 0;
      padding: 20px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .container {
      background: white;
      border-radius: 16px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
      padding: 40px;
      max-width: 500px;
      width: 100%;
      text-align: center;
    }
    .icon {
      font-size: 64px;
      margin-bottom: 20px;
    }
    h1 {
      color: #ef4444;
      margin: 0 0 16px 0;
      font-size: 28px;
    }
    p {
      color: #666;
      font-size: 16px;
      line-height: 1.6;
      margin: 0;
    }
    .error-detail {
      background: #fef2f2;
      border: 1px solid #fecaca;
      border-radius: 8px;
      padding: 16px;
      margin-top: 20px;
      color: #b91c1c;
      font-size: 14px;
    }
    a {
      display: inline-block;
      margin-top: 24px;
      padding: 12px 24px;
      background: #ef4444;
      color: white;
      text-decoration: none;
      border-radius: 8px;
      font-weight: 600;
    }
    a:hover {
      background: #dc2626;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">❌</div>
    <h1>Authentication Failed</h1>
    <p>Something went wrong during authentication.</p>
    <div class="error-detail">${escapeHtml(message)}</div>
    <a href="/auth/callback">Try Again</a>
  </div>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
