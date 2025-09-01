# CLAUDE.md

- You MUST only do what has been asked; nothing more, nothing less. 
- You can check logs with docker to understand the recent behavior the user is asking for.
- Anytime you make changes in the code, you MUST:
1. Have the bot running via `make dev` running in the background for development that uses hot reload. If there is `peerbot.log` file in the project root, you can skip this step.
2. Run ./slack-qa-bot.js "Relevant prompt" --timeout [based on complexity change by default 10] and make sure it works properly. If the script fails (including getting stuck at "Starting environment setup"), you MUST fix it.
2. Read the logs from `peerbot.log` to make sure it works properly.
- If you create ephemeral files, you MUST delete them when you're done with them.
- Use Docker to build and run the Slack bot in development mode, K8S for production.
- NEVER create files unless they're absolutely necessary for achieving your goal. Instead try to run the code on the fly for testing reasons.
- NEVER proactively create documentation files (*.md) or README files. Only create documentation files if explicitly requested by the User. If you need to remember something, add it to CLAUDE.md as a a single sentence.
- ALWAYS ignore `/dist/` directories when analyzing code - these contain compiled artifacts, not source
- If you're referencing Slack threads or users in your response, add their direct links as well.

## Deployment Instructions

When making changes to the Slack bot:
2. **Docker images**: Make sure dev command is running in the background. Hot reload is enabled.
3. **Kubernetes deployment**: Apply changes with kubectl or restart deployments

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

The test script now supports JSON output and Unix pipes for advanced testing scenarios:

### JSON Response Format

When using `--json` mode, the script returns a structured JSON response containing:

```json
{
  "success": true,
  "channel": "C0952LTF7DG",
  "thread_ts": "1756582931.437209",
  "messages_sent": 1,
  "response": {
    "text": "The result is 4.",
    "timestamp": "1756582939.241739",
    "blocks": [...],
    "bot_id": "B097WU1DV1Q"
  },
  "url": "https://peerbotcommunity.slack.com/archives/C0952LTF7DG"
}
```

**Response Fields:**
- `success`: Boolean indicating if the test passed
- `channel`: Slack channel ID where the message was sent
- `thread_ts`: Thread timestamp (use this for continuing conversations)
- `messages_sent`: Number of messages sent in this test
- `response`: Bot's response message (only when bot responds)
  - `text`: The actual response text from the bot
  - `timestamp`: When the bot sent the response
  - `blocks`: Slack blocks for rich formatting (if present)
  - `bot_id`: The responding bot's ID
- `url`: Direct link to the Slack channel
- `error`: Error message (only on failure)
- `posted_to_thread`: Original thread timestamp (when using `--thread-ts`)

### Basic Usage
```bash
# Simple test
./slack-qa-bot.js "Hello bot"

# JSON output for automation
./slack-qa-bot.js --json "Create a function" | jq -r .thread_ts

# Wait for full bot response with message content
./slack-qa-bot.js --wait-for-response --timeout 60 "Complex task"

# Extract bot response text
./slack-qa-bot.js --json --wait-for-response "What is 2+2?" | jq -r .response.text
```

### Queue Testing Scenarios

**Important:** When testing thread contamination or multiple messages in the same thread, always use `--thread-ts` to send messages to an existing thread rather than creating new threads for each message.

