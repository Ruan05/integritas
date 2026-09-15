#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  echo "Run as root" >&2
  exit 1
fi

REPO_ROOT=${INTEGRITAS_REPO_ROOT:-/opt/integritas/current}
SERVICE_SRC="$REPO_ROOT/infra/openclaw/integritas-control-worker.service"
POLKIT_SRC="$REPO_ROOT/infra/openclaw/49-integritas-openclaw-control.rules"
ENV_DIR=/etc/integritas
ENV_FILE="$ENV_DIR/control-worker.env"
TOKEN_FILE="$ENV_DIR/control-worker.token"
STATE_DIR=/var/lib/integritas-control

for required in /usr/bin/node /usr/bin/systemctl /usr/bin/bash /usr/bin/getent /usr/sbin/useradd; do
  [[ -x "$required" ]] || { echo "Missing required executable: $required" >&2; exit 1; }
done
[[ -f "$SERVICE_SRC" ]] || { echo "Missing service file: $SERVICE_SRC" >&2; exit 1; }
[[ -f "$POLKIT_SRC" ]] || { echo "Missing Polkit rule: $POLKIT_SRC" >&2; exit 1; }
[[ -d /etc/polkit-1/rules.d ]] || { echo "Polkit rules directory is unavailable" >&2; exit 1; }

if ! /usr/bin/getent passwd integritas-control >/dev/null; then
  /usr/sbin/useradd --system --home-dir "$STATE_DIR" --create-home --shell /usr/sbin/nologin integritas-control
fi

install -d -o root -g root -m 0755 "$ENV_DIR"
install -d -o integritas-control -g integritas-control -m 0700 "$STATE_DIR"
install -o root -g root -m 0644 "$SERVICE_SRC" /etc/systemd/system/integritas-control-worker.service
install -o root -g root -m 0644 "$POLKIT_SRC" /etc/polkit-1/rules.d/49-integritas-openclaw-control.rules

if [[ ! -f "$ENV_FILE" ]]; then
  cat >"$ENV_FILE" <<'EOF'
# Non-secret Integritas outbound control-worker settings.
# Set INTEGRITAS_CONTROL_URL to the deployed Supabase integritas-control endpoint before starting.
INTEGRITAS_CONTROL_URL=
INTEGRITAS_WORKER_ID=oracle-primary
INTEGRITAS_CONTROL_POLL_MS=5000
INTEGRITAS_CONTROL_WORKER_VERSION=0.1.0
EOF
  chmod 0600 "$ENV_FILE"
  chown root:root "$ENV_FILE"
fi

if [[ ! -f "$TOKEN_FILE" ]]; then
  install -o root -g root -m 0600 /dev/null "$TOKEN_FILE"
  echo "Created empty $TOKEN_FILE. Provision the scoped worker token through an authenticated operator path before starting the service." >&2
fi

/usr/bin/systemctl daemon-reload

# Validate the unit without starting it. The service is deliberately not enabled until URL/token are provisioned.
/usr/bin/systemd-analyze verify /etc/systemd/system/integritas-control-worker.service >/dev/null

echo "Integritas control worker installed but not started."
echo "Provision the non-secret control URL in $ENV_FILE and the scoped token in $TOKEN_FILE, then enable/start the service."
