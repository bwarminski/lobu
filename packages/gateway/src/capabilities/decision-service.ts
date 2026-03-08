// ABOUTME: Evaluates capability decisions for governed egress_http operations.
// ABOUTME: Maps global policy, grants, and trust-zone constraints to structured outcomes.
import crypto from "node:crypto";
import { type AgentCapability, type CapabilityRegistry } from "./registry";
import type { DecisionRequest, DecisionResponse, TrustZone } from "./types";

interface DecisionServiceOptions {
  grantStore?: {
    hasGrant(agentId: string, pattern: string): Promise<boolean>;
    isDenied(agentId: string, pattern: string): Promise<boolean>;
  };
  capabilityRegistry: CapabilityRegistry;
  globalAllowedDomains: string[];
  globalDeniedDomains: string[];
}

function matchesDomainPattern(hostname: string, patterns: string[]): boolean {
  const lowerHostname = hostname.toLowerCase();

  for (const pattern of patterns) {
    const lowerPattern = pattern.toLowerCase();

    if (lowerPattern.startsWith("*.")) {
      const domain = lowerPattern.substring(2);
      if (lowerHostname === domain || lowerHostname.endsWith(`.${domain}`)) {
        return true;
      }
      continue;
    }

    if (lowerPattern.startsWith(".")) {
      const domain = lowerPattern.substring(1);
      if (lowerHostname === domain || lowerHostname.endsWith(`.${domain}`)) {
        return true;
      }
      continue;
    }

    if (lowerHostname === lowerPattern) {
      return true;
    }
  }

  return false;
}

function isUnrestrictedMode(allowedDomains: string[]): boolean {
  return allowedDomains.some((domain) => domain.trim() === "*");
}

function isHostnameAllowed(
  hostname: string,
  allowedDomains: string[],
  deniedDomains: string[]
): boolean {
  if (isUnrestrictedMode(allowedDomains)) {
    if (deniedDomains.length === 0) {
      return true;
    }
    return !matchesDomainPattern(hostname, deniedDomains);
  }

  if (allowedDomains.length === 0) {
    return false;
  }

  const allowed = matchesDomainPattern(hostname, allowedDomains);
  if (!allowed) {
    return false;
  }

  if (deniedDomains.length === 0) {
    return true;
  }

  return !matchesDomainPattern(hostname, deniedDomains);
}

function findMatchingCapability(
  destination: string,
  capabilities: AgentCapability[]
): AgentCapability | null {
  for (const capability of capabilities) {
    if (capability.operation !== "egress_http") {
      continue;
    }
    if (matchesDomainPattern(destination, capability.destinations)) {
      return capability;
    }
  }
  return null;
}

function buildBaseResponse(
  request: DecisionRequest,
  result: DecisionResponse["result"],
  reasonCode: string,
  message: string,
  requiredZone?: TrustZone
): DecisionResponse {
  const decisionId = crypto.randomUUID();
  const zoneMatch = !requiredZone || requiredZone === request.trustZone;

  return {
    result,
    reasonCode,
    message,
    suggestedRoutes: [],
    approval: {
      required: result === "approval_required",
      ...(result === "approval_required" && { scopeHint: request.destination }),
    },
    audit: {
      decisionId,
      timestamp: new Date().toISOString(),
      trustZone: request.trustZone,
      trustZoneSource: request.trustZoneSource ?? "fallback",
      ...(requiredZone && { requiredZone }),
      zoneMatch,
    },
  };
}

async function evaluateLegacyPolicy(
  request: DecisionRequest,
  options: DecisionServiceOptions
): Promise<DecisionResponse> {
  if (
    options.globalDeniedDomains.length > 0 &&
    matchesDomainPattern(request.destination, options.globalDeniedDomains)
  ) {
    return buildBaseResponse(
      request,
      "deny",
      "denied_by_legacy_policy",
      "Destination is denied by legacy policy."
    );
  }

  const globallyAllowed = isHostnameAllowed(
    request.destination,
    options.globalAllowedDomains,
    options.globalDeniedDomains
  );
  if (globallyAllowed) {
    if (options.grantStore) {
      const denied = await options.grantStore.isDenied(
        request.agentId,
        request.destination
      );
      if (denied) {
        return buildBaseResponse(
          request,
          "deny",
          "denied_by_grant",
          "Destination is denied by agent grant policy."
        );
      }
    }

    return buildBaseResponse(
      request,
      "allow",
      "allowed_by_legacy_policy",
      "Destination is allowed by legacy policy."
    );
  }

  if (options.grantStore) {
    const granted = await options.grantStore.hasGrant(
      request.agentId,
      request.destination
    );
    if (granted) {
      return buildBaseResponse(
        request,
        "allow",
        "allowed_by_grant",
        "Destination is allowed by grant."
      );
    }
  }

  return buildBaseResponse(
    request,
    "deny",
    "denied_by_legacy_policy",
    "Destination is denied by legacy policy."
  );
}

export class DecisionService {
  constructor(private readonly options: DecisionServiceOptions) {}

  async decide(request: DecisionRequest): Promise<DecisionResponse> {
    if (request.operation !== "egress_http") {
      return buildBaseResponse(
        request,
        "deny",
        "unsupported_operation",
        "Operation is not supported by capability policy."
      );
    }

    const capabilityRecord = await this.options.capabilityRegistry.get(
      request.agentId
    );
    if (!capabilityRecord) {
      return evaluateLegacyPolicy(request, this.options);
    }

    const capability = findMatchingCapability(
      request.destination,
      capabilityRecord.capabilities
    );
    if (!capability) {
      return buildBaseResponse(
        request,
        "deny",
        "capability_missing",
        "Destination is not assigned in capabilities.",
      );
    }

    if (
      capability.requiredTrustZone &&
      capability.requiredTrustZone !== request.trustZone
    ) {
      return buildBaseResponse(
        request,
        "deny",
        "trust_zone_mismatch",
        "Destination requires a different trust-zone.",
        capability.requiredTrustZone
      );
    }

    if (
      this.options.globalDeniedDomains.length > 0 &&
      matchesDomainPattern(request.destination, this.options.globalDeniedDomains)
    ) {
      return buildBaseResponse(
        request,
        "deny",
        "denied_by_global_policy",
        "Destination is denied by policy."
      );
    }

    const globallyAllowed = isHostnameAllowed(
      request.destination,
      this.options.globalAllowedDomains,
      this.options.globalDeniedDomains
    );

    if (globallyAllowed) {
      if (this.options.grantStore) {
        const denied = await this.options.grantStore.isDenied(
          request.agentId,
          request.destination
        );
        if (denied) {
          return buildBaseResponse(
            request,
            "deny",
            "denied_by_grant",
            "Destination is denied by agent grant policy."
          );
        }
      }

      return buildBaseResponse(
        request,
        "allow",
        "allowed_by_policy",
        "Destination is allowed."
      );
    }

    if (this.options.grantStore) {
      const granted = await this.options.grantStore.hasGrant(
        request.agentId,
        request.destination
      );
      if (granted) {
        return buildBaseResponse(
          request,
          "allow",
          "allowed_by_grant",
          "Destination is allowed by grant."
        );
      }
    }

    const approvalRequired = buildBaseResponse(
      request,
      "approval_required",
      "approval_required",
      "Destination requires approval."
    );
    approvalRequired.suggestedRoutes = [
      {
        kind: "request_approval",
        target: request.destination,
        message: "Request destination access approval from settings.",
      },
    ];
    return approvalRequired;
  }
}
