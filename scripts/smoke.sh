#!/bin/sh
set -eu

BASE_URL="${1:-http://127.0.0.1:5173}"

echo "Smoke: $BASE_URL"

fetch() {
  path="$1"
  echo "== $path"
  # Write to a temp file then truncate output. This avoids SIGPIPE noise (curl 23/56)
  # when the consumer closes the pipe early.
  tmp="$(mktemp 2>/dev/null || echo "/tmp/eth_a_smoke_${$}_$RANDOM")"
  curl -fsS "${BASE_URL}${path}" -o "$tmp"
  head -c 800 "$tmp"
  rm -f "$tmp" 2>/dev/null || true
  echo
}

fetch "/data/daily-status"
fetch "/data/latest.seed.json"
fetch "/data/eth.price.seed.json"
fetch "/data/perf-summary"
fetch "/data/iteration-latest"

echo "OK"
