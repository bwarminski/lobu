import { createLogger } from "@peerbot/shared";
import { getDbPool } from "@peerbot/shared";

const logger = createLogger("dispatcher");
import { ErrorHandler } from "../../utils/error-handler";
import { decrypt } from "@peerbot/shared";
import { generateGitHubAuthUrl } from "../../utils/github-utils";

/**
 * Handle GitHub connect action - initiates OAuth flow
 */
export async function handleGitHubConnect(
  userId: string,
  channelId: string,
  client: any
): Promise<void> {
  try {
    // Generate OAuth URL with user ID
    const authUrl = generateGitHubAuthUrl(userId);

    // Check if this is a DM or channel
    // const isDM = channelId.startsWith('D'); // Currently unused

    await client.chat.postMessage({
      channel: channelId,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "🔗 *Connect your GitHub account*\n\nClick the link below to authorize Peerbot to access your GitHub repositories:",
          },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `<${authUrl}|Connect with GitHub>`,
          },
        },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: "🔒 We'll only access repositories you explicitly grant permission to",
            },
          ],
        },
      ],
    });

    logger.info(`GitHub connect initiated for user ${userId}`);
  } catch (error) {
    ErrorHandler.logAndHandle("initiate GitHub connect", error, { userId });
    await client.chat.postMessage({
      channel: channelId,
      text: ErrorHandler.formatSlackError(
        error,
        "Failed to generate GitHub login link"
      ),
    });
  }
}

/**
 * Handle GitHub logout
 */
export async function handleGitHubLogout(
  userId: string,
  client: any
): Promise<void> {
  try {
    const dbPool = getDbPool(process.env.DATABASE_URL!);

    // Remove GitHub token and username from database
    await dbPool.query(
      `DELETE FROM user_environ 
       WHERE user_id = (SELECT id FROM users WHERE platform = 'slack' AND platform_user_id = $1)
       AND name IN ('GITHUB_TOKEN', 'GITHUB_USER')`,
      [userId.toUpperCase()]
    );

    logger.info(`GitHub logout completed for user ${userId}`);

    // Send confirmation
    const im = await client.conversations.open({ users: userId });
    if (im.channel?.id) {
      await client.chat.postMessage({
        channel: im.channel.id,
        text: "✅ Successfully logged out from GitHub",
      });
    }
  } catch (error) {
    logger.error(`Failed to logout user ${userId}:`, error);
  }
}

/**
 * Get user's GitHub info from database
 */
export async function getUserGitHubInfo(userId: string): Promise<{
  token: string | null;
  username: string | null;
}> {
  try {
    const dbPool = getDbPool(process.env.DATABASE_URL!);

    const result = await dbPool.query(
      `SELECT name, value 
       FROM user_environ 
       WHERE user_id = (SELECT id FROM users WHERE platform = 'slack' AND platform_user_id = $1)
       AND name IN ('GITHUB_TOKEN', 'GITHUB_USER')`,
      [userId.toUpperCase()]
    );

    let token = null;
    let username = null;

    for (const row of result.rows) {
      if (row.name === "GITHUB_TOKEN") {
        try {
          // Token is encrypted, decrypt it
          token = decrypt(row.value);
        } catch (error) {
          logger.error(
            `Failed to decrypt GitHub token for user ${userId}:`,
            error
          );
          token = null;
        }
      } else if (row.name === "GITHUB_USER") {
        username = row.value;
      }
    }

    return { token, username };
  } catch (error) {
    logger.error(`Failed to get GitHub info for user ${userId}:`, error);
    return { token: null, username: null };
  }
}
