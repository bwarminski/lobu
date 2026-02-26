#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 <worker-image-ref>"
  echo "Example: $0 ghcr.io/lobu-ai/lobu-worker-base:latest"
  exit 1
fi

IMAGE_REF="$1"

run_with_timeout() {
  if command -v timeout >/dev/null 2>&1; then
    timeout 25s "$@"
    return $?
  fi
  if command -v gtimeout >/dev/null 2>&1; then
    gtimeout 25s "$@"
    return $?
  fi
  "$@"
}

if ! command -v docker >/dev/null 2>&1; then
  echo "❌ Docker CLI not found; cannot validate image reference: ${IMAGE_REF}"
  exit 1
fi

if run_with_timeout docker manifest inspect "${IMAGE_REF}" >/dev/null 2>&1; then
  echo "✅ Worker image is resolvable via registry manifest: ${IMAGE_REF}"
  exit 0
fi

if run_with_timeout docker image inspect "${IMAGE_REF}" >/dev/null 2>&1; then
  echo "✅ Worker image exists locally: ${IMAGE_REF}"
  exit 0
fi

echo "❌ Worker image preflight failed: ${IMAGE_REF}"
echo "   Unable to resolve image from registry and not present locally."
exit 1
