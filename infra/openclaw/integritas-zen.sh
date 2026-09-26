#!/usr/bin/env bash
set -euo pipefail

[[ ${EUID:-$(id -u)} -eq 0 ]] || { echo "root required" >&2; exit 1; }

ENV_FILE=/etc/integritas/provider-secrets.env
BASE_CONFIG=/etc/openclaw/integritas-investigation.json
ZEN_CONFIG=/etc/openclaw/integritas-investigation-zen.json
MARKER=/etc/openclaw/zen-enabled

key_present() {
  [[ -f "$ENV_FILE" ]] && grep -Eq '^OPENCODE_ZEN_API_KEY=.+' "$ENV_FILE"
}

validate_zen() {
  /usr/bin/env -i PATH=/usr/sbin:/usr/bin:/bin PROVIDER_ENV_FILE="$ENV_FILE" OPENCLAW_VALIDATE_CONFIG="$ZEN_CONFIG" /usr/bin/bash -c '
    set -a
    . "$PROVIDER_ENV_FILE"
    set +a
    export HOME=/var/lib/openclaw
    export OPENCLAW_HOME=/var/lib/openclaw
    export OPENCLAW_STATE_DIR=/var/lib/openclaw
    export OPENCLAW_CONFIG_PATH="$OPENCLAW_VALIDATE_CONFIG"
    exec /usr/sbin/runuser --preserve-environment -u openclaw -- /opt/openclaw/bin/openclaw config validate
  '
}

case "${1:-status}" in
  enable)
    key_present || { echo "OpenCode Zen key is not installed." >&2; exit 2; }
    [[ -f "$ZEN_CONFIG" ]] || { echo "Staged Zen config is missing." >&2; exit 3; }
    validate_zen
    install -o root -g openclaw -m 0640 /dev/null "$MARKER"
    echo "OpenCode Zen enabled for new investigation jobs."
    ;;
  disable)
    rm -f "$MARKER"
    echo "OpenCode Zen disabled for new investigation jobs."
    ;;
  status)
    printf 'key_present=%s\n' "$(key_present && echo yes || echo no)"
    printf 'enabled=%s\n' "$([[ -f "$MARKER" ]] && echo yes || echo no)"
    printf 'base_config=%s\n' "$([[ -f "$BASE_CONFIG" ]] && echo present || echo missing)"
    printf 'zen_config=%s\n' "$([[ -f "$ZEN_CONFIG" ]] && echo present || echo missing)"
    ;;
  *)
    echo "usage: integritas-zen [status|enable|disable]" >&2
    exit 64
    ;;
esac
