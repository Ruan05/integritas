#!/usr/bin/env bash
set -Eeuo pipefail

SHA="${1:-}"
SOURCE_REPO=/home/opc/integritas-e2e-investigation
APPROVED_BRANCH=integritas-command-center-foundation
DEPLOYED_RELEASE=/opt/integritas/deployed-release

[[ "${SHA}" =~ ^[0-9a-f]{40}$ ]] || { echo "Provide one exact lowercase 40-character Git commit SHA." >&2; exit 2; }
[[ -d "${SOURCE_REPO}/.git" ]] || { echo "Approved source repository is unavailable." >&2; exit 3; }
[[ -x /usr/sbin/runuser && -x /usr/bin/git && -x /usr/bin/tar && -x /usr/bin/mktemp ]] || {
  echo "Required deployment tools are unavailable." >&2
  exit 4
}

/usr/sbin/runuser -u opc -- /usr/bin/git -C "${SOURCE_REPO}" fetch --quiet origin   "refs/heads/${APPROVED_BRANCH}:refs/remotes/origin/${APPROVED_BRANCH}"

/usr/sbin/runuser -u opc -- /usr/bin/git -C "${SOURCE_REPO}" cat-file -e "${SHA}^{commit}" 2>/dev/null || {
  echo "Requested release commit is unavailable." >&2
  exit 5
}
REMOTE_HEAD="$(/usr/sbin/runuser -u opc -- /usr/bin/git -C "${SOURCE_REPO}" rev-parse "refs/remotes/origin/${APPROVED_BRANCH}")"
[[ "${SHA}" == "${REMOTE_HEAD}" ]] || {
  echo "Requested release must equal the current approved Integritas feature-branch head." >&2
  exit 6
}

if [[ -f "${DEPLOYED_RELEASE}" ]]; then
  CURRENT_SHA="$(tr -d '\r\n' < "${DEPLOYED_RELEASE}")"
  if [[ "${CURRENT_SHA}" =~ ^[0-9a-f]{40}$ ]]     && /usr/sbin/runuser -u opc -- /usr/bin/git -C "${SOURCE_REPO}" cat-file -e "${CURRENT_SHA}^{commit}" 2>/dev/null; then
    /usr/sbin/runuser -u opc -- /usr/bin/git -C "${SOURCE_REPO}" merge-base --is-ancestor       "${CURRENT_SHA}" "${SHA}" || {
      echo "Automated release deployment refuses a non-fast-forward release." >&2
      exit 7
    }
  fi
fi

TMP_ROOT="$(/usr/bin/mktemp -d /var/tmp/integritas-controlled-deploy.XXXXXX)"
cleanup() {
  rm -rf "${TMP_ROOT}"
}
trap cleanup EXIT
chmod 0700 "${TMP_ROOT}"

/usr/sbin/runuser -u opc -- /usr/bin/git -C "${SOURCE_REPO}" archive "${SHA}"   infra/oracle/deploy-integritas-release.sh | /usr/bin/tar -x -C "${TMP_ROOT}"

DEPLOY_SCRIPT="${TMP_ROOT}/infra/oracle/deploy-integritas-release.sh"
[[ -f "${DEPLOY_SCRIPT}" ]] || { echo "Candidate release is missing the bounded deployment script." >&2; exit 8; }
chown root:root "${DEPLOY_SCRIPT}"
chmod 0700 "${DEPLOY_SCRIPT}"

INTEGRITAS_SOURCE_REPO="${SOURCE_REPO}" /usr/bin/bash "${DEPLOY_SCRIPT}" "${SHA}"
