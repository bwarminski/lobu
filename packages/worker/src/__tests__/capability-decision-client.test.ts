// ABOUTME: Verifies worker capability decision client request payload and response handling.
// ABOUTME: Ensures decision diagnostics are preserved for allow, deny, and approval-required outcomes.
import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  requestCapabilityDecision,
  type CapabilityDecisionResponse,
} from "../gateway/capability-decision-client";

const originalFetch = globalThis.fetch;

describe("capability decision client", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    mock.restore();
  });

  test("posts decision request payload to gateway endpoint", async () => {
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("http://gateway/internal/capabilities/decide");
      expect(init?.method).toBe("POST");
      expect(init?.headers).toEqual(
        expect.objectContaining({
          Authorization: "Bearer worker-token",
          "Content-Type": "application/json",
        })
      );
      expect(JSON.parse(String(init?.body))).toEqual({
        operation: "egress_http",
        destination: "example.com",
      });

      return new Response(
        JSON.stringify({
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
        } satisfies CapabilityDecisionResponse),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as unknown as typeof fetch;

    const result = await requestCapabilityDecision(
      {
        gatewayUrl: "http://gateway",
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
    globalThis.fetch = mock(async () => {
      return new Response(
        JSON.stringify({
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
        } satisfies CapabilityDecisionResponse),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as unknown as typeof fetch;

    const result = await requestCapabilityDecision(
      {
        gatewayUrl: "http://gateway",
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
    globalThis.fetch = mock(async () => {
      return new Response(
        JSON.stringify({
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
        } satisfies CapabilityDecisionResponse),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as unknown as typeof fetch;

    const result = await requestCapabilityDecision(
      {
        gatewayUrl: "http://gateway",
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
    globalThis.fetch = mock(async () => {
      return new Response(JSON.stringify({ error: "bad request" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const result = await requestCapabilityDecision(
      {
        gatewayUrl: "http://gateway",
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
