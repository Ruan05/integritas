#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  echo "Run as root from an authenticated Oracle operator session." >&2
  exit 1
fi

SHA="${1:-}"
REPO=/home/opc/integritas-e2e-investigation
DEPLOY="${REPO}/infra/oracle/deploy-integritas-release.sh"
CURRENT=/opt/integritas/current
WORKER=integritas-control-worker.service
GATEWAY=openclaw-gateway.service

[[ "${SHA}" =~ ^[0-9a-f]{40}$ ]] || { echo "Provide one exact 40-character Git commit SHA." >&2; exit 2; }
[[ -x "${DEPLOY}" ]] || { echo "Deployment script is unavailable." >&2; exit 3; }
/usr/bin/systemctl is-active --quiet "${WORKER}" || { echo "Worker must be active before rollback test." >&2; exit 4; }
/usr/bin/systemctl is-active --quiet "${GATEWAY}" || { echo "Gateway must be active before rollback test." >&2; exit 5; }
if /usr/bin/systemctl list-units --type=service --state=active 'integritas-openclaw-investigation@*.service' --no-legend | /usr/bin/grep -q .; then
  echo "Active investigation unit detected; rollback test refused." >&2
  exit 6
fi

OLD="$(readlink -f "${CURRENT}")"
[[ -n "${OLD}" && -d "${OLD}" ]] || { echo "Current release is invalid." >&2; exit 7; }
FILES=(
  /etc/integritas/provider-secrets.env
  /etc/openclaw/openclaw.json
  /etc/openclaw/integritas-gateway.json
  /etc/openclaw/integritas-investigation.json
  /etc/systemd/system/integritas-control-worker.service
  /etc/systemd/system/openclaw-gateway.service
  /etc/systemd/system/integritas-openclaw-investigation@.service
  /etc/polkit-1/rules.d/49-integritas-openclaw-control.rules
  /opt/integritas/deployed-release
  /home/opc/.integritas-provider-secrets.env
)

BEFORE="$(/usr/bin/mktemp)"
AFTER="$(/usr/bin/mktemp)"
cleanup() {
  rm -f "${BEFORE}" "${AFTER}"
}
trap cleanup EXIT

fingerprint() {
  local file hash meta
  for file in "${FILES[@]}"; do
    if [[ -e "${file}" ]]; then
      hash="$(/usr/bin/sha256sum "${file}" | /usr/bin/awk '{print $1}')"
      meta="$(/usr/bin/stat -c '%U:%G:%a:%s' "${file}")"
      printf '%s|%s|%s\n' "${file}" "${meta}" "${hash}"
    else
      printf '%s|ABSENT\n' "${file}"
    fi
  done
}
fingerprint > "${BEFORE}"

set +e
INTEGRITAS_ROLLBACK_TEST=1 \
INTEGRITAS_FAULT_INJECT_PHASE=after-install \
  "${DEPLOY}" "${SHA}"
rc=$?
set -e

if [[ ${rc} -eq 0 ]]; then
  echo "Rollback test failed: injected deployment unexpectedly succeeded." >&2
  exit 8
fi

CURRENT_AFTER="$(readlink -f "${CURRENT}")"
[[ "${CURRENT_AFTER}" == "${OLD}" ]] || {
  echo "Rollback test failed: current release was not restored." >&2
  exit 9
}
/usr/bin/systemctl is-active --quiet "${WORKER}" || {
  echo "Rollback test failed: worker is not active." >&2
  exit 10
}
/usr/bin/systemctl is-active --quiet "${GATEWAY}" || {
  echo "Rollback test failed: Gateway is not active." >&2
  exit 11
}

fingerprint > "${AFTER}"
if ! diff -u "${BEFORE}" "${AFTER}"; then
  echo "Rollback test failed: managed host state differs from the pre-test snapshot." >&2
  exit 12
fi

echo "Integritas privileged rollback acceptance test passed."
echo "Previous release, managed host files, worker, and Gateway were restored exactly."
