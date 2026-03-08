# TODOS

## Phase 1 Follow-Ups
- [ ] Install `helm` in this environment and run the pending Helm validation path documented in `docs/plans/phase1-tracer-verification-notes.md`.
- [ ] Revisit stricter egress controls with Cilium `toFQDNs` once phase-1 rollout is stable and CNI migration overhead is acceptable.
- [ ] Plan and implement k3s image distribution for parity testing: run a reachable OCI registry (`registry:2`), configure `/etc/rancher/k3s/registries.yaml` for auth/TLS, and wire Helm `global.imageRegistry` + per-image tags.
- [ ] Implement trust-zone-aware OAuth credentials for Google and GitHub so `clientId/clientSecret` selection is zone-specific instead of global.
- [ ] Define and implement a concrete `PUBLIC_GATEWAY_URL` ingress strategy (public HTTPS endpoint or tunnel) for real OAuth callback validation.
- [ ] Decide and implement Slack access policy before production rollout (`isUserAllowed()` is currently open to all users): allowlist, role-based gate, or explicit keep-open decision.
