// ABOUTME: Verifies internal capabilities decision endpoint auth and contract passthrough.
// ABOUTME: Ensures worker requests receive structured decision responses from DecisionService.
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { generateWorkerToken } from "@lobu/core";
import { createCapabilitiesDecisionRoutes } from "../../routes/internal/capabilities-decision";

describe("capabilities decision routes", () => {
  let originalKey: string | undefined;
  let workerToken: string;
  let decisionService: {
    decide: ReturnType<typeof mock>;
  };
  let router: ReturnType<typeof createCapabilitiesDecisionRoutes>;

  beforeEach(() => {
    originalKey = process.env.ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY =
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    workerToken = generateWorkerToken("user-1", "conv-1", "deploy-1", {
      channelId: "chan-1",
      teamId: "team-1",
      agentId: "agent-1",
    });

    decisionService = {
      decide: mock(async () => ({
        result: "allow",
        reasonCode: "allowed_by_policy",
        message: "ok",
        suggestedRoutes: [],
        approval: { required: false },
        audit: {
          decisionId: "decision-1",
          timestamp: "2026-03-08T00:00:00.000Z",
          trustZone: "unknown",
          trustZoneSource: "fallback",
          zoneMatch: true,
        },
      })),
    };

    router = createCapabilitiesDecisionRoutes(decisionService as any);
  });

  afterEach(() => {
    if (originalKey !== undefined) {
      process.env.ENCRYPTION_KEY = originalKey;
    } else {
      delete process.env.ENCRYPTION_KEY;
    }
  });

  test("returns 401 without worker token", async () => {
    const response = await router.request("/internal/capabilities/decide", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operation: "egress_http",
        destination: "example.com",
      }),
    });

    expect(response.status).toBe(401);
  });

  test("returns 400 for invalid payload", async () => {
    const response = await router.request("/internal/capabilities/decide", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${workerToken}`,
      },
      body: JSON.stringify({
        operation: "egress_http",
      }),
    });

    expect(response.status).toBe(400);
  });

  test("returns decision payload from decision service", async () => {
    const response = await router.request("/internal/capabilities/decide", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${workerToken}`,
      },
      body: JSON.stringify({
        operation: "egress_http",
        destination: "example.com",
        trustZone: "personal",
      }),
    });

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.result).toBe("allow");
    expect(json.reasonCode).toBe("allowed_by_policy");
    expect(decisionService.decide).toHaveBeenCalledTimes(1);
    expect(decisionService.decide).toHaveBeenCalledWith(
      expect.objectContaining({
        trustZone: "unknown",
        trustZoneSource: "fallback",
      })
    );
  });
});
