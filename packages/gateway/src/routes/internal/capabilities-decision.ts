// ABOUTME: Exposes worker-authenticated capability decision contract endpoint.
// ABOUTME: Validates request fields and delegates to DecisionService for outcomes.
import { createLogger, verifyWorkerToken } from "@lobu/core";
import { Hono } from "hono";
import type { DecisionService } from "../../capabilities/decision-service";
import { TRUST_ZONES, type TrustZone } from "../../capabilities/types";

const logger = createLogger("capabilities-decision-routes");

type WorkerContext = {
  Variables: {
    worker: {
      agentId?: string;
      conversationId: string;
    };
  };
};

function isTrustZone(value: unknown): value is TrustZone {
  return (
    typeof value === "string" &&
    (TRUST_ZONES as readonly string[]).includes(value)
  );
}

export function createCapabilitiesDecisionRoutes(
  decisionService: DecisionService
): Hono<WorkerContext> {
  const router = new Hono<WorkerContext>();

  const authenticateWorker = async (c: any, next: () => Promise<void>) => {
    const authHeader = c.req.header("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return c.json({ error: "Missing or invalid authorization" }, 401);
    }

    const workerToken = authHeader.substring(7);
    const tokenData = verifyWorkerToken(workerToken);
    if (!tokenData) {
      return c.json({ error: "Invalid worker token" }, 401);
    }

    c.set("worker", tokenData);
    await next();
  };

  router.post("/internal/capabilities/decide", authenticateWorker, async (c) => {
    try {
      const worker = c.get("worker");
      const body = await c.req.json().catch(() => ({}));
      const operation = body.operation;
      const destination = body.destination;
      const trustZone = body.trustZone;
      const hasExplicitTrustZone = isTrustZone(trustZone);

      if (operation !== "egress_http") {
        return c.json({ error: "operation is required and must be egress_http" }, 400);
      }

      if (typeof destination !== "string" || destination.length === 0) {
        return c.json({ error: "destination is required and must be a string" }, 400);
      }

      if (!worker.agentId) {
        return c.json({ error: "agentId is required in worker token" }, 400);
      }

      const decision = await decisionService.decide({
        agentId: worker.agentId,
        sessionId: worker.conversationId,
        operation,
        destination,
        ...(typeof body.method === "string" && { method: body.method }),
        trustZone: hasExplicitTrustZone ? trustZone : "unknown",
        trustZoneSource: hasExplicitTrustZone ? "agent_config" : "fallback",
      });

      return c.json(decision);
    } catch (error) {
      logger.error("Failed to evaluate capability decision", { error });
      return c.json({ error: "Failed to evaluate capability decision" }, 500);
    }
  });

  return router;
}
