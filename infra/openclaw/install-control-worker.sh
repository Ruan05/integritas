#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  echo "Run as root" >&2
  exit 1
fi

REPO_ROOT=${INTEGRITAS_REPO_ROOT:-/opt/integritas/current}
SERVICE_SRC="$REPO_ROOT/infra/openclaw/integritas-control-worker.service"
GATEWAY_SERVICE_SRC="$REPO_ROOT/infra/openclaw/openclaw-gateway.service"
RUNNER_SERVICE_SRC="$REPO_ROOT/infra/openclaw/integritas-openclaw-investigation@.service"
RUNNER_SCRIPT_SRC="$REPO_ROOT/infra/openclaw/investigation-agent-runner.mjs"
RUNNER_SCRIPT_DEST=/opt/integritas/current/infra/openclaw/investigation-agent-runner.mjs
RUNNER_CONFIG_SRC="$REPO_ROOT/infra/openclaw/integritas-investigation.json5"
POLKIT_SRC="$REPO_ROOT/infra/openclaw/49-integritas-openclaw-control.rules"
ENV_DIR=/etc/integritas
ENV_FILE="$ENV_DIR/control-worker.env"
TOKEN_FILE="$ENV_DIR/control-worker.token"
PROVIDER_ENV_FILE="$ENV_DIR/provider-secrets.env"
PROVIDER_STAGING_FILE=${INTEGRITAS_PROVIDER_SECRET_STAGING:-/home/opc/.integritas-provider-secrets.env}
STATE_DIR=/var/lib/integritas-control
RUNNER_ROOT=/var/lib/integritas-runner
SHARED_GROUP=integritas-openclaw
OPENCLAW_CONFIG_DIR=/etc/openclaw
OPENCLAW_CONFIG_PATH="$OPENCLAW_CONFIG_DIR/openclaw.json"
RUNNER_CONFIG_DEST="$OPENCLAW_CONFIG_DIR/integritas-investigation.json"

repair_openclaw_config_permissions() {
  install -d -o root -g openclaw -m 0750 "$OPENCLAW_CONFIG_DIR"
  chown root:openclaw "$OPENCLAW_CONFIG_DIR"
  chmod 0750 "$OPENCLAW_CONFIG_DIR"
  if [[ -f "$OPENCLAW_CONFIG_PATH" ]]; then
    chown root:openclaw "$OPENCLAW_CONFIG_PATH"
    chmod 0640 "$OPENCLAW_CONFIG_PATH"
  fi
  if [[ -f "$RUNNER_CONFIG_DEST" ]]; then
    chown root:openclaw "$RUNNER_CONFIG_DEST"
    chmod 0640 "$RUNNER_CONFIG_DEST"
  fi
}

validate_provider_env_file() {
  local file="$1"
  local line name
  [[ -f "$file" ]] || { echo "Provider secret file is missing." >&2; return 1; }
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "$line" || "$line" == \#* ]] && continue
    [[ "$line" =~ ^([A-Z][A-Z0-9_]*)=.+$ ]] || {
      echo "Provider secret file contains a malformed line." >&2
      return 1
    }
    name="${BASH_REMATCH[1]}"
    case "$name" in
      GROQ_API_KEY|OPENROUTER_API_KEY|NVIDIA_API_KEY|GEMINI_API_KEY|GOOGLE_API_KEY|CEREBRAS_API_KEY|EXA_API_KEY|HF_TOKEN|HUGGINGFACE_HUB_TOKEN) ;;
      *)
        echo "Provider secret file contains an unapproved variable name: $name" >&2
        return 1
        ;;
    esac
  done < "$file"
  for name in GROQ_API_KEY OPENROUTER_API_KEY NVIDIA_API_KEY; do
    grep -Eq "^${name}=.+" "$file" || {
      echo "Provider secret file is missing required variable $name." >&2
      return 1
    }
  done
}

validate_openclaw_with_provider_env() {
  /usr/bin/env -i PATH=/usr/sbin:/usr/bin:/bin PROVIDER_ENV_FILE="$PROVIDER_ENV_FILE" /usr/bin/bash -c '
    set -a
    . "$PROVIDER_ENV_FILE"
    set +a
    export HOME=/var/lib/openclaw
    export OPENCLAW_HOME=/var/lib/openclaw
    export OPENCLAW_STATE_DIR=/var/lib/openclaw
    export OPENCLAW_CONFIG_PATH=/etc/openclaw/integritas-investigation.json
    exec /usr/sbin/runuser --preserve-environment -u openclaw -- /opt/openclaw/bin/openclaw config validate
  '
}

