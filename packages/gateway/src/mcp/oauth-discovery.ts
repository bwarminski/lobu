import { createLogger } from "@peerbot/core";

const logger = createLogger("mcp-oauth-discovery");

/**
 * OAuth 2.0 Authorization Server Metadata (RFC 8414)
 */
export interface OAuthServerMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  scopes_supported?: string[];
  response_types_supported?: string[];
  response_modes_supported?: string[];
  grant_types_supported?: string[];
  token_endpoint_auth_methods_supported?: string[];
  revocation_endpoint?: string;
  code_challenge_methods_supported?: string[];
}

/**
 * Dynamic Client Registration Response (RFC 7591)
 */
export interface ClientCredentials {
  client_id: string;
  client_secret?: string;
  redirect_uris: string[];
  client_name: string;
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: string;
  registration_client_uri?: string;
  client_id_issued_at?: number;
  client_secret_expires_at?: number;
}

/**
 * Cached discovered OAuth metadata
 */
export interface DiscoveredOAuthMetadata {
  mcpId: string;
  mcpUrl: string;
  metadata: OAuthServerMetadata;
  clientCredentials?: ClientCredentials;
  discoveredAt: number;
  expiresAt: number;
}

export interface McpOAuthDiscoveryServiceOptions {
  /**
   * Redis or cache store for discovered metadata
   */
  cacheStore?: {
    get: (key: string) => Promise<string | null>;
    set: (key: string, value: string, ttl: number) => Promise<void>;
    delete: (key: string) => Promise<void>;
  };

  /**
   * Callback URL for OAuth redirects
   */
  callbackUrl: string;

  /**
   * MCP protocol version header
   */
  protocolVersion?: string;

  /**
   * Cache TTL in seconds (default: 24 hours)
   */
  cacheTtl?: number;
}

/**
 * Service for discovering OAuth capabilities of MCP servers
 * Implements RFC 8414 (OAuth 2.0 Authorization Server Metadata)
 * and RFC 7591 (Dynamic Client Registration)
 */
export class McpOAuthDiscoveryService {
  private readonly protocolVersion: string;
  private readonly cacheTtl: number;
  private readonly cacheStore?: McpOAuthDiscoveryServiceOptions["cacheStore"];
  private readonly callbackUrl: string;

  constructor(options: McpOAuthDiscoveryServiceOptions) {
    this.protocolVersion = options.protocolVersion || "2025-03-26";
    this.cacheTtl = options.cacheTtl || 86400; // 24 hours
    this.cacheStore = options.cacheStore;
    this.callbackUrl = options.callbackUrl;
  }

  /**
   * Discover OAuth metadata for an MCP server
   * Returns null if discovery fails or OAuth is not supported
   */
  async discoverOAuthMetadata(
    mcpId: string,
    mcpUrl: string
  ): Promise<DiscoveredOAuthMetadata | null> {
    try {
      // Check cache first
      const cached = await this.getCachedMetadata(mcpId);
      if (cached && cached.expiresAt > Date.now()) {
        logger.debug(`Using cached OAuth metadata for ${mcpId}`);
        return cached;
      }

      logger.info(`Discovering OAuth metadata for ${mcpId} at ${mcpUrl}`);

      // Parse base URL from MCP URL
      const baseUrl = this.extractBaseUrl(mcpUrl);
      logger.debug(`Base URL for ${mcpId}: ${baseUrl}`);

      // Query /.well-known/oauth-authorization-server
      const metadataUrl = `${baseUrl}/.well-known/oauth-authorization-server`;
      const metadata = await this.fetchOAuthMetadata(metadataUrl);

      if (!metadata) {
        logger.debug(`No OAuth metadata found for ${mcpId}`);
        return null;
      }

      // Validate metadata
      if (!this.validateMetadata(metadata)) {
        logger.warn(`Invalid OAuth metadata for ${mcpId}`, { metadata });
        return null;
      }

      const discovered: DiscoveredOAuthMetadata = {
        mcpId,
        mcpUrl,
        metadata,
        discoveredAt: Date.now(),
        expiresAt: Date.now() + this.cacheTtl * 1000,
      };

      // Cache the discovered metadata
      await this.cacheMetadata(discovered);

      logger.info(
        `Successfully discovered OAuth for ${mcpId}. Endpoints: auth=${metadata.authorization_endpoint}, token=${metadata.token_endpoint}, registration=${metadata.registration_endpoint || "none"}`
      );

      return discovered;
    } catch (error) {
      logger.error(`Failed to discover OAuth for ${mcpId}`, {
        error,
        mcpUrl,
      });
      return null;
    }
  }

