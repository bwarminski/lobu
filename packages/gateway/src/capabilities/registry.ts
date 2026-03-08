// ABOUTME: Persists per-agent capability assignments in Redis for gateway decisions.
// ABOUTME: Normalizes trust-zone metadata and applies defaults on read/write paths.
import type { TrustZone } from "./types";
import { TRUST_ZONES } from "./types";

const KEY_PREFIX = "capreg:";

export interface AgentCapability {
  operation: "egress_http";
  destinations: string[];
  requiredTrustZone?: TrustZone;
}

export interface AgentCapabilityRecord {
  capabilities: AgentCapability[];
  trustZone?: TrustZone;
}

export interface StoredAgentCapabilityRecord {
  capabilities: AgentCapability[];
  trustZone: TrustZone;
}

function isTrustZone(value: unknown): value is TrustZone {
  return (
    typeof value === "string" &&
    (TRUST_ZONES as readonly string[]).includes(value)
  );
}

function normalizeDestinations(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(
    (entry): entry is string => typeof entry === "string" && entry.length > 0
  );
}

function normalizeCapability(value: unknown): AgentCapability | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as {
    operation?: unknown;
    destinations?: unknown;
    requiredTrustZone?: unknown;
  };
  if (candidate.operation !== "egress_http") {
    return null;
  }

  const destinations = normalizeDestinations(candidate.destinations);
  if (destinations.length === 0) {
    return null;
  }

  return {
    operation: "egress_http",
    destinations,
    ...(isTrustZone(candidate.requiredTrustZone) && {
      requiredTrustZone: candidate.requiredTrustZone,
    }),
  };
}

function normalizeCapabilities(value: unknown): AgentCapability[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => normalizeCapability(entry))
    .filter((entry): entry is AgentCapability => entry !== null);
}

export class CapabilityRegistry {
  constructor(private readonly redis: any) {}

  async put(agentId: string, record: AgentCapabilityRecord): Promise<void> {
    const key = this.buildKey(agentId);
    const payload: StoredAgentCapabilityRecord = {
      capabilities: normalizeCapabilities(record.capabilities),
      trustZone: isTrustZone(record.trustZone) ? record.trustZone : "unknown",
    };
    await this.redis.set(key, JSON.stringify(payload));
  }

  async get(agentId: string): Promise<StoredAgentCapabilityRecord | null> {
    const key = this.buildKey(agentId);
    const raw = await this.redis.get(key);
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as AgentCapabilityRecord;
      return {
        capabilities: normalizeCapabilities(parsed.capabilities),
        trustZone: isTrustZone(parsed.trustZone) ? parsed.trustZone : "unknown",
      };
    } catch {
      return null;
    }
  }

  private buildKey(agentId: string): string {
    return `${KEY_PREFIX}${agentId}`;
  }
}
