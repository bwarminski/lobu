/**
 * WhatsApp Auth Adapter - Platform-specific authentication handling.
 * Handles numbered provider selection and OAuth flow messaging.
 */

import { createLogger } from "@peerbot/core";
import type {
  ClaudeOAuthStateStore,
  OAuthPlatformContext,
} from "../auth/claude/oauth-state-store";
import { ClaudeOAuthClient } from "../auth/oauth/claude-client";
import type { AuthProvider, PlatformAuthAdapter } from "../auth/platform-auth";
import type { BaileysClient } from "./connection/baileys-client";

const logger = createLogger("whatsapp-auth-adapter");

interface PendingAuth {
  userId: string;
  spaceId: string;
  providers: AuthProvider[];
  createdAt: number;
}

// 5 minute TTL for pending auth sessions
const PENDING_AUTH_TTL_MS = 5 * 60 * 1000;

/**
 * WhatsApp-specific authentication adapter.
 * Renders auth prompts as numbered text lists and handles reply-based selection.
 */
export class WhatsAppAuthAdapter implements PlatformAuthAdapter {
  private pendingAuthSessions = new Map<string, PendingAuth>();
  private oauthClient = new ClaudeOAuthClient();

  constructor(
    private client: BaileysClient,
    private stateStore: ClaudeOAuthStateStore,
    private publicGatewayUrl: string
  ) {
    // Cleanup expired sessions periodically
    setInterval(() => this.cleanupExpiredSessions(), 60 * 1000);
  }

  /**
   * Send authentication required prompt with numbered provider list.
   */
  async sendAuthPrompt(
    userId: string,
    channelId: string,
    _threadId: string, // Not used for WhatsApp
    providers: AuthProvider[],
    platformMetadata?: Record<string, unknown>
  ): Promise<void> {
    // Use jid from metadata if available
    const chatJid = (platformMetadata?.jid as string) || channelId;
    const spaceId = (platformMetadata?.spaceId as string) || channelId;

    // Build numbered list message
    const lines = [
      "*Authentication Required*",
      "",
      "Choose a provider to authenticate:",
    ];

    providers.forEach((provider, index) => {
      lines.push(`${index + 1}. ${provider.name}`);
    });

    lines.push("");
    lines.push("Reply with the number of your choice.");

    const message = lines.join("\n");

    try {
      await this.client.sendMessage(chatJid, { text: message });
      logger.info(
        { chatJid, userId, spaceId, providerCount: providers.length },
        "Sent auth prompt"
      );

      // Store pending auth session with spaceId for multi-tenant isolation
      this.pendingAuthSessions.set(chatJid, {
        userId,
        spaceId,
        providers,
        createdAt: Date.now(),
      });
    } catch (error) {
      logger.error({ error, chatJid }, "Failed to send auth prompt");
      throw error;
    }
  }

  /**
   * Send authentication success message.
   */
  async sendAuthSuccess(
    userId: string,
    channelId: string,
    provider: AuthProvider
  ): Promise<void> {
    const message = [
      `*Authentication Successful!*`,
      "",
      `You're now connected to ${provider.name}.`,
      "",
      "Send your message again to continue.",
    ].join("\n");

    try {
      await this.client.sendMessage(channelId, { text: message });
      logger.info(
        { channelId, userId, provider: provider.id },
        "Sent auth success message"
      );
    } catch (error) {
      logger.error({ error, channelId }, "Failed to send auth success message");
    }
  }

