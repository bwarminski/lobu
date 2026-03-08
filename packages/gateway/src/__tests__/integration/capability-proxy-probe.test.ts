// ABOUTME: Verifies proxy probe request construction for worker-authenticated proxy calls.
// ABOUTME: Ensures integration scripts build consistent proxy URLs for gateway access.
import { describe, expect, test } from "bun:test";
import { buildProxyRequest } from "../../../../../scripts/capability-proxy-probe";

describe("capability proxy probe", () => {
  test("builds proxy URL with worker credentials", () => {
    const request = buildProxyRequest({
      gatewayHost: "localhost",
      deploymentName: "worker-a",
      workerToken: "token-123",
      destination: "https://api.example.com/v1/ping",
    });

    expect(request.proxyUrl).toBe("http://worker-a:token-123@localhost:8118");
    expect(request.targetUrl).toBe("https://api.example.com/v1/ping");
  });
});
