#!/usr/bin/env bash
set -euo pipefail

OPENCLAW_VERSION="2026.9.5"
NODE_VERSION="24.19.0"
TARGET_VERSION="${OPENCLAW_TARGET_VERSION:-${OPENCLAW_VERSION}}"
PREFIX=/opt/openclaw
SOURCE_DIR=/opt/openclaw-source
STATE_DIR=/var/lib/openclaw
CONFIG_DIR=/etc/openclaw
CONFIG_PATH=${CONFIG_DIR}/openclaw.json
SERVICE_PATH=/etc/systemd/system/openclaw-gateway.service
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

[[ "${EUID}" -eq 0 ]] || { echo "root required" >&2; exit 1; }
[[ "${TARGET_VERSION}" =~ ^[0-9]{4}\.[0-9]+\.[0-9]+$ ]] || { echo "invalid OpenClaw version" >&2; exit 2; }

if ! id openclaw >/dev/null 2>&1; then
  useradd --system --create-home --home-dir "${STATE_DIR}" --shell /sbin/nologin openclaw
fi
usermod -aG docker openclaw
install -d -m 0750 -o openclaw -g openclaw "${STATE_DIR}" "${STATE_DIR}/integritas"
install -d -m 0750 -o root -g openclaw "${CONFIG_DIR}"

CURRENT_FILE="${STATE_DIR}/integritas/current-version"
PREVIOUS_FILE="${STATE_DIR}/integritas/previous-version"
if [[ -f "${CURRENT_FILE}" ]]; then
  CURRENT="$(tr -d '[:space:]' <"${CURRENT_FILE}")"
  if [[ -n "${CURRENT}" && "${CURRENT}" != "${TARGET_VERSION}" ]]; then
    printf '%s\n' "${CURRENT}" >"${PREVIOUS_FILE}"
    chown openclaw:openclaw "${PREVIOUS_FILE}"
    chmod 0600 "${PREVIOUS_FILE}"
  fi
fi

INSTALLER="$(mktemp)"
trap 'rm -f "${INSTALLER}"' EXIT
curl -fsSL --proto '=https' --tlsv1.2 https://openclaw.ai/install-cli.sh -o "${INSTALLER}"
bash "${INSTALLER}" --prefix "${PREFIX}" --version "${TARGET_VERSION}" --node-version "${NODE_VERSION}" --no-onboard
chmod 0755 "${PREFIX}/bin/openclaw"
"${PREFIX}/bin/openclaw" --version | grep -F "${TARGET_VERSION}" >/dev/null

# Integritas research lanes pin web_search to the official Perplexity provider.
# Keep the plugin installation source-controlled so a rebuilt Oracle host exposes
# the same search capability as production. The credential remains server-side.
runuser -u openclaw -- env \
  HOME="${STATE_DIR}" OPENCLAW_HOME="${STATE_DIR}" OPENCLAW_STATE_DIR="${STATE_DIR}" \
  "${PREFIX}/bin/openclaw" plugins install @openclaw/perplexity-plugin

rm -rf "${SOURCE_DIR}"
git clone --depth=1 --branch "v${TARGET_VERSION}" https://github.com/openclaw/openclaw.git "${SOURCE_DIR}"
git -C "${SOURCE_DIR}" describe --tags --exact-match | grep -Fx "v${TARGET_VERSION}" >/dev/null
(
  cd "${SOURCE_DIR}"
  scripts/sandbox-setup.sh
  scripts/sandbox-browser-setup.sh
)

install -m 0640 -o root -g openclaw "${SCRIPT_DIR}/openclaw.json5" "${CONFIG_PATH}"
chown root:openclaw "${CONFIG_DIR}" "${CONFIG_PATH}"
chmod 0750 "${CONFIG_DIR}"
chmod 0640 "${CONFIG_PATH}"
install -m 0644 -o root -g root "${SCRIPT_DIR}/openclaw-gateway.service" "${SERVICE_PATH}"
chown -R openclaw:openclaw "${STATE_DIR}"

runuser -u openclaw -- env \
  HOME="${STATE_DIR}" OPENCLAW_HOME="${STATE_DIR}" \
  OPENCLAW_STATE_DIR="${STATE_DIR}" OPENCLAW_CONFIG_PATH="${CONFIG_PATH}" \
  "${PREFIX}/bin/openclaw" config validate

systemctl daemon-reload
systemctl enable --now openclaw-gateway.service
sleep 3
runuser -u openclaw -- env \
  HOME="${STATE_DIR}" OPENCLAW_HOME="${STATE_DIR}" \
  OPENCLAW_STATE_DIR="${STATE_DIR}" OPENCLAW_CONFIG_PATH="${CONFIG_PATH}" \
  "${PREFIX}/bin/openclaw" gateway status --deep --require-rpc

printf '%s\n' "${TARGET_VERSION}" >"${CURRENT_FILE}"
chown openclaw:openclaw "${CURRENT_FILE}"
chmod 0600 "${CURRENT_FILE}"
echo "OpenClaw ${TARGET_VERSION} installed with Docker-backed sandboxing."