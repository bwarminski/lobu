import logger from "../../logger";
import { getDbPool } from "../../db";

/**
 * Handle Try Demo action - sets up demo repository for user
 */
export async function handleTryDemo(
  userId: string,
  channelId: string,
  client: any
): Promise<void> {
  try {
    // Get demo repository from environment or use default
    const demoRepo = process.env.DEMO_REPOSITORY || "https://github.com/anthropics/anthropic-sdk-typescript";
    
    // Parse repository info for display
    const repoPath = demoRepo.replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '');
    const [owner, repo] = repoPath.split('/');
    
    // Store in user_environ for the demo
    const dbPool = getDbPool(process.env.DATABASE_URL!);
    
    // First ensure user exists
    await dbPool.query(
      `INSERT INTO users (platform, platform_user_id) 
       VALUES ('slack', $1) 
       ON CONFLICT (platform, platform_user_id) DO NOTHING`,
      [userId.toUpperCase()]
    );
    
    // Get user ID
    const userResult = await dbPool.query(
      `SELECT id FROM users WHERE platform = 'slack' AND platform_user_id = $1`,
      [userId.toUpperCase()]
    );
    const userDbId = userResult.rows[0].id;
    
    // Set demo repository and demo mode flag
    await dbPool.query(
      `INSERT INTO user_environ (user_id, name, value, type) 
       VALUES ($1, 'GITHUB_REPOSITORY', $2, 'user') 
       ON CONFLICT (user_id, name) 
       DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [userDbId, demoRepo]
    );
    
    await dbPool.query(
      `INSERT INTO user_environ (user_id, name, value, type) 
       VALUES ($1, 'IS_DEMO_MODE', 'true', 'user') 
       ON CONFLICT (user_id, name) 
       DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [userDbId]
    );
    
    // Send confirmation and instructions
    await client.chat.postMessage({
      channel: channelId,
      text: "🎮 Demo mode activated!",
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "🎮 *Demo mode activated!*\n\n"
                  + `You're now connected to the *${owner}/${repo}* repository for demo purposes.`
          }
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "*Try these examples:*\n"
                  + "• \"Show me the main API client implementation\"\n"
                  + "• \"Explain how error handling works in this SDK\"\n"
                  + "• \"What are the available authentication methods?\"\n"
                  + "• \"Create a simple example using this SDK\""
          }
        },
        {
          type: "divider"
        },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: "💡 When you're ready to work with your own repos, use `/peerbot login` to connect your GitHub account."
            }
          ]
        }
      ]
    });
    
    logger.info(`Demo mode activated for user ${userId} with repo ${demoRepo}`);
    
  } catch (error) {
    logger.error(`Failed to set demo mode for user ${userId}:`, error);
    await client.chat.postEphemeral({
      channel: channelId,
      user: userId,
      text: "❌ Failed to activate demo mode. Please try again."
    });
  }
}

/**
 * Clear demo mode when user connects GitHub
 */
export async function clearDemoMode(userId: string): Promise<void> {
  try {
    const dbPool = getDbPool(process.env.DATABASE_URL!);
    
    // Remove demo mode flag
    await dbPool.query(
      `DELETE FROM user_environ 
       WHERE user_id = (SELECT id FROM users WHERE platform = 'slack' AND platform_user_id = $1)
       AND name = 'IS_DEMO_MODE'`,
      [userId.toUpperCase()]
    );
    
    logger.info(`Demo mode cleared for user ${userId}`);
  } catch (error) {
    logger.error(`Failed to clear demo mode for user ${userId}:`, error);
  }
}