#!/usr/bin/env bash
set -euo pipefail

export HOME=/var/lib/openclaw
export OPENCLAW_HOME=/var/lib/openclaw
export OPENCLAW_STATE_DIR=/var/lib/openclaw
export OPENCLAW_CONFIG_PATH=/etc/openclaw/integritas-gateway.json

for _ in $(seq 1 30); do
  if /opt/openclaw/bin/openclaw health >/dev/null 2>&1; then
    /opt/openclaw/bin/openclaw browser --browser-profile openclaw start >/dev/null
    /opt/openclaw/bin/openclaw browser --browser-profile openclaw doctor
    exit 0
  fi
  /usr/bin/sleep 2
done

echo "OpenClaw Gateway did not become ready for managed browser startup." >&2
exit 1
