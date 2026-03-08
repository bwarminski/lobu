// ABOUTME: Verifies network access requests evaluate all requested domains.
// ABOUTME: Prevents multi-domain requests from skipping needed approval creation.
import { afterEach, describe, expect, mock, test } from "bun:test";
import { requestNetworkAccess } from "../shared/tool-implementations";

const originalFetch = globalThis.fetch;

function extractText(result: {
  content: Array<{ type: "text"; text: string }>;
}): string {
  return result.content[0]?.text || "";
}

describe("requestNetworkAccess", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    mock.restore();
  });

  test("requests approvals when any requested domain is not allowed", async () => {
    const calls: string[] = [];
    let settingsLinkBody: Record<string, unknown> | null = null;

    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(url);

      if (url.endsWith("/internal/capabilities/decide")) {
        const payload = JSON.parse(String(init?.body || "{}")) as {
          destination?: string;
        };
        if (payload.destination === "allowed.example.com") {
          return new Response(
            JSON.stringify({
              result: "allow",
              reasonCode: "allowed_by_policy",
              message: "ok",
              suggestedRoutes: [],
              approval: { required: false },
              audit: {
                decisionId: "d-1",
                timestamp: "2026-03-08T00:00:00.000Z",
                trustZone: "unknown",
                trustZoneSource: "fallback",
                zoneMatch: true,
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        return new Response(
          JSON.stringify({
            result: "approval_required",
            reasonCode: "approval_required",
            message: "needs approval",
            suggestedRoutes: [
              {
                kind: "request_approval",
                target: "blocked.example.com",
                message: "request approval",
              },
            ],
            approval: { required: true, scopeHint: "blocked.example.com" },
            audit: {
              decisionId: "d-2",
              timestamp: "2026-03-08T00:00:00.000Z",
              trustZone: "unknown",
              trustZoneSource: "fallback",
              zoneMatch: true,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      if (url.endsWith("/internal/settings-link")) {
        settingsLinkBody = JSON.parse(String(init?.body || "{}")) as Record<
          string,
          unknown
        >;
        return new Response(
          JSON.stringify({ message: "approval request sent" }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      throw new Error(`Unexpected URL: ${url}`);
    }) as unknown as typeof fetch;

    const result = await requestNetworkAccess(
      {
        gatewayUrl: "http://gateway",
        workerToken: "worker-token",
        channelId: "ch",
        conversationId: "conv",
      },
      {
        domains: ["allowed.example.com", "blocked.example.com"],
        reason: "need both domains",
      }
    );

    expect(calls.filter((url) => url.endsWith("/internal/capabilities/decide"))).toHaveLength(2);
    expect(calls.some((url) => url.endsWith("/internal/settings-link"))).toBe(true);
    expect(settingsLinkBody?.grants).toEqual([
      "allowed.example.com",
      "blocked.example.com",
    ]);
    expect(extractText(result as any)).toContain(
      "Gateway decision: approval_required"
    );
  });

  test("does not create approval when all requested domains are allowed", async () => {
    const calls: string[] = [];

    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);

      if (url.endsWith("/internal/capabilities/decide")) {
        return new Response(
          JSON.stringify({
            result: "allow",
            reasonCode: "allowed_by_policy",
            message: "ok",
            suggestedRoutes: [],
            approval: { required: false },
            audit: {
              decisionId: "d-allow",
              timestamp: "2026-03-08T00:00:00.000Z",
              trustZone: "unknown",
              trustZoneSource: "fallback",
              zoneMatch: true,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      throw new Error(`Unexpected URL: ${url}`);
    }) as unknown as typeof fetch;

    const result = await requestNetworkAccess(
      {
        gatewayUrl: "http://gateway",
        workerToken: "worker-token",
        channelId: "ch",
        conversationId: "conv",
      },
      {
        domains: ["allowed-1.example.com", "allowed-2.example.com"],
        reason: "need both domains",
      }
    );

    expect(calls.filter((url) => url.endsWith("/internal/capabilities/decide"))).toHaveLength(2);
    expect(calls.some((url) => url.endsWith("/internal/settings-link"))).toBe(false);
    expect(extractText(result as any)).toContain("No additional approval is required");
  });
});
