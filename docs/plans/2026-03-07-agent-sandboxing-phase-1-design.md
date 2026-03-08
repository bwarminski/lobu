# Phase 1 Design: Capability Registry + Decision API Tracer Bullet

## Scope

This design covers Phase 1 from `plans/agent-sandboxing-implementation-plan.md` with an end-to-end tracer bullet for one governed operation: `egress_http` to a destination host.

Phase 1 proves both:
- decision contract (`allow | deny | approval_required`) with structured diagnostics
- real enforcement outside worker logic, using current worker network constraints plus gateway proxy enforcement

## Goals

- Preserve and extend existing Lobu gateway/proxy/grant behavior instead of replacing it.
- Add a stable capability registry keyed by agent identity.
- Add a structured decision service and endpoint contract.
- Keep worker integration thin and focused on contract visibility/explainability.
- Keep enforcement truth in gateway proxy path.

## Non-Goals (Phase 1)

- Full sidecar interception for non-HTTP protocols.
- Full OPA integration.
- Scheduler-level trust-zone placement hardening.
- Lease issuance lifecycle (Slack approval flow already exists via grants and is reused).

## Architecture and Boundaries

### Existing enforcement boundary kept

- Worker pods are constrained by Kubernetes `NetworkPolicy` to DNS + gateway + Redis paths.
- Workers use `HTTP_PROXY/HTTPS_PROXY` pointed at gateway proxy.
- Gateway proxy remains the enforcement point for outbound HTTP/HTTPS decisions.

### New phase-1 module boundary

Capability decision modules:
- `packages/gateway/src/capabilities/types.ts`
- `packages/gateway/src/capabilities/registry.ts`
- `packages/gateway/src/capabilities/trust-zone-resolver.ts`
- `packages/gateway/src/capabilities/decision-service.ts`

Proxy integration:
- `packages/gateway/src/proxy/http-proxy.ts` evaluates `DecisionService` before forward/tunnel and returns structured block payloads for capability decisions.

Contract endpoint:
- `POST /internal/capabilities/decide` provides worker-visible diagnostics with the same decision service used by proxy enforcement.

Worker integration:
- `packages/worker/src/gateway/capability-decision-client.ts`
- `packages/worker/src/shared/tool-implementations.ts` uses the client in `requestNetworkAccess` for explicit contract visibility.

## Data Model

### Capability registry storage

Backend: Redis.

- Prefix: `capreg:`
- Primary key: `capreg:<agentId>`
- Value:
  - `capabilities[]`
  - `trustZone`

### Decision request contract

- `agentId`
- `sessionId`
- `operation` (`egress_http`)
- `destination`
- `method` (optional)
- `trustZone`
- `trustZoneSource` (optional)
- `context` (optional)

### Decision response contract

- `result`: `allow | deny | approval_required`
- `reasonCode`
- `message`
- `suggestedRoutes[]` structured metadata
- `approval` metadata
- `audit` metadata (`decisionId`, timestamp, trust-zone fields)

## Runtime Flow

1. Worker attempts governed egress.
2. Traffic hits gateway proxy.
3. Proxy validates worker identity from proxy auth token.
4. Proxy builds decision input and calls `DecisionService`.
5. `DecisionService` evaluates policy.
6. Proxy enforces decision:
- `allow`: forward
- `deny`: structured 403 payload
- `approval_required`: structured 403 payload with approval guidance
7. Decision audit metadata is emitted with final route/outcome.

## Implementation Notes

- Shared service: proxy and `/internal/capabilities/decide` both use `DecisionService` to reduce contract drift.
- Registry compatibility: when no capability record exists, `DecisionService` falls back to legacy allowlist/grant behavior so existing egress behavior is preserved until registry population is active.
- Wildcards: destination matching accepts both `.example.com` and `*.example.com`.
- Route trust-zone integrity: `/internal/capabilities/decide` ignores caller-supplied trust zone and uses enforcement-aligned `unknown/fallback` in phase 1.
- Proxy decisions currently use `trustZone=unknown` with `trustZoneSource=fallback` pending node/agent trust-zone resolution wiring.

## Verification

- Verification notes and command results: `docs/plans/phase1-tracer-verification-notes.md`
