// ABOUTME: Verifies structured capability decision outcomes for HTTP egress checks.
// ABOUTME: Covers allow, deny, approval-required, and trust-zone gate behavior.
import { beforeEach, describe, expect, test } from "bun:test";
import { CapabilityRegistry } from "../capabilities/registry";
import { DecisionService } from "../capabilities/decision-service";

describe("decision service", () => {
  let grantStore: {
    hasGrant: (agentId: string, pattern: string) => Promise<boolean>;
    isDenied: (agentId: string, pattern: string) => Promise<boolean>;
  };
  let capabilityRegistry: {
    get: (agentId: string) => Promise<{
      capabilities: Array<{
        operation: "egress_http";
        destinations: string[];
        requiredTrustZone?: "personal" | "work" | "unknown";
      }>;
      trustZone: "personal" | "work" | "unknown";
    } | null>;
  };
  let decisionService: DecisionService;

  beforeEach(() => {
    grantStore = {
      hasGrant: async () => false,
      isDenied: async () => false,
    };
    capabilityRegistry = {
      get: async () => ({
        capabilities: [
          {
            operation: "egress_http",
            destinations: ["example.com"],
          },
        ],
        trustZone: "personal",
      }),
    };
    decisionService = new DecisionService({
      grantStore,
      capabilityRegistry: capabilityRegistry as CapabilityRegistry,
      globalAllowedDomains: ["*"],
      globalDeniedDomains: [],
    });
  });

  test("allows when capability exists and destination is globally allowed", async () => {
    const response = await decisionService.decide({
      agentId: "agent-1",
      sessionId: "session-1",
      operation: "egress_http",
      destination: "example.com",
      trustZone: "personal",
    });

    expect(response.result).toBe("allow");
    expect(response.reasonCode).toBe("allowed_by_policy");
  });

  test("denies when destination is not in assigned capabilities", async () => {
    const response = await decisionService.decide({
      agentId: "agent-1",
      sessionId: "session-1",
      operation: "egress_http",
      destination: "api.openai.com",
      trustZone: "personal",
    });

    expect(response.result).toBe("deny");
    expect(response.reasonCode).toBe("capability_missing");
  });

  test("returns approval_required when destination is eligible but not granted", async () => {
    decisionService = new DecisionService({
      grantStore,
      capabilityRegistry: capabilityRegistry as CapabilityRegistry,
      globalAllowedDomains: [],
      globalDeniedDomains: [],
    });

    const response = await decisionService.decide({
      agentId: "agent-1",
      sessionId: "session-1",
      operation: "egress_http",
      destination: "example.com",
      trustZone: "personal",
    });

    expect(response.result).toBe("approval_required");
    expect(response.reasonCode).toBe("approval_required");
  });

  test("denies work-scoped capability when trust-zone is personal", async () => {
    capabilityRegistry.get = async () => ({
      capabilities: [
        {
          operation: "egress_http",
          destinations: ["example.com"],
          requiredTrustZone: "work",
        },
      ],
      trustZone: "work",
    });

    const response = await decisionService.decide({
      agentId: "agent-1",
      sessionId: "session-1",
      operation: "egress_http",
      destination: "example.com",
      trustZone: "personal",
    });

    expect(response.result).toBe("deny");
    expect(response.reasonCode).toBe("trust_zone_mismatch");
  });

  test("denies work-scoped capability when trust-zone is unknown", async () => {
    capabilityRegistry.get = async () => ({
      capabilities: [
        {
          operation: "egress_http",
          destinations: ["example.com"],
          requiredTrustZone: "work",
        },
      ],
      trustZone: "work",
    });

    const response = await decisionService.decide({
      agentId: "agent-1",
      sessionId: "session-1",
      operation: "egress_http",
      destination: "example.com",
      trustZone: "unknown",
    });

    expect(response.result).toBe("deny");
    expect(response.reasonCode).toBe("trust_zone_mismatch");
  });
});
