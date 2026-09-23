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
  /etc/openclaw/integritas-investigation-zen.json
  /etc/openclaw/zen-enabled
  /usr/local/sbin/integritas-zen
  /usr/local/sbin/integritas-datadog-install
  /etc/systemd/system/integritas-control-worker.service
  /etc/systemd/system/openclaw-gateway.service
  /etc/systemd/system/openclaw-gateway.service.d/99-integritas-config.conf
  /etc/systemd/system/openclaw-browser.service
  /usr/local/libexec/integritas-browser-start
  /etc/systemd/system/integritas-openclaw-investigation@.service
  /etc/systemd/system/integritas-release-deploy@.service
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

smoke_investigation_runtime() {
  local smoke_dir="/var/lib/integritas-runner/deploy-smoke.$$"
  local plugin_out="${smoke_dir}/parallel-plugin.json"
  local provider_out="${smoke_dir}/provider-models.json"
  local provider_cfg="${smoke_dir}/provider.curlrc"
  install -d -o openclaw -g integritas-openclaw -m 0770 "${smoke_dir}"
  set -a
  # shellcheck disable=SC1091
  . /etc/integritas/provider-secrets.env
  set +a

  # Search readiness is a deterministic capability check. Do not make release
  # admission depend on a model deciding whether to call a tool.
  /usr/sbin/runuser --preserve-environment -u openclaw -- /usr/bin/env \
    HOME=/var/lib/openclaw OPENCLAW_HOME=/var/lib/openclaw OPENCLAW_STATE_DIR=/var/lib/openclaw \
    OPENCLAW_CONFIG_PATH=/etc/openclaw/integritas-investigation.json \
    /opt/openclaw/bin/openclaw plugins inspect parallel --json >"${plugin_out}"
  /usr/bin/python3 - "${plugin_out}" <<'PYPLUGIN'
import json, sys
from pathlib import Path
row = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
plugin = row.get('plugin') if isinstance(row, dict) else None
providers = plugin.get('webSearchProviderIds', []) if isinstance(plugin, dict) else []
if not isinstance(plugin, dict) or plugin.get('status') != 'loaded':
    raise SystemExit('Parallel plugin is not loaded')
if plugin.get('trustedOfficialInstall') is not True:
    raise SystemExit('Parallel plugin is not a trusted official install')
if 'parallel-free' not in providers:
    raise SystemExit('Parallel Free web-search provider is unavailable')
PYPLUGIN

  for plugin in firecrawl exa; do
    plugin_out="${smoke_dir}/${plugin}-plugin.json"
    /usr/sbin/runuser --preserve-environment -u openclaw -- /usr/bin/env \
      HOME=/var/lib/openclaw OPENCLAW_HOME=/var/lib/openclaw OPENCLAW_STATE_DIR=/var/lib/openclaw \
      OPENCLAW_CONFIG_PATH=/etc/openclaw/integritas-investigation.json \
      /opt/openclaw/bin/openclaw plugins inspect "${plugin}" --json >"${plugin_out}"
    /usr/bin/python3 - "${plugin_out}" "${plugin}" <<'PYRESEARCH'
import json, sys
from pathlib import Path
row = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
expected = sys.argv[2]
plugin = row.get('plugin') if isinstance(row, dict) else None
if not isinstance(plugin, dict) or plugin.get('status') != 'loaded':
    raise SystemExit(f'{expected} plugin is not loaded')
if plugin.get('trustedOfficialInstall') is not True:
    raise SystemExit(f'{expected} plugin is not a trusted official install')
providers = set(plugin.get('webSearchProviderIds', []) or [])
if expected == 'firecrawl' and not {'firecrawl', 'firecrawl-free'}.issubset(providers):
    raise SystemExit('Firecrawl web-search providers are unavailable')
if expected == 'exa' and 'exa' not in providers:
    raise SystemExit('Exa web-search provider is unavailable')
PYRESEARCH
  done

  # Release admission verifies authenticated provider capability and the exact
  # configured model deterministically. Do not perform an inference here: model
  # generation latency is a runtime concern and must not make releases flaky.
  # Keep the bearer credential out of process argv by passing it through a
  # root-readable curl config file that is deleted with the smoke workspace.
  /usr/bin/printf 'header = "Authorization: Bearer %s"\n' "${NVIDIA_API_KEY}" >"${provider_cfg}"
  /usr/bin/chmod 0600 "${provider_cfg}"
  /usr/bin/curl --fail --silent --show-error --connect-timeout 10 --max-time 30 \
    --config "${provider_cfg}" \
    https://integrate.api.nvidia.com/v1/models >"${provider_out}"
  /usr/bin/python3 - "${provider_out}" <<'PYPROVIDER'
import json, sys
from pathlib import Path
row = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
models = row.get('data') if isinstance(row, dict) else None
ids = {item.get('id') for item in models if isinstance(item, dict)} if isinstance(models, list) else set()
if 'z-ai/glm-5.3' not in ids:
    raise SystemExit('configured NVIDIA GLM 5.3 model is unavailable')
PYPROVIDER

  rm -rf "${smoke_dir}"
  echo "Integritas deterministic provider/search capability smoke passed."
}

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

