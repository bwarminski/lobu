// ABOUTME: Verifies worker capability decision client request payload and response handling.
// ABOUTME: Ensures decision diagnostics are preserved for allow, deny, and approval-required outcomes.
import { afterEach, describe, expect, test } from "bun:test";
import {
  requestCapabilityDecision,
  type CapabilityDecisionResponse,
} from "../gateway/capability-decision-client";

let server: Bun.Server | null = null;

function startGatewayStub(
  handler: (request: Request) => Response | Promise<Response>
): string {
  server = Bun.serve({
    port: 0,
    fetch: handler,
  });
  return `http://127.0.0.1:${server.port}`;
}

describe("capability decision client", () => {
  afterEach(() => {
    server?.stop(true);
    server = null;
  });

  test("posts decision request payload to gateway endpoint", async () => {
    const gatewayUrl = startGatewayStub(async (request) => {
      const url = new URL(request.url);
      expect(url.pathname).toBe("/internal/capabilities/decide");
      expect(request.method).toBe("POST");
      expect(request.headers.get("authorization")).toBe("Bearer worker-token");
      expect(request.headers.get("content-type")).toContain(
        "application/json"
      );
      expect(await request.json()).toEqual({
        operation: "egress_http",
        destination: "example.com",
      });

      return Response.json({
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
      } satisfies CapabilityDecisionResponse);
    });

    const result = await requestCapabilityDecision(
      {
        gatewayUrl,
        workerToken: "worker-token",
        channelId: "ch",
        conversationId: "conv",
      },
      {
        operation: "egress_http",
        destination: "example.com",
      }
    );

    expect(result?.result).toBe("allow");
    expect(result?.reasonCode).toBe("allowed_by_policy");
  });

  test("returns approval_required diagnostics", async () => {
    const gatewayUrl = startGatewayStub(() =>
      Response.json({
        result: "approval_required",
        reasonCode: "approval_required",
        message: "approval needed",
        suggestedRoutes: [
          {
            kind: "request_approval",
            target: "example.com",
            message: "Request approval.",
          },
        ],
        approval: { required: true, scopeHint: "example.com" },
        audit: {
          decisionId: "decision-2",
          timestamp: "2026-03-08T00:00:00.000Z",
          trustZone: "unknown",
          trustZoneSource: "fallback",
          zoneMatch: true,
        },
      } satisfies CapabilityDecisionResponse)
    );

    const result = await requestCapabilityDecision(
      {
        gatewayUrl,
        workerToken: "worker-token",
        channelId: "ch",
        conversationId: "conv",
      },
      {
        operation: "egress_http",
        destination: "example.com",
      }
    );

    expect(result?.result).toBe("approval_required");
    expect(result?.approval.required).toBe(true);
    expect(result?.suggestedRoutes[0]?.kind).toBe("request_approval");
  });

  test("returns deny diagnostics", async () => {
    const gatewayUrl = startGatewayStub(() =>
      Response.json({
        result: "deny",
        reasonCode: "capability_missing",
        message: "Destination is not assigned in capabilities.",
        suggestedRoutes: [],
        approval: { required: false },
        audit: {
          decisionId: "decision-3",
          timestamp: "2026-03-08T00:00:00.000Z",
          trustZone: "unknown",
          trustZoneSource: "fallback",
          zoneMatch: true,
        },
      } satisfies CapabilityDecisionResponse)
    );

    const result = await requestCapabilityDecision(
      {
        gatewayUrl,
        workerToken: "worker-token",
        channelId: "ch",
        conversationId: "conv",
      },
      {
        operation: "egress_http",
        destination: "blocked.example.com",
      }
    );

    expect(result?.result).toBe("deny");
    expect(result?.reasonCode).toBe("capability_missing");
  });

  test("returns null when gateway response is not ok", async () => {
    const gatewayUrl = startGatewayStub(() =>
      Response.json({ error: "bad request" }, { status: 400 })
    );

    const result = await requestCapabilityDecision(
      {
        gatewayUrl,
        workerToken: "worker-token",
        channelId: "ch",
        conversationId: "conv",
      },
      {
        operation: "egress_http",
        destination: "example.com",
      }
    );

    expect(result).toBeNull();
  });
});
