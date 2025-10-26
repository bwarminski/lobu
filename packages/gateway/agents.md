## Gateway Package

Platform-agnostic gateway that dispatches messages to workers. Handles chat platform integrations.

### Module Structure
- **`src/slack/`**: Slack-specific code (events, formatters, API clients). All Slack logic must live here.
- **`src/orchestration/`**: Worker lifecycle management, deployment coordination.
- **`src/auth/`**: OAuth flows for MCP servers and platform authentication.

### Module Responsibilities
- Receive messages from chat platforms (currently Slack)
- Dispatch to worker orchestration layer
- Handle platform-specific formatting and events
- Manage OAuth flows for MCP servers
- No worker/agent-specific logic (Claude, etc.)

### Dependencies
- `packages/core` for shared types and utilities
- Redis for state and queues
- Deployment engines (Docker/K8s) via orchestrator
