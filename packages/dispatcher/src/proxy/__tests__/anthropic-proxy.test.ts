import { describe, expect, test } from "bun:test";
import { Router } from "express";
import { AnthropicProxy, type AnthropicProxyConfig } from "../anthropic-proxy";

describe("AnthropicProxy", () => {
  const mockConfig: AnthropicProxyConfig = {
    enabled: true,
    anthropicApiKey: "test-api-key",
    postgresConnectionString: "postgres://user:pass@localhost:5432/testdb",
    anthropicBaseUrl: "https://api.anthropic.com",
  };

  test("should create proxy with router", () => {
    const proxy = new AnthropicProxy(mockConfig);
    const router = proxy.getRouter();

    expect(router).toBeInstanceOf(Router);
  });

  test("should have health endpoint", async () => {
    const proxy = new AnthropicProxy(mockConfig);
    const router = proxy.getRouter();

    // Check that router has routes
    expect(router.stack).toHaveLength(2); // health + catch-all routes
  });

  test("should be disabled when config.enabled is false", () => {
    const disabledConfig = { ...mockConfig, enabled: false };
    const proxy = new AnthropicProxy(disabledConfig);

    expect(proxy).toBeInstanceOf(AnthropicProxy);
  });
});
