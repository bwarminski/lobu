// ABOUTME: Verifies trust-zone resolution precedence for capability decisions.
// ABOUTME: Ensures resolver emits source metadata and normalizes invalid labels.
import { describe, expect, test } from "bun:test";
import { resolveTrustZone } from "../capabilities/trust-zone-resolver";

describe("trust zone resolver", () => {
  test("uses explicit agent trust-zone first", () => {
    const result = resolveTrustZone({
      agentTrustZone: "work",
      nodeLabels: {
        "lobu.io/trust-zone": "personal",
      },
    });

    expect(result.trustZone).toBe("work");
    expect(result.source).toBe("agent_config");
  });

  test("falls back to node label when agent trust-zone is not set", () => {
    const result = resolveTrustZone({
      nodeLabels: {
        "lobu.io/trust-zone": "personal",
      },
    });

    expect(result.trustZone).toBe("personal");
    expect(result.source).toBe("node_label");
  });

  test("falls back to unknown when neither source is available", () => {
    const result = resolveTrustZone({});
    expect(result.trustZone).toBe("unknown");
    expect(result.source).toBe("fallback");
  });

  test("normalizes unsupported node labels to unknown", () => {
    const result = resolveTrustZone({
      nodeLabels: {
        "lobu.io/trust-zone": "staging",
      },
    });

    expect(result.trustZone).toBe("unknown");
    expect(result.source).toBe("fallback");
  });
});
