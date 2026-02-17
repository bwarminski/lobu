/**
 * Skills Utility Routes
 *
 * Endpoints for skill discovery and metadata fetching.
 */

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { verifySettingsToken } from "../../auth/settings/token-service";
import { SkillsFetcherService } from "../../services/skills-fetcher";

const TAG = "Skills";
const ErrorResponse = z.object({ error: z.string() });

const registryRoute = createRoute({
  method: "get",
  path: "/registry",
  tags: [TAG],
  summary: "Browse/search skills registry",
  description:
    "Returns curated skills if no query, or searches registry if q provided",
  request: {
    query: z.object({
      token: z.string(),
      q: z
        .string()
        .optional()
        .openapi({ description: "Search query (omit for curated)" }),
      limit: z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: "Skills",
      content: {
        "application/json": {
          schema: z.object({
            skills: z.array(
              z.object({
                repo: z.string(),
                name: z.string(),
                description: z.string(),
                category: z.string().optional(),
              })
            ),
            source: z.enum(["curated", "search"]),
          }),
        },
      },
    },
    401: {
      description: "Unauthorized",
      content: { "application/json": { schema: ErrorResponse } },
    },
  },
});

const fetchRoute = createRoute({
  method: "post",
  path: "/fetch",
  tags: [TAG],
  summary: "Fetch skill metadata from ClawHub",
  description: "Fetches skill name, description, and content by slug",
  request: {
    query: z.object({ token: z.string() }),
    body: {
      content: {
        "application/json": {
          schema: z.object({
            repo: z
              .string()
              .openapi({ description: "ClawHub skill slug (e.g., 'pdf')" }),
            refresh: z
              .boolean()
              .optional()
              .openapi({ description: "Force refresh" }),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Skill metadata",
      content: {
        "application/json": {
          schema: z.object({
            repo: z.string(),
            name: z.string(),
            description: z.string(),
            content: z.string(),
            fetchedAt: z.number(),
          }),
        },
      },
    },
    400: {
      description: "Invalid",
      content: { "application/json": { schema: ErrorResponse } },
    },
    401: {
      description: "Unauthorized",
      content: { "application/json": { schema: ErrorResponse } },
    },
  },
});

export function createSkillsRoutes(): OpenAPIHono {
  const app = new OpenAPIHono();
  const skillsFetcher = new SkillsFetcherService();

  const verifyToken = (token: string | undefined) =>
    token ? verifySettingsToken(token) : null;

  app.openapi(registryRoute, async (c): Promise<any> => {
    const { token, q, limit } = c.req.valid("query");
    if (!verifyToken(token)) return c.json({ error: "Unauthorized" }, 401);

    if (q) {
      const skills = await skillsFetcher.searchSkills(
        q,
        Math.min(parseInt(limit || "20", 10), 50)
      );
      return c.json({ skills, source: "search" });
    }
    return c.json({
      skills: skillsFetcher.getCuratedSkills(),
      source: "curated",
    });
  });

  app.openapi(fetchRoute, async (c): Promise<any> => {
    const { token } = c.req.valid("query");
    if (!verifyToken(token)) return c.json({ error: "Unauthorized" }, 401);

    const { repo, refresh } = c.req.valid("json");
    if (!repo?.trim()) return c.json({ error: "Missing skill slug" }, 400);

    try {
      if (refresh) skillsFetcher.clearCache(repo);
      const metadata = await skillsFetcher.fetchSkill(repo);
      return c.json({
        repo,
        name: metadata.name,
        description: metadata.description,
        content: metadata.content,
        fetchedAt: Date.now(),
      });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : "Failed" }, 400);
    }
  });

  return app;
}