  /**
   * Handle potential auth response (numbered selection).
   * Returns true if the message was handled as an auth response.
   */
  async handleAuthResponse(
    channelId: string,
    userId: string,
    text: string
  ): Promise<boolean> {
    const pending = this.pendingAuthSessions.get(channelId);
    if (!pending) {
      return false;
    }

    // Check if session expired
    if (Date.now() - pending.createdAt > PENDING_AUTH_TTL_MS) {
      this.pendingAuthSessions.delete(channelId);
      return false;
    }

    // Parse selection (supports "1", "2", etc.)
    const selection = this.parseSelection(text, pending.providers.length);
    if (selection === null) {
      return false;
    }

    const selectedProvider = pending.providers[selection];
    if (!selectedProvider) {
      return false;
    }

    logger.info(
      { channelId, userId, selection, provider: selectedProvider.id },
      "User selected auth provider"
    );

    // Remove pending session
    this.pendingAuthSessions.delete(channelId);

    // Initiate OAuth flow for selected provider
    await this.initiateOAuth(
      channelId,
      pending.userId,
      pending.spaceId,
      selectedProvider
    );

    return true;
  }

  /**
   * Parse user selection from text.
   * Returns 0-indexed selection or null if invalid.
   */
  private parseSelection(text: string, maxOptions: number): number | null {
    const trimmed = text.trim().toLowerCase();

    // Try parsing as number
    const num = parseInt(trimmed, 10);
    if (!Number.isNaN(num) && num >= 1 && num <= maxOptions) {
      return num - 1;
    }

    // Try word-based selection
    const wordToNum: Record<string, number> = {
      one: 1,
      two: 2,
      three: 3,
      four: 4,
      first: 1,
      second: 2,
      third: 3,
      fourth: 4,
    };

    const wordNum = wordToNum[trimmed];
    if (wordNum && wordNum <= maxOptions) {
      return wordNum - 1;
    }

    return null;
  }

  /**
   * Initiate OAuth flow for selected provider.
   */
  private async initiateOAuth(
    chatJid: string,
    userId: string,
    spaceId: string,
    provider: AuthProvider
  ): Promise<void> {
    // Generate PKCE code verifier
    const codeVerifier = this.oauthClient.generateCodeVerifier();

    // Create platform context for callback routing
    const context: OAuthPlatformContext = {
      platform: "whatsapp",
      channelId: chatJid,
    };

    // Store state with platform context and spaceId
    const state = await this.stateStore.create(
      userId,
      spaceId,
      codeVerifier,
      context
    );

    // Build OAuth URL - redirect to Anthropic console callback
    // User will get CODE#STATE to paste in our web form
    const authUrl = this.oauthClient.buildAuthUrl(
      state,
      codeVerifier,
      "https://console.anthropic.com/oauth/code/callback"
    );

    // Build callback URL for code entry
    const callbackUrl = `${this.publicGatewayUrl}/auth/callback`;

    // Send OAuth instructions
    const message = [
      `*Step 1:* Visit this link to authorize with ${provider.name}:`,
      "",
      authUrl,
      "",
      `*Step 2:* After authorizing, you'll see a code like \`ABC123#XYZ789\``,
      "",
      `*Step 3:* Go to this page and paste the code:`,
      "",
      callbackUrl,
      "",
      "_The code expires in 5 minutes._",
    ].join("\n");

    try {
      await this.client.sendMessage(chatJid, { text: message });
      logger.info(
        { chatJid, userId, provider: provider.id, state },
        "Sent OAuth instructions"
      );
    } catch (error) {
      logger.error({ error, chatJid }, "Failed to send OAuth instructions");
    }
  }

  /**
   * Check if there's a pending auth session for this chat.
   */
  hasPendingAuth(channelId: string): boolean {
    const pending = this.pendingAuthSessions.get(channelId);
    if (!pending) return false;

    // Check if expired
    if (Date.now() - pending.createdAt > PENDING_AUTH_TTL_MS) {
      this.pendingAuthSessions.delete(channelId);
      return false;
    }

    return true;
  }

  /**
   * Cleanup expired pending auth sessions.
   */
  private cleanupExpiredSessions(): void {
    const now = Date.now();
    for (const [key, session] of this.pendingAuthSessions) {
      if (now - session.createdAt > PENDING_AUTH_TTL_MS) {
        this.pendingAuthSessions.delete(key);
      }
    }
  }
}
