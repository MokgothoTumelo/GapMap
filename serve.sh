#!/usr/bin/env bash
# Start a local static server for GapMap.
#
# Usage:
#   ./serve.sh            # serves on http://localhost:8000
#   ./serve.sh 9000       # serves on http://localhost:9000
#
# Requires Node.js and project dependencies. Ctrl+C to stop.
set -euo pipefail

PORT="${1:-8000}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v node >/dev/null 2>&1; then
  echo "node is required: https://nodejs.org/" >&2
  exit 1
fi

echo "Serving GapMap from $ROOT"
echo "  http://localhost:$PORT"
if [ "$(hostname)" = "matrixive-ct" ]; then
  echo "  http://10.144.152.201:$PORT   (from the host)"
fi
echo "Press Ctrl+C to stop."

cd "$ROOT"
export PORT
exec node serve.mjs