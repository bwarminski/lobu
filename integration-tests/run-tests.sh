#!/bin/bash

# Run integration tests using existing docker-compose with test environment

set -e

echo "🧪 Starting Peerbot Integration Tests"

# Start mock servers in background
echo "📡 Starting mock servers..."
bun run src/mocks/slack-server.ts &
SLACK_MOCK_PID=$!
bun run src/mocks/claude-server.ts &
CLAUDE_MOCK_PID=$!

# Give mock servers time to start
sleep 2

# Use existing docker-compose with test environment
echo "🐳 Starting services with test configuration..."
cd ..
export $(cat integration-tests/.env.test | xargs)
docker-compose -f docker-compose.dev.yml up -d

# Wait for services to be ready
echo "⏳ Waiting for services..."
sleep 5

# Run tests
echo "🚀 Running tests..."
cd integration-tests
bun test

# Capture test result
TEST_RESULT=$?

# Cleanup
echo "🧹 Cleaning up..."
kill $SLACK_MOCK_PID $CLAUDE_MOCK_PID 2>/dev/null || true
cd ..
docker-compose -f docker-compose.dev.yml down

exit $TEST_RESULT