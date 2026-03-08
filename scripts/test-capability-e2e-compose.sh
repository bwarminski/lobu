#!/usr/bin/env bash
# ABOUTME: Runs capability decision probes against an already running make dev stack.
# ABOUTME: Seeds temporary Redis capability records and emits JSON results for assertions.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/docker/docker-compose.yml"
ARTIFACT_DIR="$ROOT_DIR/tmp/integration-artifacts"
READINESS_URL="http://localhost:8080/ready"
PROBE_SCRIPT="$ROOT_DIR/scripts/capability-proxy-probe.ts"
MODE="${1:-deny_proxy}"
DESTINATION="${2:-http://api.openai.com/v1/models}"

DEPLOYMENT_NAME="itest-worker"
AGENT_ID="itest-agent"
CONVERSATION_ID="itest-conversation"
USER_ID="itest-user"
CHANNEL_ID="itest-channel"
ENV_FILE="$ROOT_DIR/.env"
ENCRYPTION_KEY_VALUE=""
GENERATED_ENCRYPTION_KEY="0"
REPAIRED_ENV_PATH="0"

mkdir -p "$ARTIFACT_DIR"

cleanup() {
  docker compose -f "$COMPOSE_FILE" logs gateway >"$ARTIFACT_DIR/gateway.log" 2>&1 || true
  docker compose -f "$COMPOSE_FILE" logs redis >"$ARTIFACT_DIR/redis.log" 2>&1 || true
  docker compose -f "$COMPOSE_FILE" exec -T redis redis-cli del "capreg:$AGENT_ID" >/dev/null 2>&1 || true
}
trap cleanup EXIT

require_bin() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Required command not found: $1" >&2
    exit 1
  fi
}

require_bin bun
require_bin docker
require_bin curl
require_bin openssl

ensure_encryption_key() {
  if [ -n "${ENCRYPTION_KEY:-}" ]; then
    ENCRYPTION_KEY_VALUE="${ENCRYPTION_KEY}"
    return
  fi

  if [ -d "$ENV_FILE" ]; then
    local backup_path
    backup_path="$ROOT_DIR/.env.backup.$(date +%s)"
    if ! mv "$ENV_FILE" "$backup_path"; then
      echo "Failed to repair .env directory at $ENV_FILE" >&2
      echo "Move it manually, create .env file, then rerun." >&2
      exit 1
    fi
    REPAIRED_ENV_PATH="1"
    if [ -f "$ROOT_DIR/.env.example" ]; then
      cp "$ROOT_DIR/.env.example" "$ENV_FILE"
    else
      touch "$ENV_FILE"
    fi
  fi

  if [ ! -f "$ENV_FILE" ]; then
    touch "$ENV_FILE"
  fi

  ENCRYPTION_KEY_VALUE="$(
    (rg '^ENCRYPTION_KEY=' "$ENV_FILE" || true) | sed 's/^ENCRYPTION_KEY=//' | head -1
  )"
  if [ -z "$ENCRYPTION_KEY_VALUE" ]; then
    ENCRYPTION_KEY_VALUE="$(openssl rand -base64 32 | tr -d '\n')"
    printf '\nENCRYPTION_KEY=%s\n' "$ENCRYPTION_KEY_VALUE" >>"$ENV_FILE"
    GENERATED_ENCRYPTION_KEY="1"
  fi
}

resolve_hostname() {
  bun -e 'console.log(new URL(process.argv[1]).hostname)' "$1"
}

create_worker_token() {
  ENCRYPTION_KEY="$ENCRYPTION_KEY_VALUE" \
    bun -e '
      import { generateWorkerToken } from "./packages/core/src/worker/auth";
      const token = generateWorkerToken(process.argv[1], process.argv[2], process.argv[3], {
        channelId: process.argv[4],
        agentId: process.argv[5],
      });
      console.log(token);
    ' "$USER_ID" "$CONVERSATION_ID" "$DEPLOYMENT_NAME" "$CHANNEL_ID" "$AGENT_ID"
}

seed_capability_record() {
  local capability_destinations="$1"
  local payload

  payload="{\"capabilities\":[{\"operation\":\"egress_http\",\"destinations\":$capability_destinations}],\"trustZone\":\"unknown\"}"
  docker compose -f "$COMPOSE_FILE" exec -T redis redis-cli set "capreg:$AGENT_ID" "$payload" >/dev/null
}

clear_capability_record() {
  docker compose -f "$COMPOSE_FILE" exec -T redis redis-cli del "capreg:$AGENT_ID" >/dev/null
}

wait_for_gateway() {
  for _ in {1..60}; do
    if curl -sf "$READINESS_URL" >/dev/null; then
      return
    fi
    sleep 1
  done
  echo "Gateway did not become ready: $READINESS_URL" >&2
  echo "Start dev stack first: make dev" >&2
  exit 1
}

wait_for_gateway

ensure_encryption_key

if [ "$GENERATED_ENCRYPTION_KEY" = "1" ]; then
  if [ "$REPAIRED_ENV_PATH" = "1" ]; then
    echo "Repaired .env path (directory -> file) and generated ENCRYPTION_KEY." >&2
  else
    echo "Generated ENCRYPTION_KEY in .env for integration tests." >&2
  fi
  echo "Restart make dev so gateway loads the new key, then rerun:" >&2
  echo "  bun run test:integration:capabilities" >&2
  exit 1
fi

HOSTNAME="$(resolve_hostname "$DESTINATION")"

case "$MODE" in
  deny_proxy)
    seed_capability_record '["api.github.com"]'
    ;;
  approval_proxy|allow_decision)
    seed_capability_record "[\"$HOSTNAME\"]"
    ;;
  fallback_allow_decision)
    clear_capability_record
    ;;
  *)
    echo "Unsupported mode: $MODE" >&2
    exit 1
    ;;
esac

WORKER_TOKEN="$(create_worker_token)"

if [ "$MODE" = "deny_proxy" ] || [ "$MODE" = "approval_proxy" ]; then
  bun "$PROBE_SCRIPT" \
    --gateway-host localhost \
    --deployment-name "$DEPLOYMENT_NAME" \
    --worker-token "$WORKER_TOKEN" \
    --destination "$DESTINATION"
  exit 0
fi

DECISION_BODY="$(curl -sS -X POST "http://localhost:8080/internal/capabilities/decide" \
  -H "Authorization: Bearer $WORKER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"operation\":\"egress_http\",\"destination\":\"$HOSTNAME\"}" \
  -w "\n%{http_code}")"

DECISION_SPLIT="${DECISION_BODY%$'\n'*}"
DECISION_STATUS="${DECISION_BODY##*$'\n'}"

printf '{"status":%s,"body":%s}\n' "$DECISION_STATUS" "$DECISION_SPLIT"
