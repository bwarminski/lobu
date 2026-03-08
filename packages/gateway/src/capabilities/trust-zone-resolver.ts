// ABOUTME: Resolves effective trust-zone using agent metadata and node labels.
// ABOUTME: Applies deterministic precedence and returns trust-zone source metadata.
import type { TrustZone, TrustZoneSource } from "./types";
import { TRUST_ZONES } from "./types";

interface ResolveTrustZoneInput {
  agentTrustZone?: TrustZone;
  nodeLabels?: Record<string, string | undefined>;
}

interface ResolveTrustZoneResult {
  trustZone: TrustZone;
  source: TrustZoneSource;
}

function normalizeTrustZone(value: unknown): TrustZone | null {
  if (
    typeof value === "string" &&
    (TRUST_ZONES as readonly string[]).includes(value)
  ) {
    return value as TrustZone;
  }
  return null;
}

export function resolveTrustZone(
  input: ResolveTrustZoneInput
): ResolveTrustZoneResult {
  const agentTrustZone = normalizeTrustZone(input.agentTrustZone);
  if (agentTrustZone) {
    return {
      trustZone: agentTrustZone,
      source: "agent_config",
    };
  }

  const nodeLabelTrustZone = normalizeTrustZone(
    input.nodeLabels?.["lobu.io/trust-zone"]
  );
  if (nodeLabelTrustZone) {
    return {
      trustZone: nodeLabelTrustZone,
      source: "node_label",
    };
  }

  return {
    trustZone: "unknown",
    source: "fallback",
  };
}
