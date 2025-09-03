# CLAUDE.md

- You MUST only do what has been asked; nothing more, nothing less.
- You can check logs with docker to understand the recent behavior the user is asking for.
- For comprehensive QA and E2E testing, see `.claude/commands/qa.md` for detailed testing procedures and examples. You can directly run `.claude/commands/test-e2e-slack-bot.sh "Your prompt"` if there is no specific testing asked, otherwise use `./slack-qa-bot.js` to test the bot.
- Anytime you make changes in the code, you MUST:

1. Have the bot running via `make dev` running in the background for development that uses hot reload. If there is `peerbot.log` file in the project root, you can skip this step.
2. Run ./slack-qa-bot.js "Relevant prompt" --timeout [based on complexity change by default 10] and make sure it works properly. If the script fails (including getting stuck at "Starting environment setup"), you MUST fix it.
3. Read the logs from `peerbot.log` to make sure it works properly in Docker mode.

- If you create ephemeral files, you MUST delete them when you're done with them.
- Use Docker to build and run the Slack bot in development mode, K8S for production.
- NEVER create files unless they're absolutely necessary for achieving your goal. Instead try to run the code on the fly for testing reasons.
- NEVER proactively create documentation files (\*.md) or README files. Only create documentation files if explicitly requested by the User. If you need to remember something, add it to CLAUDE.md as a a single sentence.
- ALWAYS ignore `/dist/` directories when analyzing code - these contain compiled artifacts, not source
- If you're referencing Slack threads or users in your response, add their direct links as well.

## Deployment Instructions

When making changes to the Slack bot: 2. **Docker images**: Make sure dev command is running in the background. Hot reload is enabled. 3. **Kubernetes deployment**: Apply changes with kubectl or restart deployments

## Development Configuration

- Rate limiting is disabled in local development
- To manually rebuild worker image if needed: `docker build -f Dockerfile.worker -t claude-worker:latest .`

## k3s Setup

For k3s clusters, you can install cri-dockerd and configure k3s to use Docker daemon for local images.

## Persistent Storage

Worker pods now use persistent volumes for data storage:

1. **Persistent Volumes**: Each worker pod mounts a persistent volume at `/workspace` to preserve data across pod restarts
2. **Auto-Resume**: The worker automatically resumes conversations using Claude CLI's built-in `--resume` functionality when continuing a thread in the same persistent volume
3. **Data Persistence**: All workspace data is preserved in the persistent volume, eliminating the need for conversation file syncing

## Testing with slack-qa-bot.js

**See `.claude/commands/qa.md` for comprehensive testing documentation with examples.**

Basic usage:

```bash
# Simple test
./slack-qa-bot.js "Hello bot"

# JSON output for automation
./slack-qa-bot.js --json "Create a function" | jq -r .thread_ts

# Comprehensive E2E testing
./.claude/commands/test-e2e-slack-bot.sh
```