```bash
# Test sending to existing thread (after bot completes)
THREAD=$(./slack-qa-bot.js --json "Calculate 5+5" | jq -r .thread_ts)
sleep 30  # Wait for bot to complete
./slack-qa-bot.js --thread-ts "$THREAD" --json "Now calculate 6+6"

# Test parallel message processing (send while bot is processing)
THREAD=$(./slack-qa-bot.js --json "Start a complex task" | jq -r .thread_ts)
sleep 2  # Bot is still processing
./slack-qa-bot.js --thread-ts "$THREAD" --json "Add another request while processing"

# Test message after bot completes (sequential processing)
./slack-qa-bot.js --wait-for-response --json "First task" | jq -r .thread_ts > /tmp/thread.txt
THREAD=$(cat /tmp/thread.txt)
./slack-qa-bot.js --thread-ts "$THREAD" --json "Second task in same thread"

# Test worker recovery (simulate pod failure)
THREAD=$(./slack-qa-bot.js --json "Start long task" | jq -r .thread_ts)
sleep 5
docker stop $(docker ps -q --filter name=peerbot-worker-$THREAD | head -1)
sleep 2
./slack-qa-bot.js --thread-ts "$THREAD" --json "Continue after failure"

# Chain multiple operations in same thread
THREAD=$(./slack-qa-bot.js --json "Initialize project" | jq -r .thread_ts)
for i in 1 2 3; do
  sleep 20  # Wait between operations
  ./slack-qa-bot.js --thread-ts "$THREAD" --json "Step $i: Add feature $i"
done

# Conditional chaining based on success
RESULT=$(./slack-qa-bot.js --wait-for-response --json "Create database")
if [ $(echo "$RESULT" | jq -r .success) = "true" ]; then
  THREAD=$(echo "$RESULT" | jq -r .thread_ts)
  ./slack-qa-bot.js --thread-ts "$THREAD" "Add tables to database"
fi
```

### Advanced Thread Continuation with Bash Pipes

**Single-line thread continuation:**
```bash
# Start a task and immediately continue in the same thread
./slack-qa-bot.js --json "Create a React component" | jq -r .thread_ts | xargs -I {} ./slack-qa-bot.js --thread-ts {} "Add TypeScript types to it"

# Chain multiple operations using pipes
./slack-qa-bot.js --json --wait-for-response "Initialize a new project" | \
  jq -r .thread_ts | \
  xargs -I {} ./slack-qa-bot.js --wait-for-response --thread-ts {} "Add a README file" | \
  jq -r .thread_ts | \
  xargs -I {} ./slack-qa-bot.js --thread-ts {} "Set up CI/CD pipeline"
```

**Interactive thread continuation with response analysis:**
```bash
# Analyze bot response and continue based on content
analyze_and_continue() {
  local response=$(./slack-qa-bot.js --json --wait-for-response "$1")
  local thread_ts=$(echo "$response" | jq -r .thread_ts)
  local bot_text=$(echo "$response" | jq -r .response.text)
  
  echo "Bot responded: $bot_text"
  
  # Continue based on response content
  if echo "$bot_text" | grep -q "error\|failed"; then
    echo "Bot encountered an issue, asking for clarification..."
    ./slack-qa-bot.js --thread-ts "$thread_ts" "Can you explain the error and try again?"
  else
    echo "Bot succeeded, continuing with next step..."
    ./slack-qa-bot.js --thread-ts "$thread_ts" "Great! Now please run the tests."
  fi
}

analyze_and_continue "Create a Python function to calculate fibonacci"
```

**Thread continuation with response validation:**
```bash
# Function to validate bot response and retry if needed
validate_and_retry() {
  local prompt="$1"
  local max_attempts=3
  local attempt=1
  
  while [ $attempt -le $max_attempts ]; do
    echo "Attempt $attempt: $prompt"
    
    local result=$(./slack-qa-bot.js --json --wait-for-response --timeout 30 "$prompt")
    local success=$(echo "$result" | jq -r .success)
    local thread_ts=$(echo "$result" | jq -r .thread_ts)
    
    if [ "$success" = "true" ]; then
      local response_text=$(echo "$result" | jq -r .response.text)
      echo "Success: $response_text"
      echo "$thread_ts"  # Return thread for further use
      return 0
    else
      echo "Attempt $attempt failed, retrying..."
      attempt=$((attempt + 1))
    fi
  done
  
  echo "All attempts failed"
  return 1
}

# Use the validation function
if THREAD=$(validate_and_retry "Write a unit test for the function"); then
  ./slack-qa-bot.js --thread-ts "$THREAD" "Now run the test and show results"
fi
```

