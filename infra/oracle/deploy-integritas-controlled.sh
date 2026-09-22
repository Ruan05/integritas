#!/usr/bin/env bash
set -Eeuo pipefail

# Single-flight deployment guard: release switching and service restarts must never overlap.
DEPLOY_LOCK=/run/lock/integritas-release-deploy.lock
install -d -m 0755 /run/lock
exec 9>"${DEPLOY_LOCK}"
flock -n 9 || {
  echo "Another Integritas deployment is already running; refusing concurrent release mutation." >&2
  exit 9
}

SHA="${1:-}"
SOURCE_URL=https://github.com/Ruan05/integritas.git
APPROVED_BRANCH=integritas-command-center-foundation
DEPLOYED_RELEASE=/opt/integritas/deployed-release

[[ "${SHA}" =~ ^[0-9a-f]{40}$ ]] || { echo "Provide one exact lowercase 40-character Git commit SHA." >&2; exit 2; }
for required in /usr/bin/git /usr/bin/tar /usr/bin/mktemp /usr/bin/bash; do
  [[ -x "${required}" ]] || { echo "Required deployment tool is unavailable." >&2; exit 3; }
done

TMP_ROOT="$(/usr/bin/mktemp -d /var/tmp/integritas-controlled-deploy.XXXXXX)"
cleanup() {
  rm -rf "${TMP_ROOT}"
}
trap cleanup EXIT
chmod 0700 "${TMP_ROOT}"
SOURCE_REPO="${TMP_ROOT}/source"

/usr/bin/git init --quiet "${SOURCE_REPO}"
/usr/bin/git -C "${SOURCE_REPO}" fetch --quiet --no-tags --depth=512 "${SOURCE_URL}"   "refs/heads/${APPROVED_BRANCH}:refs/remotes/origin/${APPROVED_BRANCH}"

/usr/bin/git -C "${SOURCE_REPO}" cat-file -e "${SHA}^{commit}" 2>/dev/null || {
  echo "Requested release commit is unavailable from the approved repository." >&2
  exit 4
}
REMOTE_HEAD="$(/usr/bin/git -C "${SOURCE_REPO}" rev-parse "refs/remotes/origin/${APPROVED_BRANCH}")"
[[ "${SHA}" == "${REMOTE_HEAD}" ]] || {
  echo "Requested release must equal the current approved Integritas feature-branch head." >&2
  exit 5
}

if [[ -f "${DEPLOYED_RELEASE}" ]]; then
  CURRENT_SHA="$(tr -d '\r\n' < "${DEPLOYED_RELEASE}")"
  if [[ "${CURRENT_SHA}" =~ ^[0-9a-f]{40}$ ]]; then
    /usr/bin/git -C "${SOURCE_REPO}" cat-file -e "${CURRENT_SHA}^{commit}" 2>/dev/null || {
      echo "Current deployed release is outside the bounded branch history; manual reconciliation is required." >&2
      exit 6
    }
    /usr/bin/git -C "${SOURCE_REPO}" merge-base --is-ancestor "${CURRENT_SHA}" "${SHA}" || {
      echo "Automated release deployment refuses a non-fast-forward release." >&2
      exit 7
    }
  else
    echo "Current deployed release attestation is invalid; manual reconciliation is required." >&2
    exit 8
  fi
fi

/usr/bin/git -C "${SOURCE_REPO}" archive "${SHA}" infra/oracle/deploy-integritas-release.sh | /usr/bin/tar -x -C "${TMP_ROOT}"

DEPLOY_SCRIPT="${TMP_ROOT}/infra/oracle/deploy-integritas-release.sh"
[[ -f "${DEPLOY_SCRIPT}" ]] || { echo "Candidate release is missing the bounded deployment script." >&2; exit 9; }
chown root:root "${DEPLOY_SCRIPT}"
chmod 0700 "${DEPLOY_SCRIPT}"

INTEGRITAS_SOURCE_REPO="${SOURCE_REPO}" /usr/bin/bash "${DEPLOY_SCRIPT}" "${SHA}"
