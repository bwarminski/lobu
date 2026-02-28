/**
 * Unified Internal Integrations Discovery Routes
 *
 * Single search endpoint for workers to discover both skills and MCP servers.
 */

import { createLogger, verifyWorkerToken } from "@lobu/core";
import { Hono } from "hono";
import { McpDiscoveryService } from "../../services/mcp-discovery";
import { SkillsFetcherService } from "../../services/skills-fetcher";

const logger = createLogger("internal-integrations-discovery");

type WorkerContext = {
  Variables: {
    worker: {
      userId: string;
      agentId?: string;
      deploymentName: string;
    };
  };
};

export function createIntegrationsDiscoveryRoutes(
  skillsFetcher = new SkillsFetcherService(),
  mcpDiscovery = new McpDiscoveryService()
): Hono<WorkerContext> {
  const router = new Hono<WorkerContext>();

  const authenticateWorker = async (
    c: any,
    next: () => Promise<void>
  ): Promise<Response | undefined> => {
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

  router.get("/internal/integrations/search", authenticateWorker, async (c) => {
    const query = (c.req.query("q") || "").trim();
    if (!query) {
      return c.json({ skills: [], mcps: [] });
    }

    const requestedLimit = parseInt(c.req.query("limit") || "5", 10);
    const limit = Number.isFinite(requestedLimit)
      ? Math.max(1, Math.min(requestedLimit, 10))
      : 5;

    const [skills, mcps] = await Promise.all([
      skillsFetcher.searchSkills(query, limit),
      mcpDiscovery.search(query, limit),
    ]);

    logger.info("Integrations discovery search", {
      query,
      limit,
      skillCount: skills.length,
      mcpCount: mcps.length,
    });

    return c.json({ skills, mcps, limit });
  });

  router.get(
    "/internal/integrations/mcps/:id",
    authenticateWorker,
    async (c) => {
      const id = c.req.param("id");
      const result = await mcpDiscovery.getById(id);
      if (!result) {
        return c.json({ error: "MCP not found" }, 404);
      }
      return c.json({ mcp: result });
    }
  );

  logger.info("Internal integrations discovery routes registered");
  return router;
}
