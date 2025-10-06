#!/bin/bash
set -e

# Container entrypoint script for Claude Worker
echo "🚀 Starting Claude Code Worker container..."

# Function to handle cleanup on exit
cleanup() {
    echo "📦 Container shutting down, performing cleanup..."
    
    # Kill any background processes
    jobs -p | xargs -r kill || true
    
    # Give processes time to exit gracefully
    sleep 2
    
    echo "✅ Cleanup completed"
    exit 0
}

# Setup signal handlers for graceful shutdown
trap cleanup SIGTERM SIGINT

echo "🔍 Environment variables provided by orchestrator:"
echo "  - USER_ID: ${USER_ID:-not set}" 
echo "  - CHANNEL_ID: ${CHANNEL_ID:-not set}"
echo "  - REPOSITORY_URL: ${REPOSITORY_URL:-not set}"
echo "  - DEPLOYMENT_NAME: ${DEPLOYMENT_NAME:-not set}"

# Basic validation for critical variables
if [[ -z "${USER_ID:-}" ]]; then
    echo "❌ Error: USER_ID is required"
    exit 1
fi

if [[ -z "${DEPLOYMENT_NAME:-}" ]]; then
    echo "❌ Error: DEPLOYMENT_NAME is required"
    exit 1
fi

echo "✅ Critical environment variables are set"

# Setup Google Cloud credentials if provided
if [[ -n "${GOOGLE_APPLICATION_CREDENTIALS:-}" ]]; then
    echo "🔑 Setting up Google Cloud credentials..."
    
    # Ensure the credentials file exists
    if [[ -f "$GOOGLE_APPLICATION_CREDENTIALS" ]]; then
        echo "✅ Google Cloud credentials file found"
        
        # Set proper permissions
        chmod 600 "$GOOGLE_APPLICATION_CREDENTIALS"
        
        # Test credentials
        if command -v gcloud >/dev/null 2>&1; then
            echo "🧪 Testing Google Cloud credentials..."
            if gcloud auth application-default print-access-token >/dev/null 2>&1; then
                echo "✅ Google Cloud credentials are valid"
            else
                echo "⚠️ Warning: Google Cloud credentials test failed"
            fi
        fi
    else
        echo "⚠️ Warning: Google Cloud credentials file not found at $GOOGLE_APPLICATION_CREDENTIALS"
    fi
fi

# Setup workspace directory
echo "📁 Setting up workspace directory..."
WORKSPACE_DIR="/workspace"
mkdir -p "$WORKSPACE_DIR"

# Fix permissions for bind-mounted workspace (Docker Compose)
# This is needed because bind mounts inherit host permissions
if [ -d "$WORKSPACE_DIR" ] && [ "$(stat -c %U "$WORKSPACE_DIR")" = "root" ]; then
    echo "🔧 Fixing workspace permissions (bind mount detected)..."
    sudo chown -R claude:claude "$WORKSPACE_DIR" 2>/dev/null || echo "⚠️  Could not change workspace ownership"
    chmod 755 "$WORKSPACE_DIR" 2>/dev/null || echo "⚠️  Could not change workspace permissions"
fi

cd "$WORKSPACE_DIR"

echo "✅ Workspace directory ready: $WORKSPACE_DIR"

# Log container information
echo "📊 Container Information:"
echo "  - Session Key: $SESSION_KEY"
echo "  - Repository: $REPOSITORY_URL"
echo "  - Recovery Mode: ${RECOVERY_MODE:-false}"
echo "  - Working Directory: $(pwd)"
echo "  - Container Hostname: $(hostname)"
echo "  - Container Memory Limit: $(cat /sys/fs/cgroup/memory.max 2>/dev/null || echo 'unknown')"
echo "  - Container CPU Limit: $(cat /sys/fs/cgroup/cpu.max 2>/dev/null || echo 'unknown')"

# Check available tools
echo "🔧 Checking available tools..."
tools_to_check=(
    "node"
    "bun" 
    "git"
    "claude"
    "curl"
    "jq"
)

