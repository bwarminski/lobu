// ABOUTME: Defines phase-1 capability decision request and response contracts.
// ABOUTME: Exports trust-zone and decision outcome literal sets used by gateway services.
export const DECISION_RESULTS = ["allow", "deny", "approval_required"] as const;
export type DecisionResult = (typeof DECISION_RESULTS)[number];

export const TRUST_ZONES = ["personal", "work", "unknown"] as const;
export type TrustZone = (typeof TRUST_ZONES)[number];

export type TrustZoneSource = "agent_config" | "node_label" | "fallback";

export interface DecisionRequest {
  agentId: string;
  sessionId: string;
  operation: "egress_http";
  destination: string;
  method?: string;
  trustZone: TrustZone;
  trustZoneSource?: TrustZoneSource;
  context?: Record<string, unknown>;
}

export interface SuggestedRoute {
  kind: string;
  target?: string;
  message: string;
}

export interface DecisionResponse {
  result: DecisionResult;
  reasonCode: string;
  message: string;
  suggestedRoutes: SuggestedRoute[];
  approval: {
    required: boolean;
    scopeHint?: string;
  };
  audit: {
    decisionId: string;
    timestamp: string;
    trustZone: TrustZone;
    trustZoneSource: TrustZoneSource;
    requiredZone?: TrustZone;
    zoneMatch: boolean;
  };
}
