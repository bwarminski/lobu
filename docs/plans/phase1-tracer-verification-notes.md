# Phase 1 Tracer Verification Notes

## Expected Outcomes

- Direct worker egress to internet endpoints is blocked by policy.
- Proxy-governed egress returns decision outcomes that match gateway contract semantics.
- Trust-zone mismatch (`required=work`, resolved `personal|unknown`) denies access with explicit diagnostics.

## Verification Commands

- `cd packages/gateway && bun test src/__tests__/capabilities-types.test.ts`
- `cd packages/gateway && bun test src/__tests__/capability-registry.test.ts`
- `cd packages/gateway && bun test src/__tests__/trust-zone-resolver.test.ts`
- `cd packages/gateway && bun test src/__tests__/decision-service.test.ts`
- `cd packages/gateway && bun test src/__tests__/routes/capabilities-decision.test.ts`
- `cd packages/gateway && bun test src/__tests__/http-proxy.test.ts`
- `cd packages/worker && bun test src/__tests__/capability-decision-client.test.ts`
- `helm template lobu charts/lobu >/tmp/lobu-phase1-helm-template.yaml`

## Results

- `packages/gateway/src/__tests__/capabilities-types.test.ts`: pass (4/4)
- `packages/gateway/src/__tests__/capability-registry.test.ts`: pass (5/5)
- `packages/gateway/src/__tests__/trust-zone-resolver.test.ts`: pass (4/4)
- `packages/gateway/src/__tests__/decision-service.test.ts`: pass (9/9)
- `packages/gateway/src/__tests__/routes/capabilities-decision.test.ts`: pass (3/3)
- `packages/gateway/src/__tests__/http-proxy.test.ts`: pass (18/18)
- `packages/worker/src/__tests__/capability-decision-client.test.ts`: pass (4/4)
- Helm template smoke check: blocked (`helm` binary is not installed in this runtime).
