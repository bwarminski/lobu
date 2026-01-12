import {
  type ActionButton,
  BaseModule,
  createLogger,
  type DispatcherContext,
  type WorkerContext,
} from "@peerbot/core";

const logger = createLogger("github-module");

// Constants
const BRANCH_PREFIX = "peerbot/";
const GIT_CONFIG_USER_NAME = "Peerbot";
const GIT_EMAIL_SUFFIX = "@noreply.github.com";

type ExecAsyncFunction = (
  command: string,
  options?: { cwd?: string; timeout?: number }
) => Promise<{ stdout: string; stderr: string }>;

interface HandleActionContext {
  body?: {
    actions?: Array<{ value?: string }>;
    message?: {
      thread_ts?: string;
      ts?: string;
    };
    team?: {
      id?: string;
    };
    user?: {
      username?: string;
    };
  };
  client?: any;
  channelId?: string;
  messageHandler?: {
    handleUserRequest: (
      slackContext: any,
      prompt: string,
      client: any
    ) => Promise<void>;
  };
}

// GitHub module data collected in worker
export interface GitHubModuleData {
  branch: string;
  hasChanges: boolean;
  prUrl?: string;
  repoPath: string;
}

export class GitHubModule extends BaseModule<GitHubModuleData> {
  name = "github";

  isEnabled(): boolean {
    // Module is always enabled - GitHub MCP handles auth
    return true;
  }

  /**
   * Initialize git workspace - handles cloning, updating, and configuration
   * Reads repository URL from GITHUB_REPOSITORY environment variable
   */
  async initWorkspace(config: {
    workspaceDir?: string;
    username?: string;
    sessionKey?: string;
  }): Promise<void> {
    if (!config.workspaceDir) {
      logger.debug("No workspaceDir provided, skipping git init");
      return;
    }

    // Read repository URL from environment variable
    const repositoryUrl = process.env.GITHUB_REPOSITORY;
    if (!repositoryUrl) {
      logger.debug(
        "No GITHUB_REPOSITORY environment variable set, skipping git init"
      );
      return;
    }

    const { exec } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execAsync = promisify(exec);

    try {
      // Check if workspace is already a git repo
      const isGitRepo = await this.isGitRepository(
        config.workspaceDir,
        execAsync
      );

      if (isGitRepo) {
        logger.info(
          `Git repository found at ${config.workspaceDir}, updating...`
        );
        await this.updateRepository(
          config.workspaceDir,
          config.sessionKey,
          execAsync
        );
      } else {
        logger.info(
          `Cloning repository ${repositoryUrl} to ${config.workspaceDir}...`
        );
        await this.cloneRepository(
          repositoryUrl,
          config.workspaceDir,
          execAsync
        );
      }

      // Setup git config
      if (config.username) {
        await this.setupGitConfig(
          config.workspaceDir,
          config.username,
          execAsync
        );
      }

      // Create session branch if sessionKey provided
      if (config.sessionKey) {
        await this.createSessionBranch(
          config.workspaceDir,
          config.sessionKey,
          execAsync
        );
      }

      logger.info("Git workspace initialized successfully");
    } catch (error) {
      logger.error("Failed to initialize git workspace:", error);
      throw error;
    }
  }

