import { createLogger } from "@peerbot/core";
import { type Request, type Response, Router } from "express";
import fetch from "node-fetch";

const logger = createLogger("dispatcher");

export interface AnthropicProxyConfig {
  enabled: boolean;
  anthropicApiKey: string;
  anthropicBaseUrl?: string;
}

export class AnthropicProxy {
  private router: Router;
  private config: AnthropicProxyConfig;

  constructor(config: AnthropicProxyConfig) {
    this.config = config;
    this.router = Router();
    this.setupRoutes();
  }

  getRouter(): Router {
    return this.router;
  }

  private setupRoutes(): void {
    // Health check for proxy
    this.router.get("/health", (_req: Request, res: Response) => {
      res.json({
        service: "anthropic-proxy",
        status: this.config.enabled ? "enabled" : "disabled",
        timestamp: new Date().toISOString(),
      });
    });

    // Proxy all requests that aren't health
    this.router.use((req, res, next) => {
      if (req.path === "/health") {
        next();
      } else {
        this.handleProxyRequest(req, res);
      }
    });
  }

  private async handleProxyRequest(req: Request, res: Response): Promise<void> {
    if (!this.config.enabled) {
      res.status(503).json({ error: "Anthropic proxy is disabled" });
      return;
    }

    try {
      // Forward request to Anthropic API
      await this.forwardToAnthropic(req, res);
    } catch (error) {
      logger.error("Anthropic proxy error:", error);
      res.status(500).json({ error: "Internal proxy error" });
    }
  }

  private async forwardToAnthropic(req: Request, res: Response): Promise<void> {
    // Check if we're using OAuth token (sk-ant-oat01-) vs API key (sk-ant-api03-)
    const isOAuthToken = this.config.anthropicApiKey.startsWith("sk-ant-oat");

    const anthropicUrl = `${this.config.anthropicBaseUrl || "https://api.anthropic.com"}${req.path}`;

    // Add ?beta=true for OAuth tokens on /v1/messages
    let finalUrl = anthropicUrl;
    if (
      isOAuthToken &&
      req.path === "/v1/messages" &&
      !anthropicUrl.includes("beta=")
    ) {
      finalUrl += `${anthropicUrl.includes("?") ? "&" : "?"}beta=true`;
    }

    const headers: Record<string, string> = {};
    let body =
      req.method !== "GET" && req.method !== "HEAD" ? req.body : undefined;

    logger.info(
      `🔧 Original body type: ${typeof body}, length: ${body ? (typeof body === "string" ? body.length : JSON.stringify(body).length) : 0}`
    );

    if (isOAuthToken) {
      logger.info(
        `🔧 OAuth token detected - passthrough body (no tool override)`
      );

      // Passthrough: do not modify request body or tools
      body = body
        ? typeof body === "string"
          ? body
          : JSON.stringify(body)
        : undefined;

      // OAuth headers (Bearer, not x-api-key)
      headers.Authorization = `Bearer ${this.config.anthropicApiKey}`;
      headers["Content-Type"] = "application/json";
      headers.Accept = "application/json";
      headers["User-Agent"] = "claude-cli/1.0.98 (external, sdk-cli)";
      headers["anthropic-version"] = "2023-06-01";
      headers["anthropic-dangerous-direct-browser-access"] = "true";
      headers["x-app"] = "cli";
      headers["x-stainless-arch"] = "arm64";
      headers["x-stainless-lang"] = "js";
      headers["x-stainless-os"] = "MacOS";
      headers["x-stainless-package-version"] = "0.60.0";
      headers["x-stainless-retry-count"] = "0";
      headers["x-stainless-runtime"] = "node";
      headers["x-stainless-runtime-version"] = "v23.10.0";
      headers["x-stainless-timeout"] = "600";
      // Keep a stable beta header without mutating tools/body
      headers["anthropic-beta"] =
        "oauth-2025-04-20,fine-grained-tool-streaming-2025-05-14";

      logger.info(`🔧 Using OAuth token with passthrough body`);
    } else {
      logger.info(`🔧 Using regular API key routing for public Anthropic API`);

      // Standard API headers for regular API keys
      headers["x-api-key"] = this.config.anthropicApiKey;
      headers["Content-Type"] =
        req.headers["content-type"] || "application/json";
      headers["User-Agent"] = req.headers["user-agent"] || "peerbot-proxy/1.0";

      // Forward additional headers that Anthropic might need
      if (req.headers["anthropic-version"]) {
        headers["anthropic-version"] = req.headers[
          "anthropic-version"
        ] as string;
      }
    }

    logger.info(`🔧 Forwarding to: ${finalUrl}`);

    try {
      const response = await fetch(finalUrl, {
        method: req.method,
        headers,
        body: body,
      });

      // Forward status code
      res.status(response.status);

      // Forward response headers
      response.headers.forEach((value: string, key: string) => {
        // Skip certain headers that shouldn't be forwarded
        // Also skip content-encoding since we're decompressing the response
        if (
          ![
            "transfer-encoding",
            "connection",
            "upgrade",
            "content-encoding",
          ].includes(key.toLowerCase())
        ) {
          res.setHeader(key, value);
        }
      });

      // Handle streaming responses
      if (
        response.headers.get("content-type")?.includes("text/event-stream") ||
        response.headers.get("transfer-encoding") === "chunked"
      ) {
        // Set up streaming
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");

        // Pipe the response stream
        response.body?.pipe(res);
      } else {
        // Handle regular responses
        const responseText = await response.text();
        res.send(responseText);
      }
    } catch (error) {
      logger.error("Error forwarding to Anthropic API:", error);
      res
        .status(502)
        .json({ error: "Bad gateway - failed to reach Anthropic API" });
    }
  }
}
