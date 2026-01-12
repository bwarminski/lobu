import { createHash } from "node:crypto";

export interface SpaceContext {
  platform: string;
  userId: string;
  channelId: string;
  isGroup: boolean;
}

export interface ResolvedSpace {
  spaceId: string;
  spaceType: "user" | "group";
}

/**
 * Hash a platform ID to a fixed-length identifier.
 * Uses first 8 chars of SHA256 for uniqueness with K8s label compatibility.
 */
export function hashPlatformId(id: string): string {
  return createHash("sha256").update(id).digest("hex").substring(0, 8);
}

/**
 * Resolve space from platform context.
 *
 * Space ID format:
 * - DM/User: user-{hash8} (hash of platform:user:{userId})
 * - Group/Channel: group-{hash8} (hash of platform:group:{channelId})
 */
export function resolveSpace(context: SpaceContext): ResolvedSpace {
  const { platform, userId, channelId, isGroup } = context;

  if (isGroup) {
    const hash = hashPlatformId(`${platform}:group:${channelId}`);
    return {
      spaceId: `group-${hash}`,
      spaceType: "group",
    };
  }

  const hash = hashPlatformId(`${platform}:user:${userId}`);
  return {
    spaceId: `user-${hash}`,
    spaceType: "user",
  };
}

/**
 * Detect if context represents a group/channel based on platform heuristics.
 * Use when isGroup is not explicitly available.
 */
export function isGroupContext(platform: string, channelId: string): boolean {
  switch (platform) {
    case "slack":
      // Slack: D = DM, C = channel, G = private channel
      return channelId.startsWith("C") || channelId.startsWith("G");
    case "whatsapp":
      // WhatsApp: group JIDs end with @g.us
      return channelId.endsWith("@g.us");
    default:
      return false;
  }
}
