# JOURNAL

## 2026-03-08
- Implemented phase-1 capability decision tracer in gateway and worker with TDD across Tasks 1-10 plan checkpoints.
- Added shared `DecisionService` used by both proxy enforcement and `/internal/capabilities/decide` to keep contract and enforcement aligned.
- Added structured proxy block payloads for `deny` and `approval_required`.
- Added worker capability decision client and integrated diagnostics into `requestNetworkAccess`.
- Added trust-zone resolver module and decision audit metadata emission with `decisionId`, trust-zone fields, and outcome.
- Preserved legacy behavior when capability registry entry is missing by falling back to existing allowlist/grant logic, avoiding rollout-time default-deny regressions.
- Locked internal decision endpoint to enforcement-aligned trust-zone values (`unknown`/`fallback`) to prevent caller spoofing.
- Added wildcard compatibility for both `.example.com` and `*.example.com` capability destination patterns.
- Verification status documented in `docs/plans/phase1-tracer-verification-notes.md`; Helm validation is currently blocked in this runtime because `helm` binary is not installed.
- Deferred follow-up trigger for stronger egress controls: revisit Cilium `toFQDNs` once phase-1 rollout is stable and cluster CNI change overhead is acceptable.
