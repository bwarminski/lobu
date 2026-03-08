// ABOUTME: Verifies network access requests evaluate all requested domains.
// ABOUTME: Prevents multi-domain requests from skipping needed approval creation.
import { afterEach, describe, expect, test } from "bun:test";
import { requestNetworkAccess } from "../shared/tool-implementations";

let server: Bun.Server | null = null;

function extractText(result: {
  content: Array<{ type: "text"; text: string }>;
}): string {
  return result.content[0]?.text || "";
}

function startGatewayStub(
  handler: (request: Request) => Response | Promise<Response>
): string {
  server = Bun.serve({
    port: 0,
    fetch: handler,
  });
  return `http://127.0.0.1:${server.port}`;
}

describe("requestNetworkAccess", () => {
  afterEach(() => {
    server?.stop(true);
    server = null;
  });

  test("requests approvals when any requested domain is not allowed", async () => {
    const calls: string[] = [];
    let settingsLinkBody: Record<string, unknown> | null = null;

    const gatewayUrl = startGatewayStub(async (request) => {
      const url = new URL(request.url);
      calls.push(url.pathname);

      if (url.pathname === "/internal/capabilities/decide") {
        const payload = (await request.json()) as {
          destination?: string;
        };
        if (payload.destination === "allowed.example.com") {
          return Response.json({
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
          });
        }
        return Response.json({
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
        });
      }

      if (url.pathname === "/internal/settings-link") {
        settingsLinkBody = (await request.json()) as Record<
          string,
          unknown
        >;
        return Response.json({ message: "approval request sent" });
      }

      return Response.json({ error: "not found" }, { status: 404 });
    });

    const result = await requestNetworkAccess(
      {
        gatewayUrl,
        workerToken: "worker-token",
        channelId: "ch",
        conversationId: "conv",
      },
      {
        domains: ["allowed.example.com", "blocked.example.com"],
        reason: "need both domains",
      }
    );

    expect(
      calls.filter((pathname) => pathname === "/internal/capabilities/decide")
    ).toHaveLength(2);
    expect(calls.some((pathname) => pathname === "/internal/settings-link")).toBe(
      true
    );
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

    const gatewayUrl = startGatewayStub(async (request) => {
      const url = new URL(request.url);
      calls.push(url.pathname);

      if (url.pathname === "/internal/capabilities/decide") {
        return Response.json({
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
        });
      }

      return Response.json({ error: "not found" }, { status: 404 });
    });

    const result = await requestNetworkAccess(
      {
        gatewayUrl,
        workerToken: "worker-token",
        channelId: "ch",
        conversationId: "conv",
      },
      {
        domains: ["allowed-1.example.com", "allowed-2.example.com"],
        reason: "need both domains",
      }
    );

    expect(
      calls.filter((pathname) => pathname === "/internal/capabilities/decide")
    ).toHaveLength(2);
    expect(calls.some((pathname) => pathname === "/internal/settings-link")).toBe(
      false
    );
    expect(extractText(result as any)).toContain(
      "No additional approval is required"
    );
  });
});