for required in /usr/bin/node /usr/bin/systemctl /usr/bin/systemd-analyze /usr/bin/getent /usr/bin/env /usr/bin/bash /usr/bin/grep /usr/sbin/useradd /usr/sbin/groupadd /usr/sbin/usermod /usr/sbin/runuser; do
  [[ -x "$required" ]] || { echo "Missing required executable: $required" >&2; exit 1; }
done
for required in "$SERVICE_SRC" "$GATEWAY_SERVICE_SRC" "$RUNNER_SERVICE_SRC" "$RUNNER_SCRIPT_SRC" "$RUNNER_CONFIG_SRC" "$POLKIT_SRC"; do
  [[ -f "$required" ]] || { echo "Missing required file: $required" >&2; exit 1; }
done
[[ -d /etc/polkit-1/rules.d ]] || { echo "Polkit rules directory is unavailable" >&2; exit 1; }
/usr/bin/getent passwd openclaw >/dev/null || { echo "OpenClaw runtime user is missing" >&2; exit 1; }
/usr/bin/getent group docker >/dev/null || { echo "Docker group is missing" >&2; exit 1; }

if ! /usr/bin/getent passwd integritas-control >/dev/null; then
  /usr/sbin/useradd --system --home-dir "$STATE_DIR" --create-home --shell /usr/sbin/nologin integritas-control
fi
if ! /usr/bin/getent group "$SHARED_GROUP" >/dev/null; then
  /usr/sbin/groupadd --system "$SHARED_GROUP"
fi
/usr/sbin/usermod -a -G "$SHARED_GROUP" integritas-control
/usr/sbin/usermod -a -G "$SHARED_GROUP" openclaw

install -d -o root -g root -m 0755 "$ENV_DIR"
install -d -o integritas-control -g integritas-control -m 0700 "$STATE_DIR"
install -d -o integritas-control -g "$SHARED_GROUP" -m 2770 "$RUNNER_ROOT" "$RUNNER_ROOT/jobs"
install -o root -g root -m 0644 "$SERVICE_SRC" /etc/systemd/system/integritas-control-worker.service
install -o root -g root -m 0644 "$GATEWAY_SERVICE_SRC" /etc/systemd/system/openclaw-gateway.service
install -o root -g root -m 0644 "$RUNNER_SERVICE_SRC" /etc/systemd/system/integritas-openclaw-investigation@.service
if [[ "$RUNNER_SCRIPT_SRC" == "$RUNNER_SCRIPT_DEST" ]]; then
  chown root:root "$RUNNER_SCRIPT_DEST"
  chmod 0755 "$RUNNER_SCRIPT_DEST"
else
  install -o root -g root -m 0755 "$RUNNER_SCRIPT_SRC" "$RUNNER_SCRIPT_DEST"
fi
repair_openclaw_config_permissions
install -o root -g openclaw -m 0640 "$RUNNER_CONFIG_SRC" "$RUNNER_CONFIG_DEST"
repair_openclaw_config_permissions
install -o root -g root -m 0644 "$POLKIT_SRC" /etc/polkit-1/rules.d/49-integritas-openclaw-control.rules

if [[ -f "$PROVIDER_STAGING_FILE" ]]; then
  validate_provider_env_file "$PROVIDER_STAGING_FILE"
  install -o root -g root -m 0600 "$PROVIDER_STAGING_FILE" "$PROVIDER_ENV_FILE"
fi
validate_provider_env_file "$PROVIDER_ENV_FILE"

if [[ ! -f "$ENV_FILE" ]]; then
  cat >"$ENV_FILE" <<'EOF'
# Non-secret Integritas outbound control-worker settings.
INTEGRITAS_CONTROL_URL=
INTEGRITAS_WORKER_ID=oracle-primary
INTEGRITAS_CONTROL_POLL_MS=5000
INTEGRITAS_CONTROL_WORKER_VERSION=0.2.0
EOF
  chmod 0600 "$ENV_FILE"
  chown root:root "$ENV_FILE"
fi
if [[ ! -f "$TOKEN_FILE" ]]; then
  install -o root -g root -m 0600 /dev/null "$TOKEN_FILE"
  echo "Created empty $TOKEN_FILE. Provision the scoped worker token through an authenticated operator path before starting the service." >&2
fi

validate_openclaw_with_provider_env
/usr/bin/systemctl daemon-reload
/usr/bin/systemd-analyze verify /etc/systemd/system/integritas-control-worker.service >/dev/null
/usr/bin/systemd-analyze verify /etc/systemd/system/openclaw-gateway.service >/dev/null
/usr/bin/systemd-analyze verify /etc/systemd/system/integritas-openclaw-investigation@.service >/dev/null

echo "Integritas control worker and bounded multi-provider OpenClaw investigation runner installed."
echo "Provider secrets are stored root-only in $PROVIDER_ENV_FILE; values were not logged."