**Parallel thread processing with synchronization:**
```bash
# Process multiple threads in parallel, then synchronize
process_parallel_threads() {
  local threads=()
  local tasks=("Create API endpoint" "Write documentation" "Add error handling")
  
  # Start multiple threads in parallel
  for task in "${tasks[@]}"; do
    thread_ts=$(./slack-qa-bot.js --json "$task" | jq -r .thread_ts)
    threads+=("$thread_ts")
    echo "Started thread $thread_ts for: $task"
  done
  
  # Wait for all to complete and continue each
  sleep 45  # Allow time for processing
  
  for i in "${!threads[@]}"; do
    local thread="${threads[$i]}"
    local task="${tasks[$i]}"
    echo "Following up on thread $thread ($task)"
    ./slack-qa-bot.js --thread-ts "$thread" "Please review and finalize your work"
  done
}

process_parallel_threads
```

**Response data extraction and processing:**
```bash
# Extract specific data from bot responses
extract_code_blocks() {
  local response=$(./slack-qa-bot.js --json --wait-for-response "Show me a Python function example")
  local thread_ts=$(echo "$response" | jq -r .thread_ts)
  local bot_response=$(echo "$response" | jq -r .response.text)
  
  # Extract code blocks (simplified - assumes ```python code ``` format)
  if echo "$bot_response" | grep -q '```'; then
    echo "Code found in response, asking for improvements..."
    ./slack-qa-bot.js --thread-ts "$thread_ts" "Please add error handling to this code"
  else
    echo "No code found, requesting code example..."
    ./slack-qa-bot.js --thread-ts "$thread_ts" "Can you provide a code example?"
  fi
}

extract_code_blocks
```

**Automated testing workflows:**
```bash
# Complete testing workflow with error handling
run_development_workflow() {
  local project_thread
  
  # Step 1: Initialize project
  echo "🚀 Starting development workflow..."
  if ! project_thread=$(./slack-qa-bot.js --json --wait-for-response "Create a new Node.js project with TypeScript" | jq -r .thread_ts); then
    echo "❌ Failed to initialize project"
    return 1
  fi
  
  echo "✅ Project initialized in thread: $project_thread"
  
  # Step 2: Add components with validation
  local tasks=(
    "Add Express.js server setup"
    "Create a REST API endpoint"
    "Add input validation middleware"
    "Write unit tests"
    "Set up ESLint and Prettier"
  )
  
  for task in "${tasks[@]}"; do
    echo "📝 Working on: $task"
    
    local result=$(./slack-qa-bot.js --json --wait-for-response --timeout 60 --thread-ts "$project_thread" "$task")
    local success=$(echo "$result" | jq -r .success)
    
    if [ "$success" != "true" ]; then
      echo "❌ Task failed: $task"
      ./slack-qa-bot.js --thread-ts "$project_thread" "The previous task failed. Please analyze what went wrong and try again."
    else
      echo "✅ Completed: $task"
    fi
    
    sleep 10  # Brief pause between tasks
  done
  
  # Final validation
  echo "🔍 Final validation..."
  ./slack-qa-bot.js --thread-ts "$project_thread" "Please review the entire project and run any tests to ensure everything works correctly."
  
  echo "🎉 Development workflow completed for thread: $project_thread"
}

run_development_workflow
```

### Important Notes

**Reaction Detection Issues:**
The test script may sometimes report "No acknowledgment from bot" even when the bot is working correctly. This happens when the QA bot token lacks permissions to read message reactions. You can verify the bot is actually working by:

1. Checking the server logs for reaction updates (`eyes` → `gear` → `white_check_mark`)
2. Looking at the Slack channel directly to see reactions and bot responses
3. Using the verbose mode (without `--json`) to see detailed troubleshooting info

**Response Capture:**
Even with reaction detection issues, the JSON response format correctly captures bot responses when they're accessible. The `response` field will contain the bot's actual reply text, timestamp, and any rich formatting.

**Thread Continuation:**
Thread continuation works reliably regardless of reaction detection issues. The bot correctly maintains conversation context across messages in the same thread using persistent storage.