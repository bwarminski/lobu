# Integration Tests

End-to-end tests for Peerbot without relying on Slack or Claude APIs.

## Setup

```bash
cd integration-tests
bun install
```

## Running Tests

### Quick Test (requires manual setup)

1. Start mock servers:
```bash
# Terminal 1
bun run mock:slack

# Terminal 2  
bun run mock:claude
```

2. Start services with test environment:
```bash
# Terminal 3
cd ..
export $(cat integration-tests/.env.test | xargs)
make dev
```

3. Run tests:
```bash
# Terminal 4
cd integration-tests
bun test
```

### Automated Full Test

```bash
bun run test:full
```

This script:
- Starts mock servers
- Uses existing docker-compose.dev.yml with test environment
- Runs all tests
- Cleans up automatically

## Test Scenarios

- **Simple Math (2+2)**: Tests basic response without buttons
- **File Creation**: Tests button appearance for file operations
- **Pull Request**: Tests PR creation and URL display
- **No Repository**: Tests behavior when user has no repo configured
- **Access Denied**: Tests error handling for repository access issues
- **Valid Repository**: Tests successful repository access
- **Demo Flow**: Tests the "Try Demo" button and repository setup

## Architecture

- `MockSlackServer`: Simulates Slack API endpoints
- `MockClaudeServer`: Returns predefined Claude responses
- `TestContext`: Manages test lifecycle and database
- Tests run against real dispatcher/orchestrator services