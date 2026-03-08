// ABOUTME: Calls gateway capability decision endpoint for worker-side diagnostics.
// ABOUTME: Returns structured decision payloads for governed egress operations.
import { createLogger } from "@lobu/core";
import type { GatewayParams } from "../shared/tool-implementations";

const logger = createLogger("capability-decision-client");

export interface CapabilityDecisionRequest {
  operation: "egress_http";
  destination: string;
  method?: string;
}

export interface CapabilityDecisionResponse {
  result: "allow" | "deny" | "approval_required";
  reasonCode: string;
  message: string;
  suggestedRoutes: Array<{
    kind: string;
    target?: string;
    message: string;
  }>;
  approval: {
    required: boolean;
    scopeHint?: string;
  };
  audit: {
    decisionId: string;
    timestamp: string;
    trustZone: "personal" | "work" | "unknown";
    trustZoneSource: "agent_config" | "node_label" | "fallback";
    requiredZone?: "personal" | "work" | "unknown";
    zoneMatch: boolean;
  };
}

export async function requestCapabilityDecision(
  gw: GatewayParams,
  request: CapabilityDecisionRequest
): Promise<CapabilityDecisionResponse | null> {
  try {
    const response = await fetch(
      `${gw.gatewayUrl}/internal/capabilities/decide`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${gw.workerToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
      }
    );

    if (!response.ok) {
      logger.warn("Capability decision request failed", {
        status: response.status,
      });
      return null;
    }

    return (await response.json()) as CapabilityDecisionResponse;
  } catch (error) {
    logger.warn("Capability decision request error", { error });
    return null;
  }
}
