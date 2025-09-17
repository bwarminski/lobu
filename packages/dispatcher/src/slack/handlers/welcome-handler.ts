import logger from "../../logger";
import type { App } from "@slack/bolt";

/**
 * Setup team join event handler for welcome messages
 */
export function setupTeamJoinHandler(app: App, botId: string): void {
  logger.info("Setting up team_join event handler...");
  
  app.event("team_join", async ({ event, client }) => {
    try {
      const userId = (event as any).user?.id;
      if (!userId) {
        logger.error("No user ID in team_join event");
        return;
      }
      
      logger.info(`New team member joined: ${userId}`);
      
      // Open a DM with the new user
      const im = await client.conversations.open({ users: userId });
      if (!im.channel?.id) {
        logger.error("Failed to open DM with new user");
        return;
      }
      
      // Send welcome message
      await sendWelcomeMessage(im.channel.id, botId, client, undefined, userId);
      
      logger.info(`Welcome message sent to new user ${userId}`);
    } catch (error) {
      logger.error("Error handling team_join event:", error);
    }
  });
}

/**
 * Send welcome message with onboarding options
 * This is a simplified version that shows initial onboarding options.
 * For context-aware welcome (checking GitHub status, repos), use ShortcutCommandHandler.sendContextAwareWelcome
 */
export async function sendWelcomeMessage(
  channelId: string,
  botId: string,
  client: any,
  threadTs?: string,
  userId?: string
): Promise<void> {
  const blocks: any[] = [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: "Welcome to Peerbot! 👋",
          emoji: true
        }
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "I'm your AI coding assistant powered by Claude. I can help you with:\n\n"
                + "• 💻 Writing and reviewing code\n"
                + "• 🔧 Building features and fixing bugs\n"
                + "• 📚 Understanding codebases\n"
                + "• 🚀 Creating new projects\n\n"
                + "Let's get you started!"
        }
      },
      {
        type: "divider"
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "*Option 1: Connect Your GitHub*\n"
                + "Link your GitHub account to work with your own repositories."
        },
        accessory: userId ? {
          type: "button",
          text: {
            type: "plain_text",
            text: "🔗 Login with GitHub",
            emoji: true
          },
          style: "primary",
          url: `${process.env.INGRESS_URL || "http://localhost:8080"}/api/github/oauth/authorize?user_id=${userId}`
        } as any : {
          type: "button",
          text: {
            type: "plain_text",
            text: "🔗 Login with GitHub",
            emoji: true
          },
          style: "primary",
          action_id: "github_connect",
          value: "welcome_login"
        }
      },
  ];

  // Add demo option if DEMO_REPOSITORY is configured
  if (process.env.DEMO_REPOSITORY) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: "*Option 2: Try a Demo*\n" +
              "Explore Peerbot's capabilities with a demo repository."
      },
      accessory: {
        type: "button",
        text: {
          type: "plain_text",
          text: "🎮 Try Demo",
          emoji: true
        },
        action_id: "try_demo",
        value: "welcome_demo"
      }
    });
  }

  // Add final sections
  blocks.push(
    {
      type: "divider"
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: "💡 *Quick Start:* Just @mention me or send me a direct message to start coding!"
        }
      ]
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: "📖 *Commands:* Type `/peerbot` to see available options"
        }
      ]
    }
  );

  const messagePayload: any = {
    channel: channelId,
    text: "Welcome to Peerbot! 👋",
    blocks
  };

  // Add thread_ts if provided (for consistency with demo activation)
  if (threadTs) {
    messagePayload.thread_ts = threadTs;
  }

  await client.chat.postMessage(messagePayload);
}