  /**
   * Check if directory is a git repository
   */
  private async isGitRepository(
    path: string,
    execAsync: ExecAsyncFunction
  ): Promise<boolean> {
    try {
      await execAsync("git rev-parse --git-dir", { cwd: path, timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Clone repository to specified directory
   */
  private async cloneRepository(
    repositoryUrl: string,
    targetDirectory: string,
    execAsync: ExecAsyncFunction
  ): Promise<void> {
    const { stderr } = await execAsync(
      `git clone "${repositoryUrl}" "${targetDirectory}"`,
      { timeout: 180000 } // 3 minute timeout
    );

    if (stderr && !stderr.includes("Cloning into")) {
      logger.warn("Git clone warnings:", stderr);
    }
  }

  /**
   * Update existing repository
   */
  private async updateRepository(
    repositoryDirectory: string,
    sessionKey: string | undefined,
    execAsync: ExecAsyncFunction
  ): Promise<void> {
    // Fetch latest changes
    await execAsync("git fetch origin", {
      cwd: repositoryDirectory,
      timeout: 30000,
    });

    // If sessionKey provided, check if session branch exists
    if (sessionKey) {
      const branchName = `${BRANCH_PREFIX}${sessionKey.replace(/\./g, "-")}`;

      try {
        // Check if branch exists on remote
        const { stdout } = await execAsync(
          `git ls-remote --heads origin ${branchName}`,
          { cwd: repositoryDirectory, timeout: 10000 }
        );

        if (stdout.trim()) {
          logger.info(`Session branch ${branchName} exists, checking out...`);

          try {
            // Try to checkout existing local branch
            await execAsync(`git checkout "${branchName}"`, {
              cwd: repositoryDirectory,
              timeout: 10000,
            });
            await execAsync(`git pull origin "${branchName}"`, {
              cwd: repositoryDirectory,
              timeout: 30000,
            });
          } catch {
            // Create local branch from remote
            await execAsync(
              `git checkout -b "${branchName}" "origin/${branchName}"`,
              { cwd: repositoryDirectory, timeout: 10000 }
            );
          }
          return;
        }
      } catch {
        logger.debug("Session branch not found on remote, using main/master");
      }
    }

    // Reset to main/master
    try {
      await execAsync("git reset --hard origin/main", {
        cwd: repositoryDirectory,
        timeout: 10000,
      });
    } catch {
      await execAsync("git reset --hard origin/master", {
        cwd: repositoryDirectory,
        timeout: 10000,
      });
    }
  }

  /**
   * Setup git configuration
   */
  private async setupGitConfig(
    repositoryDirectory: string,
    username: string,
    execAsync: ExecAsyncFunction
  ): Promise<void> {
    await execAsync(`git config user.name "${GIT_CONFIG_USER_NAME}"`, {
      cwd: repositoryDirectory,
    });

    await execAsync(
      `git config user.email "claude-code-bot+${username}${GIT_EMAIL_SUFFIX}"`,
      { cwd: repositoryDirectory }
    );

    await execAsync("git config push.default simple", {
      cwd: repositoryDirectory,
    });
  }

  /**
   * Create a new branch for the session
   */
  private async createSessionBranch(
    repositoryDirectory: string,
    sessionKey: string,
    execAsync: ExecAsyncFunction
  ): Promise<void> {
    const branchName = `${BRANCH_PREFIX}${sessionKey.replace(/\./g, "-")}`;

    try {
      // Try to checkout existing branch
      await execAsync(`git checkout "${branchName}"`, {
        cwd: repositoryDirectory,
        timeout: 10000,
      });
      logger.info(`Checked out existing session branch: ${branchName}`);
    } catch {
      // Branch doesn't exist, create it
      try {
        await execAsync(`git checkout -b "${branchName}"`, {
          cwd: repositoryDirectory,
          timeout: 10000,
        });
        logger.info(`Created new session branch: ${branchName}`);
      } catch (error) {
        logger.warn(`Failed to create session branch: ${error}`);
      }
    }
  }

  /**
   * Worker hook: Collect git status information before sending response
   */
  async onBeforeResponse(
    context: WorkerContext
  ): Promise<GitHubModuleData | null> {
    try {
      const { execSync } = await import("node:child_process");
      const cwd = context.workspaceDir;

      // Check if this is a git repository
      try {
        execSync("git rev-parse --git-dir", { cwd, stdio: "pipe" });
      } catch {
        return null; // Not a git repo
      }

      // Get current branch
      const branch = execSync("git branch --show-current", {
        cwd,
        encoding: "utf8",
      }).trim();

      // Only show buttons for peerbot/* branches
      if (!branch.startsWith(BRANCH_PREFIX)) {
        return null;
      }

      // Check for uncommitted changes
      const status = execSync("git status --porcelain", {
        cwd,
        encoding: "utf8",
      }).trim();
      const hasChanges = status.length > 0;

      // Check for existing PR
      let prUrl: string | undefined;
      try {
        const prData = execSync(
          `gh pr list --head "${branch}" --json url,state --limit 1`,
          { cwd, encoding: "utf8", stdio: "pipe" }
        );
        const prs = JSON.parse(prData);
        if (prs.length > 0 && prs[0].state === "OPEN") {
          prUrl = prs[0].url;
        }
      } catch {
        // gh CLI not available or not authenticated - that's ok
      }

      // Get repository path
      const remoteUrl = execSync("git remote get-url origin", {
        cwd,
        encoding: "utf8",
      }).trim();

      const repoPath = remoteUrl
        .replace("https://github.com/", "")
        .replace(".git", "");

      return {
        branch,
        hasChanges,
        prUrl,
        repoPath,
      };
    } catch (error) {
      logger.warn("Failed to collect git info:", error);
      return null;
    }
  }

  /**
   * Dispatcher hook: Generate action buttons based on git status
   */
  async generateActionButtons(
    context: DispatcherContext<GitHubModuleData | null>
  ): Promise<ActionButton[]> {
    const data = context.moduleData;

    if (!data) {
      return [];
    }

    const buttons: ActionButton[] = [];

    // If PR exists - show "View PR" button
    if (data.prUrl) {
      buttons.push({
        text: "🔀 View Pull Request",
        action_id: `github_view_pr_${data.branch}`,
        url: data.prUrl,
      });
    }
    // If changes exist OR on claude branch - show "Create PR" button
    else if (data.hasChanges || data.branch.startsWith(BRANCH_PREFIX)) {
      const prompt = `📝 *Create Pull Request*

• Review the code and cleanup any temporary files
• Commit all changes to Git
• Push to origin: \`git push -u origin ${data.branch}\`
• If push fails due to permissions:
  - Fork the repository: \`gh repo fork --clone=false\`
  - Add fork as remote and push: \`git remote add fork <fork-url> && git push -u fork ${data.branch}\`
• Create PR: \`gh pr create --web\`

Note: GitHub authentication is handled via MCP (Model Context Protocol)`;

      buttons.push({
        text: "🔀 Create Pull Request",
        action_id: `github_create_pr_${data.branch}`,
        value: JSON.stringify({
          action: "create_pr",
          repo: data.repoPath,
          branch: data.branch,
          prompt: prompt,
        }),
      });
    }

    return buttons;
  }

  /**
   * Handle GitHub action button clicks
   */
  async handleAction(
    actionId: string,
    userId: string,
    _spaceId: string,
    context: HandleActionContext
  ): Promise<boolean> {
    // Handle GitHub PR creation button
    if (actionId.startsWith("github_create_pr_")) {
      const action = context.body?.actions?.[0];
      const value = action?.value;

      if (!value) {
        logger.warn(`No value in GitHub PR action: ${actionId}`);
        return false;
      }

      let metadata;
      try {
        metadata = JSON.parse(value);
      } catch (error) {
        logger.error(`Failed to parse GitHub PR metadata: ${error}`);
        return false;
      }

      const { prompt, branch } = metadata;

      if (!prompt) {
        logger.warn("No prompt in GitHub PR metadata");
        return false;
      }

      const client = context.client;
      const body = context.body;
      const channelId = context.channelId;

      if (!body || !client || !channelId) {
        logger.warn("Missing required context properties for GitHub PR action");
        return false;
      }

      try {
        // Get the actual thread_ts from the message
        const actualThreadTs = body.message?.thread_ts || body.message?.ts;

        // Post confirmation message with the prompt
        const inputMessage = await client.chat.postMessage({
          channel: channelId,
          thread_ts: actualThreadTs,
          text: `Pull Request requested`,
          blocks: [
            {
              type: "context",
              elements: [
                {
                  type: "mrkdwn",
                  text: `<@${userId}> requested a pull request`,
                },
              ],
            },
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: prompt,
              },
            },
          ],
        });

        // Call the message handler to send the prompt to Claude
        if (context.messageHandler) {
          const slackContext = {
            channelId,
            userId,
            teamId: body.team?.id || "",
            threadTs: actualThreadTs,
            messageTs: inputMessage.ts as string,
            text: `Pull Request requested for ${branch}`,
            userDisplayName: body.user?.username || "User",
          };

          await context.messageHandler.handleUserRequest(
            slackContext,
            prompt,
            client
          );
        }

        return true;
      } catch (error) {
        logger.error(`Failed to handle GitHub PR action: ${error}`);
        await client.chat.postMessage({
          channel: channelId,
          thread_ts: body.message?.thread_ts,
          text: `❌ Failed to create pull request: ${error instanceof Error ? error.message : "Unknown error"}`,
        });
        return false;
      }
    }

    // Handle View PR button (just opens URL, handled by Slack)
    if (actionId.startsWith("github_view_pr_")) {
      return true; // Already handled via URL in button
    }

    return false;
  }
}
