# Phase 1 Capability Decision Compose Integration Test Design

## Goal
Validate the phase-1 capability decision path end-to-end with real worker and gateway processes in Docker Compose, without mocking the cross-service boundary.

## Scope (Now)
- In scope:
  - Worker -> gateway `/internal/capabilities/decide` contract wiring.
  - Gateway proxy deny/approval payload shape observed from worker-side requests.
  - Decision metadata propagation (`decisionId`, decision outcome, destination, trust-zone-derived behavior).
  - Compose-based automation runnable on a developer laptop.
- Out of scope:
  - Helm/k3s networking policy parity.
  - External registry/image-push workflow.
  - Cilium/Istio FQDN enforcement.

## Success Criteria
1. A Compose-run integration test proves worker calls gateway decision endpoint and receives expected outcomes for:
   - `allowed`
   - `deny`
   - `approval_required`
2. The test validates the structured proxy block payload contract for denied/approval-required cases.
3. The test runs locally with a single command and is stable enough to run before merge.

## Test Strategy

### Layer A: Process-level Compose integration (primary)
- Start Redis + gateway in Compose.
- Start a real worker process/container connected to gateway using real worker auth token generation path.
- Trigger worker egress attempts against representative destinations.
- Assert on observed HTTP responses and gateway logs/events to confirm decision path.

### Layer B: Existing unit/component tests (secondary guardrail)
- Keep current gateway/worker unit tests as fast checks.
- Compose test is the contract proof, not a replacement.

## Proposed Test Cases
1. `allow` path:
- Seed capability mapping for destination `api.github.com` in allowed zone.
- Execute worker network request to `https://api.github.com` via proxy path.
- Expect success status and decision audit metadata indicating `allowed`.

2. `deny` path:
- No matching capability for `api.openai.com`.
- Execute worker request.
- Expect blocked response with structured JSON payload:
  - `error`
  - `decisionId`
  - `outcome = deny`
  - destination metadata.

3. `approval_required` path:
- Seed capability rule requiring approval for a destination.
- Execute worker request.
- Expect blocked response with structured JSON payload:
  - `outcome = approval_required`
  - actionable message fields used by worker UI/diagnostics.

4. Legacy fallback compatibility path:
- Remove capability record for deployment.
- Validate existing fallback allowlist/grant behavior still applies.

## Harness Design
- Add a dedicated script under `scripts/` (example: `scripts/test-capability-e2e-compose.sh`) that:
  1. Boots compose stack.
  2. Seeds capability records (via Redis + registry format used by gateway).
  3. Runs an integration runner that executes worker-side requests.
  4. Captures logs/artifacts.
  5. Tears down stack.
- Add a Bun integration test file under a separate folder (example: `packages/gateway/src/__integration__/capability-decision-compose.test.ts`) or a shell-driven assertion script if process orchestration is easier.
- Prefer asserting via public/internal HTTP behavior, not internal class mocks.

## Commands (Target UX)
- `make dev` for interactive local loop.
- New one-shot CI-like command (to add):
  - `bun run test:integration:capabilities` (wraps compose up, test run, compose down).

## Reliability Controls
- Fixed startup waits via health checks (`/ready`, Redis ping).
- Unique test deployment IDs to avoid cross-test state pollution.
- Deterministic teardown with `docker compose down -v` for integration runs.
- Log capture to `tmp/integration-artifacts/` for failure triage.

## Rollout Plan
1. Add minimal harness with one deny case first.
2. Add allow + approval_required.
3. Add fallback-compatibility case.
4. Wire command in `package.json` and document usage in `AGENTS.md`.

## Risks and Mitigations
- Risk: brittle timing when worker registers/starts.
  - Mitigation: explicit readiness polling before assertions.
- Risk: tests accidentally assert mocked behavior.
  - Mitigation: require real HTTP requests crossing worker->gateway boundary.
- Risk: local environment variance.
  - Mitigation: single scripted entrypoint that manages stack lifecycle.

## Deferred Work
- Helm/k3s validation flow and remote-host registry push/pull path.
- Cilium FQDN-based enforcement validation for stricter network policy.
- Trust-zone-aware provider credentials:
  - Split Google and GitHub OAuth client credentials by trust zone (for example: public vs private/laptop zone) so credential scope and network policy are aligned per zone.
  - Update integration OAuth config resolution to select clientId/clientSecret from the active trust zone instead of one global env secret.
- Public callback ingress:
  - Define a concrete `PUBLIC_GATEWAY_URL` strategy for non-local OAuth callback tests (public HTTPS endpoint or tunnel).
  - Without reachable callback ingress, provider redirect/callback behavior is only partially validated in compose.