for tool in "${tools_to_check[@]}"; do
    if command -v "$tool" >/dev/null 2>&1; then
        version=$(timeout 5 "$tool" --version 2>/dev/null | head -1 || echo "unknown")
        echo "  ✅ $tool: $version"
    else
        echo "  ❌ $tool: not available"
    fi
done

# Check Claude CLI specifically
echo "🤖 Checking Claude CLI installation..."
if command -v claude >/dev/null 2>&1; then
    claude_version=$(timeout 10 claude --version 2>/dev/null || echo "unknown")
    echo "  ✅ Claude CLI: $claude_version"
    
    # Test Claude CLI basic functionality
    if timeout 10 claude --help >/dev/null 2>&1; then
        echo "  ✅ Claude CLI is functional"
    else
        echo "  ⚠️ Warning: Claude CLI help test failed"
    fi
    
    # Setup MCP server configuration for Claude Code
    echo "🔧 Configuring MCP servers for Claude Code..."
    if [ -f "/app/packages/worker/mcp-config.json" ]; then
        mkdir -p /home/claude/.claude
        cp /app/packages/worker/mcp-config.json /home/claude/.claude/settings.mcp.json
        echo "  ✅ MCP server configuration deployed to /home/claude/.claude/settings.mcp.json"
        
        # Also ensure the MCP server is executable
        if [ -f "/app/packages/worker/dist/mcp/process-manager-server.mjs" ]; then
            chmod +x /app/packages/worker/dist/mcp/process-manager-server.mjs
            echo "  ✅ MCP server made executable"
        fi
    else
        echo "  ⚠️ Warning: MCP config file not found"
    fi
else
    echo "  ❌ Error: Claude CLI not found in PATH"
    echo "  PATH: $PATH"
    exit 1
fi

# Setup git global configuration
echo "⚙️ Setting up git configuration..."
git config --global user.name "Claude Code Worker"
git config --global user.email "claude-code-worker@noreply.github.com"
git config --global init.defaultBranch main
git config --global pull.rebase false
git config --global safe.directory '*'

echo "✅ Git configuration completed"

# Check if Anthropic proxy authentication is configured
if [[ -n "${ANTHROPIC_API_KEY:-}" && -n "${ANTHROPIC_BASE_URL:-}" ]]; then
    echo "🔐 Anthropic proxy authentication is configured"
    # Extract just the username for logging (don't log the password)
    AUTH_USER=$(echo "$ANTHROPIC_API_KEY" | cut -d: -f1)
    echo "✅ Configured proxy authentication for user: $AUTH_USER"
elif [[ -n "${ANTHROPIC_BASE_URL:-}" ]]; then
    echo "⚠️ Warning: ANTHROPIC_BASE_URL is set but ANTHROPIC_API_KEY is not configured"
fi

# Display final status
echo "🎯 Starting worker execution..."
echo "  - Session: ${SESSION_KEY:-unknown}"
echo "  - User ID: ${USER_ID:-unknown}"  
echo "  - Timeout: 5 minutes (managed by orchestrator)"
echo "  - Recovery: ${RECOVERY_MODE:-false}"

# Make scripts executable
chmod +x /app/scripts/*.sh 2>/dev/null || true

# Always build the MCP server to ensure we have the latest version
# This is needed because the Docker image may have stale compiled JS
echo "Building packages to ensure MCP server is up to date..."
cd /app/packages/shared && bun run build
cd /app/packages/worker && bun run build
chmod +x /app/packages/worker/dist/mcp/process-manager-server.mjs 2>/dev/null || true

# Setup MCP server AFTER building
/app/packages/worker/scripts/setup-mcp-server.sh || echo "⚠️  MCP server setup failed or not found"

# Start the worker process
echo "🚀 Executing Claude Worker..."
# Check if we're already in the worker directory
if [ "$(pwd)" != "/app/packages/worker" ]; then
    cd /app/packages/worker || { echo "❌ Failed to cd to /app/packages/worker"; exit 1; }
fi

# In development mode, run from source to avoid path resolution issues with modules
if [ "${NODE_ENV}" = "development" ]; then
    echo "📝 Running in development mode from source..."
    exec bun run src/index.ts
else
    exec bun run dist/src/index.js
fi