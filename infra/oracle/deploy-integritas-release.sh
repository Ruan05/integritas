#!/usr/bin/env bash
set -Eeuo pipefail

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  echo "Run as root from an authenticated Oracle operator session." >&2
  exit 1
fi

SHA="${1:-}"
SOURCE_REPO="${INTEGRITAS_SOURCE_REPO:-/home/opc/integritas-e2e-investigation}"
RELEASES=/opt/integritas/releases
CURRENT=/opt/integritas/current
WORKER=integritas-control-worker.service
GATEWAY=openclaw-gateway.service
PROVIDER_STAGING_FILE=${INTEGRITAS_PROVIDER_SECRET_STAGING:-/home/opc/.integritas-provider-secrets.env}
FAULT_INJECT_PHASE=${INTEGRITAS_FAULT_INJECT_PHASE:-}
ROLLBACK_TEST=${INTEGRITAS_ROLLBACK_TEST:-0}
ROLLBACK_STATE=
MANAGED_FILES=(
  /etc/integritas/provider-secrets.env
  /etc/openclaw/openclaw.json
  /etc/openclaw/integritas-gateway.json
  /etc/openclaw/integritas-investigation.json
  /etc/systemd/system/integritas-control-worker.service
  /etc/systemd/system/openclaw-gateway.service
  /etc/systemd/system/integritas-openclaw-investigation@.service
  /etc/polkit-1/rules.d/49-integritas-openclaw-control.rules
  /opt/integritas/deployed-release
)

case "${FAULT_INJECT_PHASE}" in
  ""|after-install) ;;
  *) echo "Unsupported fault injection phase." >&2; exit 8 ;;
esac
if [[ -n "${FAULT_INJECT_PHASE}" && "${ROLLBACK_TEST}" != "1" ]]; then
  echo "Fault injection requires INTEGRITAS_ROLLBACK_TEST=1." >&2
  exit 8
fi

snapshot_managed_files() {
  ROLLBACK_STATE="$(/usr/bin/mktemp -d /var/tmp/integritas-release-rollback.XXXXXX)"
  chmod 0700 "${ROLLBACK_STATE}"
  local file parent
  for file in "${MANAGED_FILES[@]}"; do
    parent="${ROLLBACK_STATE}$(dirname "${file}")"
    install -d -m 0700 "${parent}"
    if [[ -e "${file}" ]]; then
      /usr/bin/cp -a "${file}" "${ROLLBACK_STATE}${file}"
    else
      : > "${ROLLBACK_STATE}${file}.__absent"
    fi
  done
}

restore_managed_files() {
  [[ -n "${ROLLBACK_STATE}" && -d "${ROLLBACK_STATE}" ]] || return 0
  local file
  for file in "${MANAGED_FILES[@]}"; do
    if [[ -e "${ROLLBACK_STATE}${file}.__absent" ]]; then
      rm -f "${file}"
    elif [[ -e "${ROLLBACK_STATE}${file}" ]]; then
      install -d -m 0755 "$(dirname "${file}")"
      rm -f "${file}"
      /usr/bin/cp -a "${ROLLBACK_STATE}${file}" "${file}"
    fi
  done
}

[[ "${SHA}" =~ ^[0-9a-f]{40}$ ]] || { echo "Provide one exact 40-character Git commit SHA." >&2; exit 2; }
[[ -d "${SOURCE_REPO}/.git" ]] || { echo "Source repository is unavailable: ${SOURCE_REPO}" >&2; exit 3; }
/usr/bin/git -C "${SOURCE_REPO}" cat-file -e "${SHA}^{commit}" 2>/dev/null || { echo "Commit is not present in the source repository." >&2; exit 4; }

OLD="$(readlink -f "${CURRENT}")"
NEW="${RELEASES}/${SHA}"
[[ -n "${OLD}" && -d "${OLD}" ]] || { echo "Current Integritas release is invalid." >&2; exit 5; }

if [[ ! -d "${NEW}" ]]; then
  install -d -o root -g root -m 0755 "${NEW}"
  /usr/bin/git -C "${SOURCE_REPO}" archive "${SHA}" | /usr/bin/tar -x -C "${NEW}"
  chown -R root:root "${NEW}"
