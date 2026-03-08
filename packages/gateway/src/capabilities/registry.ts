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

export class CapabilityRegistry {
  constructor(private readonly redis: any) {}

  async put(agentId: string, record: AgentCapabilityRecord): Promise<void> {
    const key = this.buildKey(agentId);
    const payload: StoredAgentCapabilityRecord = {
      capabilities: record.capabilities,
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
        capabilities: Array.isArray(parsed.capabilities)
          ? parsed.capabilities
          : [],
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