  /**
   * Register a client dynamically with the MCP server
   * Implements RFC 7591 (Dynamic Client Registration)
   */
  async registerClient(
    mcpId: string,
    metadata: OAuthServerMetadata
  ): Promise<ClientCredentials | null> {
    try {
      if (!metadata.registration_endpoint) {
        logger.debug(
          `No registration endpoint for ${mcpId}, dynamic registration not supported`
        );
        return null;
      }

      logger.info(
        `Attempting dynamic client registration for ${mcpId} at ${metadata.registration_endpoint}`
      );

      // Prepare registration request
      const registrationRequest = {
        client_name: "Peerbot",
        redirect_uris: [this.callbackUrl],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none", // PKCE - no client secret
      };

      // Send registration request
      const response = await fetch(metadata.registration_endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "MCP-Protocol-Version": this.protocolVersion,
        },
        body: JSON.stringify(registrationRequest),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.warn(
          `Failed to register client for ${mcpId}: ${response.status} ${response.statusText}`,
          { errorText }
        );
        return null;
      }

      const credentials = (await response.json()) as ClientCredentials;

      logger.info(`Successfully registered client for ${mcpId}`, {
        client_id: credentials.client_id,
        has_secret: !!credentials.client_secret,
        auth_method: credentials.token_endpoint_auth_method,
      });

      return credentials;
    } catch (error) {
      logger.error(`Failed to register client for ${mcpId}`, { error });
      return null;
    }
  }

  /**
   * Get or create client credentials for an MCP
   * Uses cached credentials if available, otherwise performs dynamic registration
   */
  async getOrCreateClientCredentials(
    mcpId: string,
    metadata: OAuthServerMetadata
  ): Promise<ClientCredentials | null> {
    try {
      // Check if we have cached credentials
      const cached = await this.getCachedMetadata(mcpId);
      if (cached?.clientCredentials) {
        logger.debug(`Using cached client credentials for ${mcpId}`);
        return cached.clientCredentials;
      }

      // Perform dynamic registration
      const credentials = await this.registerClient(mcpId, metadata);
      if (!credentials) {
        return null;
      }

      // Update cache with credentials
      if (cached) {
        cached.clientCredentials = credentials;
        await this.cacheMetadata(cached);
      }

      return credentials;
    } catch (error) {
      logger.error(`Failed to get or create client credentials for ${mcpId}`, {
        error,
      });
      return null;
    }
  }

  /**
   * Extract base URL from MCP URL
   * Example: https://mcp.sentry.dev/mcp -> https://mcp.sentry.dev
   */
  private extractBaseUrl(mcpUrl: string): string {
    try {
      const url = new URL(mcpUrl);
      return `${url.protocol}//${url.host}`;
    } catch (error) {
      logger.error("Failed to parse MCP URL", { mcpUrl, error });
      throw new Error(`Invalid MCP URL: ${mcpUrl}`);
    }
  }

  /**
   * Fetch OAuth metadata from well-known endpoint
   */
  private async fetchOAuthMetadata(
    metadataUrl: string
  ): Promise<OAuthServerMetadata | null> {
    try {
      const response = await fetch(metadataUrl, {
        method: "GET",
        headers: {
          "MCP-Protocol-Version": this.protocolVersion,
        },
      });

      if (!response.ok) {
        if (response.status === 404) {
          logger.debug(`OAuth metadata endpoint not found: ${metadataUrl}`);
        } else {
          logger.warn(
            `Failed to fetch OAuth metadata: ${response.status} ${response.statusText}`,
            { metadataUrl }
          );
        }
        return null;
      }

      const metadata = (await response.json()) as OAuthServerMetadata;
      return metadata;
    } catch (error) {
      logger.debug(`Error fetching OAuth metadata from ${metadataUrl}`, {
        error,
      });
      return null;
    }
  }

  /**
   * Validate OAuth metadata has required fields
   */
  private validateMetadata(metadata: OAuthServerMetadata): boolean {
    if (!metadata.issuer) {
      logger.debug("Missing issuer in OAuth metadata");
      return false;
    }

    if (!metadata.authorization_endpoint) {
      logger.debug("Missing authorization_endpoint in OAuth metadata");
      return false;
    }

    if (!metadata.token_endpoint) {
      logger.debug("Missing token_endpoint in OAuth metadata");
      return false;
    }

    return true;
  }

  /**
   * Cache discovered metadata
   */
  private async cacheMetadata(
    discovered: DiscoveredOAuthMetadata
  ): Promise<void> {
    if (!this.cacheStore) {
      return;
    }

    try {
      const cacheKey = this.getCacheKey(discovered.mcpId);
      const ttl = Math.floor((discovered.expiresAt - Date.now()) / 1000);

      if (ttl > 0) {
        await this.cacheStore.set(cacheKey, JSON.stringify(discovered), ttl);
        logger.debug(`Cached OAuth metadata for ${discovered.mcpId}`, { ttl });
      }
    } catch (error) {
      logger.error(`Failed to cache metadata for ${discovered.mcpId}`, {
        error,
      });
    }
  }

  /**
   * Get cached metadata
   */
  private async getCachedMetadata(
    mcpId: string
  ): Promise<DiscoveredOAuthMetadata | null> {
    if (!this.cacheStore) {
      return null;
    }

    try {
      const cacheKey = this.getCacheKey(mcpId);
      const cached = await this.cacheStore.get(cacheKey);

      if (!cached) {
        return null;
      }

      const discovered: DiscoveredOAuthMetadata = JSON.parse(cached);

      // Check if expired
      if (discovered.expiresAt <= Date.now()) {
        logger.debug(`Cached metadata expired for ${mcpId}`);
        await this.cacheStore.delete(cacheKey);
        return null;
      }

      return discovered;
    } catch (error) {
      logger.error(`Failed to get cached metadata for ${mcpId}`, { error });
      return null;
    }
  }

  /**
   * Clear cached metadata for an MCP
   */
  async clearCache(mcpId: string): Promise<void> {
    if (!this.cacheStore) {
      return;
    }

    try {
      const cacheKey = this.getCacheKey(mcpId);
      await this.cacheStore.delete(cacheKey);
      logger.info(`Cleared cached OAuth metadata for ${mcpId}`);
    } catch (error) {
      logger.error(`Failed to clear cache for ${mcpId}`, { error });
    }
  }

  /**
   * Get cache key for an MCP
   */
  private getCacheKey(mcpId: string): string {
    return `mcp:oauth:discovery:${mcpId}`;
  }
}
