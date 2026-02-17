import { createLogger } from "@lobu/core";

const logger = createLogger("skills-fetcher");

const CLAWHUB_API_URL = "https://wry-manatee-359.convex.site/api/v1";

/**
 * Parsed skill metadata from SKILL.md file
 */
export interface SkillMetadata {
  name: string;
  description: string;
  content: string;
}

/**
 * Curated skill entry for the skills dropdown
 */
export interface CuratedSkill {
  repo: string;
  name: string;
  description: string;
  category: string;
}

/**
 * Skill entry from ClawHub API (replaces SkillsShSkill)
 * Kept as SkillsShSkill for backwards compatibility with route consumers
 */
export interface SkillsShSkill {
  id: string; // ClawHub slug (e.g., "pdf")
  skillId: string; // Same as slug
  name: string; // Display name
  installs: number; // Downloads count
  source: string; // "clawhub"
}

/**
 * ClawHub list response
 */
interface ClawHubListItem {
  slug: string;
  displayName: string;
  summary?: string | null;
  tags?: Record<string, string>;
  stats?: {
    downloads?: number;
    installsCurrent?: number;
    installsAllTime?: number;
    stars?: number;
  };
  latestVersion?: { version: string } | null;
}

interface ClawHubListResponse {
  items: ClawHubListItem[];
  nextCursor: string | null;
}

/**
 * ClawHub search response
 */
interface ClawHubSearchResult {
  score: number;
  slug: string;
  displayName: string;
  summary?: string | null;
  version?: string | null;
}

interface ClawHubSearchResponse {
  results: ClawHubSearchResult[];
}

/**
 * Service for fetching skills from ClawHub (OpenClaw skill registry).
 *
 * Responsibilities:
 * - Search and list skills via ClawHub REST API
 * - Fetch SKILL.md content via ClawHub file endpoint
 * - Parse YAML frontmatter for name/description
 * - Cache content with TTL
 * - Provide curated popular skills list
 */
export class SkillsFetcherService {
  private cache: Map<string, { data: SkillMetadata; fetchedAt: number }>;
  private readonly CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

  // Cache for ClawHub list results
  private listCache: { skills: SkillsShSkill[]; fetchedAt: number } | null =
    null;
  private readonly LIST_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

  /**
   * Curated list of popular skills from ClawHub
   * These appear in the settings page dropdown for easy discovery
   * repo field uses ClawHub slug format
   */
  static readonly CURATED_SKILLS: CuratedSkill[] = [
    // Productivity
    {
      repo: "gog",
      name: "gog",
      description:
        "Google Workspace CLI for Gmail, Calendar, Drive, Contacts, Sheets, and Docs",
      category: "Productivity",
    },
    {
      repo: "tavily-search",
      name: "tavily-search",
      description: "AI-optimized web search via Tavily API",
      category: "Productivity",
    },
    {
      repo: "summarize",
      name: "summarize",
      description:
        "Summarize URLs or files (web, PDFs, images, audio, YouTube)",
      category: "Productivity",
    },
    // Development
    {
      repo: "github",
      name: "github",
      description: "Interact with GitHub using the gh CLI",
      category: "Development",
    },
    {
      repo: "agent-browser",
      name: "agent-browser",
      description: "Headless browser automation CLI",
      category: "Development",
    },
    {
      repo: "frontend-design",
      name: "frontend-design",
      description: "Frontend design best practices",
      category: "Development",
    },
    // Documents
    {
      repo: "pdf",
      name: "pdf",
      description: "PDF document processing and generation",
      category: "Documents",
    },
    // Agent
    {
      repo: "self-improving-agent",
      name: "self-improving-agent",
      description:
        "Captures learnings and corrections for continuous improvement",
      category: "Agent",
    },
  ];

  constructor() {
    this.cache = new Map();
  }

  /**
   * Fetch SKILL.md content from ClawHub.
   * @param slug - ClawHub skill slug (e.g., "pdf", "cheese-brain")
   */
  async fetchSkill(slug: string): Promise<SkillMetadata> {
    // Check cache
    const cached = this.cache.get(slug);
    if (cached && Date.now() - cached.fetchedAt < this.CACHE_TTL_MS) {
      logger.debug(`Returning cached skill: ${slug}`);
      return cached.data;
    }

    logger.info(`Fetching skill from ClawHub: ${slug}`);

    try {
      const url = `${CLAWHUB_API_URL}/skills/${encodeURIComponent(slug)}/file?path=SKILL.md`;
      const response = await fetch(url, {
        headers: { Accept: "text/plain" },
      });

      if (!response.ok) {
        throw new Error(
          `ClawHub returned ${response.status} for skill ${slug}`
        );
      }

      const content = await response.text();
      const metadata = this.parseSkillContent(content, slug);

      // Cache result
      this.cache.set(slug, { data: metadata, fetchedAt: Date.now() });
      logger.info(`Cached skill: ${slug} (${metadata.name})`);

      return metadata;
    } catch (error) {
      logger.error(`Failed to fetch skill ${slug} from ClawHub`, { error });
      throw new Error(
        `Failed to fetch skill ${slug}: ${error instanceof Error ? error.message : "unknown error"}`
      );
    }
  }