for required in \
  infra/openclaw/install-control-worker.sh \
  infra/openclaw/investigation-agent-runner.mjs \
  infra/openclaw/agent-result.mjs \
  infra/openclaw/transaction-checks.mjs \
  infra/openclaw/plan-checks.mjs \
  infra/openclaw/skills/integritas-investigation-v1/SKILL.md \
  infra/openclaw/personal-admin-skills/integritas-operator-orchestrator/SKILL.md \
  infra/openclaw/personal-admin-skills/integritas-research-router/SKILL.md \
  infra/openclaw/personal-admin-skills/integritas-document-verifier/SKILL.md \
  infra/openclaw/personal-admin-skills/integritas-evidence-critic/SKILL.md \
  infra/openclaw/contracts/investigation-bundle-v1.schema.json \
  infra/openclaw/integritas-gateway.json5 \
  infra/openclaw/integritas-investigation.json5 \
  infra/openclaw/integritas-investigation-zen.json5 \
  infra/openclaw/integritas-zen.sh \
  infra/oracle/install-datadog-agent.sh \
  infra/openclaw/integritas-control-worker.service \
  infra/openclaw/openclaw-gateway.service \
  infra/openclaw/openclaw-gateway-integritas.conf \
  infra/openclaw/openclaw-browser.service \
  infra/openclaw/integritas-browser-start.sh \
  infra/openclaw/integritas-openclaw-investigation@.service \
  infra/openclaw/integritas-release-deploy@.service \
  infra/oracle/deploy-integritas-controlled.sh \
  tools/dd/quality_v1.py \
  tools/dd/forensics_v1.py \
  tools/dd/page_extract_v1.py; do
  [[ -f "${NEW}/${required}" ]] || { echo "Release is missing ${required}." >&2; exit 6; }
done

(
  cd "${NEW}"
  /usr/bin/node --test infra/openclaw/control-worker/test/agent-runner-contract.test.mjs
  /usr/bin/node --test infra/openclaw/control-worker/test/transaction-checks.test.mjs
  /usr/bin/python3 -m py_compile tools/dd/quality_v1.py tools/dd/forensics_v1.py
  /usr/bin/python3 tools/dd/test_forensics_v1.py
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
/usr/bin/systemctl restart openclaw-browser.service
/usr/bin/systemctl is-active --quiet openclaw-browser.service
# Keep the job-accepting worker stopped until a real model + external-search turn
# proves the isolated investigation runtime is usable. Any failure triggers the
# existing rollback trap before a new investigation can be leased.
smoke_investigation_runtime
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
