#!/bin/sh
set -eu

BASE_URL="${1:-http://127.0.0.1:5173}"

echo "Smoke: $BASE_URL"

fetch() {
  path="$1"
  echo "== $path"
  curl -fsS "${BASE_URL}${path}" | head -c 800
  echo
}

fetch "/data/daily-status"
fetch "/data/latest.seed.json"
fetch "/data/eth.price.seed.json"
fetch "/data/perf-summary"
fetch "/data/iteration-latest"

echo "OK"