  /**
   * Parse SKILL.md content and extract YAML frontmatter.
   */
  private parseSkillContent(content: string, slug: string): SkillMetadata {
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);

    let name = slug;
    let description = "";

    if (frontmatterMatch?.[1]) {
      const frontmatter = frontmatterMatch[1];

      const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
      if (nameMatch?.[1]) {
        name = nameMatch[1].trim();
      }

      const descMatch = frontmatter.match(/^description:\s*(.+)$/m);
      if (descMatch?.[1]) {
        description = descMatch[1].trim();
      }
    }

    return { name, description, content };
  }

  /**
   * Get list of curated popular skills for the settings dropdown.
   */
  getCuratedSkills(): CuratedSkill[] {
    return SkillsFetcherService.CURATED_SKILLS;
  }

  /**
   * Clear cached skill content.
   */
  clearCache(slug?: string): void {
    if (slug) {
      this.cache.delete(slug);
      logger.debug(`Cleared cache for: ${slug}`);
    } else {
      this.cache.clear();
      logger.debug("Cleared all skill cache");
    }
  }

  /**
   * Fetch popular skills from ClawHub API (with caching).
   */
  async fetchSkillsFromRegistry(): Promise<SkillsShSkill[]> {
    if (
      this.listCache &&
      Date.now() - this.listCache.fetchedAt < this.LIST_CACHE_TTL_MS
    ) {
      logger.debug(
        `Returning cached ClawHub data (${this.listCache.skills.length} skills)`
      );
      return this.listCache.skills;
    }

    logger.info("Fetching skills from ClawHub API...");

    try {
      const response = await fetch(
        `${CLAWHUB_API_URL}/skills?sort=downloads&limit=50`
      );
      if (!response.ok) {
        throw new Error(`ClawHub API returned ${response.status}`);
      }

      const data = (await response.json()) as ClawHubListResponse;
      const skills = data.items.map((item) => this.toSkillsShSkill(item));

      logger.info(`Fetched ${skills.length} skills from ClawHub`);

      this.listCache = { skills, fetchedAt: Date.now() };
      return skills;
    } catch (error) {
      logger.error("Failed to fetch skills from ClawHub", { error });
      return [];
    }
  }

  /**
   * Search skills from ClawHub registry.
   */
  async searchSkills(query: string, limit = 20): Promise<SkillsShSkill[]> {
    if (!query.trim()) {
      const allSkills = await this.fetchSkillsFromRegistry();
      return allSkills.slice(0, limit);
    }

    logger.info(`Searching ClawHub for: ${query}`);

    try {
      const url = `${CLAWHUB_API_URL}/search?q=${encodeURIComponent(query)}&limit=${limit}`;
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`ClawHub search API returned ${response.status}`);
      }

      const data = (await response.json()) as ClawHubSearchResponse;
      logger.info(`Found ${data.results.length} skills for query: ${query}`);

      return data.results.slice(0, limit).map((result) => ({
        id: result.slug,
        skillId: result.slug,
        name: result.displayName,
        installs: 0,
        source: "clawhub",
      }));
    } catch (error) {
      logger.error("Failed to search ClawHub", { error, query });
      // Fall back to client-side filtering
      const allSkills = await this.fetchSkillsFromRegistry();
      const lowerQuery = query.toLowerCase().trim();
      return allSkills
        .filter(
          (skill) =>
            skill.name.toLowerCase().includes(lowerQuery) ||
            skill.id.toLowerCase().includes(lowerQuery)
        )
        .slice(0, limit);
    }
  }

  /**
   * Convert ClawHub list item to SkillsShSkill format
   */
  private toSkillsShSkill(item: ClawHubListItem): SkillsShSkill {
    return {
      id: item.slug,
      skillId: item.slug,
      name: item.displayName,
      installs: item.stats?.downloads || 0,
      source: "clawhub",
    };
  }
}
