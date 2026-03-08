// ABOUTME: Verifies capability decision contract exports and accepted value literals.
// ABOUTME: Keeps phase-1 request/response field requirements explicit.
import { describe, expect, test } from "bun:test";
import {
  DECISION_RESULTS,
  TRUST_ZONES,
  type DecisionRequest,
  type DecisionResponse,
} from "../capabilities/types";

describe("capabilities types", () => {
  test("exports expected decision result literals", () => {
    expect(DECISION_RESULTS).toEqual(["allow", "deny", "approval_required"]);
  });

  test("exports expected trust-zone literals", () => {
    expect(TRUST_ZONES).toEqual(["personal", "work", "unknown"]);
  });

  test("accepts required decision request fields", () => {
    const request: DecisionRequest = {
      agentId: "agent-1",
      sessionId: "session-1",
      operation: "egress_http",
      destination: "example.com",
      trustZone: "personal",
    };

    expect(request.agentId).toBe("agent-1");
    expect(request.operation).toBe("egress_http");
  });

  test("accepts required decision response fields", () => {
    const response: DecisionResponse = {
      result: "allow",
      reasonCode: "allowed_by_policy",
      message: "ok",
      suggestedRoutes: [],
      approval: {
        required: false,
      },
      audit: {
        decisionId: "d-1",
        timestamp: "2026-03-08T00:00:00.000Z",
        trustZone: "personal",
        trustZoneSource: "agent_config",
        zoneMatch: true,
      },
    };

    expect(response.result).toBe("allow");
    expect(response.audit.decisionId).toBe("d-1");
  });
});
