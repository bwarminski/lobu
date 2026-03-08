# Phase 1 Capability Compose Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a real Docker Compose integration test that validates worker-to-gateway capability decision behavior (`allow`, `deny`, `approval_required`) without mocking the cross-service boundary.

**Architecture:** Add a compose-backed integration harness that starts Redis + gateway, drives a real worker-authenticated proxy request flow, and asserts on gateway decision responses. Keep existing unit tests unchanged; this plan adds a separate integration layer plus a single command entrypoint.

**Tech Stack:** Bun test runner, Bash, Docker Compose, Hono gateway endpoints, Redis (existing compose service)

---

### Task 1: Add Compose Harness Script (stack lifecycle + readiness)

**Files:**
- Create: `scripts/test-capability-e2e-compose.sh`

**Step 1: Implement harness**
- Create a shell script that:
  - starts `redis` + `gateway` from `docker/docker-compose.yml`
  - waits for `http://localhost:8080/ready`
  - writes logs to `tmp/integration-artifacts/`
  - always tears down with `docker compose down -v` on exit

**Step 2: Verify harness behavior**
Run:
```bash
bash -n scripts/test-capability-e2e-compose.sh
bash scripts/test-capability-e2e-compose.sh
```
Expected: syntax check passes; stack becomes ready and tears down cleanly.

**Step 3: Commit**
```bash
git add scripts/test-capability-e2e-compose.sh
git commit -m "test(integration): add compose lifecycle harness for capability e2e"
```

### Task 2: Add Worker-Auth Proxy Probe Utility

**Files:**
- Create: `scripts/capability-proxy-probe.ts`
- Create: `packages/gateway/src/__tests__/integration/capability-proxy-probe.test.ts`

**Step 1: Implement probe utility**
- Add utility to build proxy request URL in worker-auth form:
  - `http://<deploymentName>:<workerToken>@<gatewayHost>:8118`
- Add CLI mode to execute proxied request and print JSON result.

**Step 2: Add focused unit test for request construction**
- Validate URL assembly and target passthrough.

**Step 3: Verify**
Run:
```bash
bun test packages/gateway/src/__tests__/integration/capability-proxy-probe.test.ts
```
Expected: PASS.

**Step 4: Commit**
```bash
git add scripts/capability-proxy-probe.ts packages/gateway/src/__tests__/integration/capability-proxy-probe.test.ts
git commit -m "test(integration): add worker-auth proxy probe utility"
```

### Task 3: Add Deny Compose Integration Case

**Files:**
- Create: `packages/gateway/src/__tests__/integration/capability-decision-compose.test.ts`
- Modify: `scripts/test-capability-e2e-compose.sh`

**Step 1: Implement deny path test**
- Execute a worker-auth proxy request to destination not assigned in capabilities (e.g. `api.openai.com`).
- Assert:
  - blocked status
  - structured response includes `result: "deny"`
  - non-empty `audit.decisionId`

**Step 2: Extend harness support**
- Add mode/args for destination and seeded decision state.
- Emit normalized JSON for test assertions.

**Step 3: Verify**
Run:
```bash
bun test packages/gateway/src/__tests__/integration/capability-decision-compose.test.ts --test-name-pattern "deny"
```
Expected: PASS.

**Step 4: Commit**
```bash
git add packages/gateway/src/__tests__/integration/capability-decision-compose.test.ts scripts/test-capability-e2e-compose.sh
git commit -m "test(integration): verify deny decision across worker-gateway proxy path"
```

### Task 4: Add Approval-Required Compose Integration Case

**Files:**
- Modify: `packages/gateway/src/__tests__/integration/capability-decision-compose.test.ts`
- Modify: `scripts/test-capability-e2e-compose.sh`

**Step 1: Implement approval-required case**
- Seed capability state where destination is eligible but not granted.
- Assert blocked structured payload includes:
  - `result: "approval_required"`
  - `reasonCode: "approval_required"`

**Step 2: Verify**
Run:
```bash
bun test packages/gateway/src/__tests__/integration/capability-decision-compose.test.ts --test-name-pattern "approval_required"
```
Expected: PASS.

**Step 3: Commit**
```bash
git add packages/gateway/src/__tests__/integration/capability-decision-compose.test.ts scripts/test-capability-e2e-compose.sh
git commit -m "test(integration): verify approval_required decision across compose path"
```

### Task 5: Add Allow + Legacy Fallback Compose Cases

**Files:**
- Modify: `packages/gateway/src/__tests__/integration/capability-decision-compose.test.ts`
- Modify: `scripts/test-capability-e2e-compose.sh`

**Step 1: Implement allow case**
- Seed matching capability/grant for destination (e.g. `api.github.com`).
- Assert allowed response path with `result: "allow"`.

**Step 2: Implement legacy fallback case**
- Omit capability record for deployment.
- Assert behavior falls back to current legacy policy path and reason code contract.

**Step 3: Verify**
Run:
```bash
bun test packages/gateway/src/__tests__/integration/capability-decision-compose.test.ts
```
Expected: PASS all compose integration cases.

**Step 4: Commit**
```bash
git add packages/gateway/src/__tests__/integration/capability-decision-compose.test.ts scripts/test-capability-e2e-compose.sh
git commit -m "test(integration): add allow and fallback compose capability cases"
```

### Task 6: Wire Developer Command + Docs

**Files:**
- Modify: `package.json`
- Modify: `AGENTS.md`
- Modify: `docs/plans/phase1-tracer-verification-notes.md`

**Step 1: Add command**
- Add root script:
```json
{
  "scripts": {
    "test:integration:capabilities": "bash scripts/test-capability-e2e-compose.sh && bun test packages/gateway/src/__tests__/integration/capability-decision-compose.test.ts"
  }
}
```

**Step 2: Document usage**
- Add run instructions and artifact location (`tmp/integration-artifacts/`) in AGENTS + verification notes.

**Step 3: Verify**
Run:
```bash
bun run test:integration:capabilities
rg -n "test:integration:capabilities|test-capability-e2e-compose" AGENTS.md docs/plans/phase1-tracer-verification-notes.md
```
Expected: command passes; docs include references.

**Step 4: Commit**
```bash
git add package.json AGENTS.md docs/plans/phase1-tracer-verification-notes.md
git commit -m "docs(testing): add compose capability integration command and runbook"
```

## Final Verification Checklist
1. `bun test packages/gateway/src/__tests__/http-proxy.test.ts`
2. `bun test packages/gateway/src/__tests__/routes/capabilities-decision.test.ts`
3. `bun test packages/worker/src/__tests__/capability-decision-client.test.ts`
4. `bun test packages/worker/src/__tests__/request-network-access.test.ts`
5. `bun run test:integration:capabilities`
6. `git status --short` (confirm only intended files changed)

## Notes for Executor
- Keep the integration suite isolated from unit tests to avoid slowing default `bun test` runs.
- Do not mock worker-gateway network boundary in integration tests.
- Capture harness logs in `tmp/integration-artifacts/` for every failed run.
- Commit after each task to preserve rollback points.
- Track a follow-on implementation slice for trust-zone-aware OAuth credentials:
  - Google/GitHub integration client credentials should be resolved per trust zone rather than from one global env secret.
  - Credential selection logic should use the same trust-zone decision context used by capability decisions.
- Track a follow-on implementation slice for public callback ingress:
  - Define and document how `PUBLIC_GATEWAY_URL` is provided in developer and k3s environments (public DNS/TLS endpoint or secure tunnel).
  - Add explicit end-to-end OAuth callback validation only after callback ingress is reachable.