fi

for required in   infra/openclaw/install-control-worker.sh   infra/openclaw/investigation-agent-runner.mjs   infra/openclaw/integritas-gateway.json5   infra/openclaw/integritas-investigation.json5   infra/openclaw/integritas-control-worker.service   infra/openclaw/openclaw-gateway.service   infra/openclaw/integritas-openclaw-investigation@.service; do
  [[ -f "${NEW}/${required}" ]] || { echo "Release is missing ${required}." >&2; exit 6; }
done

(
  cd "${NEW}"
  /usr/bin/node --test infra/openclaw/control-worker/test/agent-runner-contract.test.mjs
  /usr/bin/node scripts/verify-control-bridge-policy.mjs
  /usr/bin/node scripts/verify-oracle-openclaw-infra.mjs
  /usr/bin/git diff --no-index /dev/null /dev/null >/dev/null
)
/usr/bin/bash -n "${NEW}/infra/openclaw/install-control-worker.sh"

if /usr/bin/systemctl list-units --type=service --state=active 'integritas-openclaw-investigation@*.service' --no-legend | /usr/bin/grep -q .; then
  echo "Active investigation unit detected; deployment aborted without changing host state." >&2
  exit 7
fi

snapshot_managed_files
switched=0
worker_stopped=0
rollback() {
  rc=$?
  trap - ERR
  if [[ ${switched} -eq 1 ]]; then
    tmp="${CURRENT}.rollback.$$"
    rm -f "${tmp}"
    ln -s "${OLD}" "${tmp}"
    mv -Tf "${tmp}" "${CURRENT}"
    INTEGRITAS_REPO_ROOT="${OLD}" /usr/bin/bash "${OLD}/infra/openclaw/install-control-worker.sh" || true
    restore_managed_files || true
    /usr/bin/systemctl daemon-reload || true
    /usr/bin/systemctl restart "${GATEWAY}" || true
  fi
  if [[ ${worker_stopped} -eq 1 ]]; then
    /usr/bin/systemctl restart "${WORKER}" || true
  fi
  if [[ -n "${ROLLBACK_STATE}" && -d "${ROLLBACK_STATE}" ]]; then
    rm -rf "${ROLLBACK_STATE}"
  fi
  echo "Integritas release deployment failed; previous release restored where possible." >&2
  exit "${rc}"
}
trap rollback ERR

/usr/bin/systemctl stop "${WORKER}"
worker_stopped=1

tmp="${CURRENT}.next.$$"
rm -f "${tmp}"
ln -s "${NEW}" "${tmp}"
mv -Tf "${tmp}" "${CURRENT}"
switched=1

INTEGRITAS_REPO_ROOT="${NEW}" /usr/bin/bash "${NEW}/infra/openclaw/install-control-worker.sh"
if [[ "${FAULT_INJECT_PHASE}" == "after-install" ]]; then
  echo "Injecting controlled rollback-test failure after candidate installation." >&2
  /usr/bin/false
fi
/usr/bin/systemctl restart "${GATEWAY}"
/usr/bin/systemctl is-active --quiet "${GATEWAY}"
/usr/bin/systemctl restart "${WORKER}"
worker_stopped=0
/usr/bin/systemctl is-active --quiet "${WORKER}"
/usr/bin/systemctl is-active --quiet "${GATEWAY}"
readlink -f "${CURRENT}" | /usr/bin/grep -Fxq "${NEW}"

printf '%s\n' "${SHA}" > /opt/integritas/deployed-release
chmod 0644 /opt/integritas/deployed-release
if [[ -f "${PROVIDER_STAGING_FILE}" ]]; then
  rm -f "${PROVIDER_STAGING_FILE}"
fi
if [[ -n "${ROLLBACK_STATE}" && -d "${ROLLBACK_STATE}" ]]; then
  rm -rf "${ROLLBACK_STATE}"
fi
trap - ERR

echo "Integritas release ${SHA} deployed successfully."
echo "Worker and OpenClaw Gateway are active. Public-site configuration was not modified."
