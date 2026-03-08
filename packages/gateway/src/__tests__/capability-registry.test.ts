// ABOUTME: Verifies Redis-backed capability registry persistence and lookup behavior.
// ABOUTME: Covers key prefixing, updates, missing records, and trust-zone defaults.
import { beforeEach, describe, expect, test } from "bun:test";
import { MockRedisClient } from "@lobu/core/testing";
import { CapabilityRegistry } from "../capabilities/registry";

describe("capability registry", () => {
  let redis: MockRedisClient;
  let registry: CapabilityRegistry;

  beforeEach(() => {
    redis = new MockRedisClient();
    registry = new CapabilityRegistry(redis);
  });

  test("stores and reads records using capreg key prefix", async () => {
    await registry.put("agent-1", {
      capabilities: [
        {
          operation: "egress_http",
          destinations: ["example.com"],
        },
      ],
      trustZone: "work",
    });

    const raw = await redis.get("capreg:agent-1");
    expect(raw).not.toBeNull();

    const record = await registry.get("agent-1");
    expect(record).not.toBeNull();
    expect(record?.trustZone).toBe("work");
    expect(record?.capabilities).toHaveLength(1);
  });

  test("updates an existing record", async () => {
    await registry.put("agent-1", {
      capabilities: [],
      trustZone: "personal",
    });

    await registry.put("agent-1", {
      capabilities: [
        {
          operation: "egress_http",
          destinations: ["api.openai.com"],
          requiredTrustZone: "work",
        },
      ],
      trustZone: "work",
    });

    const record = await registry.get("agent-1");
    expect(record?.trustZone).toBe("work");
    expect(record?.capabilities[0]?.destinations).toEqual(["api.openai.com"]);
  });

  test("returns null when no record exists", async () => {
    expect(await registry.get("missing-agent")).toBeNull();
  });

  test("defaults trust-zone to unknown when omitted", async () => {
    await registry.put("agent-1", {
      capabilities: [],
    });

    const record = await registry.get("agent-1");
    expect(record?.trustZone).toBe("unknown");
  });
});
