#!/bin/sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
APP_DIR="$ROOT_DIR"
LOG_DIR="$APP_DIR/logs"
RUN_DIR="$APP_DIR/run"
STATUS_FILE="$RUN_DIR/daily_status.json"
LOG_FILE="$LOG_DIR/daily-run.log"

mkdir -p "$LOG_DIR" "$RUN_DIR"
cd "$APP_DIR"

NODE_BIN="${NODE_BIN:-$(command -v node 2>/dev/null || true)}"
if [ -z "$NODE_BIN" ]; then
  if [ -x "/usr/local/bin/node" ]; then
    NODE_BIN="/usr/local/bin/node"
  elif [ -x "/volume1/@appstore/Node.js_v20/usr/local/bin/node" ]; then
    NODE_BIN="/volume1/@appstore/Node.js_v20/usr/local/bin/node"
  fi
fi

echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] daily-run wrapper start" >>"$LOG_FILE"

if [ -z "$NODE_BIN" ]; then
  echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] node binary not found" >>"$LOG_FILE"
  python3 - <<'PY' "$STATUS_FILE"
import json,sys,datetime
path=sys.argv[1]
payload={
  "status":"fail",
  "phase":"bootstrap",
  "message":"node binary not found for daily-run.sh",
  "finishedAt":datetime.datetime.utcnow().isoformat()+"Z",
  "updatedAt":datetime.datetime.utcnow().isoformat()+"Z",
}
with open(path,"w",encoding="utf-8") as f:
  json.dump(payload,f,ensure_ascii=False,indent=2)
PY
  exit 1
fi

"$NODE_BIN" "$APP_DIR/scripts/daily_autorun.mjs" "$@" >>"$LOG_FILE" 2>&1
