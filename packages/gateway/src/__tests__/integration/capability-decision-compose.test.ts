// ABOUTME: Verifies compose-level capability decision behavior across worker-auth boundaries.
// ABOUTME: Exercises deny, approval, allow, and fallback outcomes without service mocks.
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";

const RUN_COMPOSE_INTEGRATION = process.env.RUN_COMPOSE_INTEGRATION === "1";
const maybeTest = RUN_COMPOSE_INTEGRATION ? test : test.skip;
const ROOT = `${process.cwd()}`;
const HARNESS = "scripts/test-capability-e2e-compose.sh";

interface ProbeResult {
  status: number;
  body?: {
    result?: string;
    reasonCode?: string;
    audit?: {
      decisionId?: string;
    };
  };
}

function runHarness(mode: string, destination: string): ProbeResult {
  const result = spawnSync("bash", [HARNESS, mode, destination], {
    cwd: ROOT,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new Error(
      `Harness failed for mode=${mode}:\nstdout=${result.stdout}\nstderr=${result.stderr}`
    );
  }

  const parsed = JSON.parse((result.stdout || "").trim()) as {
    status: number;
    body?: string | ProbeResult["body"];
  };

  if (typeof parsed.body === "string" && parsed.body.length > 0) {
    return {
      status: parsed.status,
      body: JSON.parse(parsed.body) as ProbeResult["body"],
    };
  }

  return {
    status: parsed.status,
    body: parsed.body,
  };
}

describe("capability decision compose integration", () => {
  maybeTest("returns deny payload when destination is not assigned", { timeout: 120000 }, () => {
    const result = runHarness("deny_proxy", "http://api.openai.com/v1/models");

    expect(result.status).toBe(403);
    expect(result.body?.result).toBe("deny");
    expect(result.body?.reasonCode).toBe("capability_missing");
  });

  maybeTest("returns approval_required payload when destination is eligible but not globally allowed", { timeout: 120000 }, () => {
    const result = runHarness("approval_proxy", "http://api.openai.com/v1/models");

    expect(result.status).toBe(403);
    expect(result.body?.result).toBe("approval_required");
    expect(result.body?.reasonCode).toBe("approval_required");
  });

  maybeTest("returns allow for capability-matched destination in unrestricted mode", { timeout: 120000 }, () => {
    const result = runHarness("allow_decision", "https://api.github.com/repos");

    expect(result.status).toBe(200);
    expect(result.body?.result).toBe("allow");
  });

  maybeTest("preserves legacy fallback allow when no capability record exists", { timeout: 120000 }, () => {
    const result = runHarness("fallback_allow_decision", "https://api.github.com/repos");

    expect(result.status).toBe(200);
    expect(result.body?.reasonCode).toBe("allowed_by_legacy_policy");
  });
});
