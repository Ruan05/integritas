#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${INTEGRITAS_DATADOG_ENV_FILE:-/etc/integritas/datadog.env}"
AGENT_CONFIG_DIR=/etc/datadog-agent
JOURNAL_CONFIG="${AGENT_CONFIG_DIR}/conf.d/journald.d/conf.yaml"
DROPIN_DIR=/etc/systemd/system/datadog-agent.service.d
DROPIN_FILE="${DROPIN_DIR}/integritas.conf"

[[ "${EUID}" -eq 0 ]] || { echo "root required" >&2; exit 1; }
[[ -f "${ENV_FILE}" ]] || {
  echo "Datadog credential file is missing: ${ENV_FILE}" >&2
  echo "Create it root-only with DD_API_KEY and optional DD_SITE; do not pass the key on the command line." >&2
  exit 2
}
mode="$(stat -c '%a' "${ENV_FILE}")"
[[ "${mode}" == "600" ]] || { echo "Datadog credential file must be mode 0600." >&2; exit 3; }

set -a
# shellcheck disable=SC1090
. "${ENV_FILE}"
set +a
: "${DD_API_KEY:?DD_API_KEY is required in the root-only Datadog credential file}"
DD_SITE="${DD_SITE:-datadoghq.com}"
if ! command -v datadog-agent >/dev/null 2>&1; then
  installer="$(mktemp)"
  trap 'rm -f "${installer}"' EXIT
  curl -fsSL --proto '=https' --tlsv1.2     https://s3.amazonaws.com/dd-agent/scripts/install_script_agent7.sh     -o "${installer}"
  DD_AGENT_MAJOR_VERSION=7 DD_API_KEY="${DD_API_KEY}" DD_SITE="${DD_SITE}"     bash "${installer}"
fi

getent passwd dd-agent >/dev/null || { echo "Datadog Agent account is unavailable." >&2; exit 4; }
install -d -o dd-agent -g dd-agent -m 0755 "${AGENT_CONFIG_DIR}/conf.d/journald.d"
install -d -o root -g root -m 0755 "${DROPIN_DIR}"

cat >"${DROPIN_FILE}" <<'EOF'
[Service]
Environment=DD_LOGS_ENABLED=true
Environment=DD_PROCESS_AGENT_PROCESS_COLLECTION_ENABLED=true
Environment=DD_ENV=production
Environment="DD_TAGS=service:integritas component:oracle-openclaw managed_by:integritas"
EOF
chmod 0644 "${DROPIN_FILE}"
cat >"${JOURNAL_CONFIG}" <<'EOF'
logs:
  - type: journald
    config_id: integritas-control-worker
    path: /var/log/journal/
    source: integritas
    service: integritas-control-worker
    include_units:
      - integritas-control-worker.service
  - type: journald
    config_id: openclaw-gateway
    path: /var/log/journal/
    source: openclaw
    service: openclaw-gateway
    include_units:
      - openclaw-gateway.service
  - type: journald
    config_id: openclaw-browser
    path: /var/log/journal/
    source: openclaw
    service: openclaw-browser
    include_units:
      - openclaw-browser.service
EOF
chown root:dd-agent "${JOURNAL_CONFIG}"
chmod 0640 "${JOURNAL_CONFIG}"
if getent group systemd-journal >/dev/null 2>&1; then
  usermod -aG systemd-journal dd-agent
fi

systemctl daemon-reload
systemctl enable datadog-agent.service >/dev/null
systemctl restart datadog-agent.service
systemctl is-active --quiet datadog-agent.service

datadog-agent configcheck >/dev/null
datadog-agent status >/dev/null

echo "Datadog Agent is active with Integritas host/process monitoring and bounded journald collection."
echo "Credential values were not logged."
