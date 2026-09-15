#!/usr/bin/env bash
set -euo pipefail

SHAPE='VM.Standard.A1.Flex'
OCPUS=2
MEMORY_GB=12
DISPLAY_NAME='integritas-openclaw-a1'
VCN_NAME='integritas-openclaw-vcn'
SUBNET_NAME='integritas-openclaw-subnet'
IGW_NAME='integritas-openclaw-igw'
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

[[ "${CONFIRM_ZERO_COST:-}" == 'YES' ]] || {
  echo 'Refusing to provision. Set CONFIRM_ZERO_COST=YES only after confirming the tenancy remains Free/Always Free eligible.' >&2
  exit 2
}
command -v oci >/dev/null || { echo 'OCI CLI is required (use authenticated OCI Cloud Shell).' >&2; exit 3; }
command -v jq >/dev/null || { echo 'jq is required.' >&2; exit 4; }

TENANCY_ID="${TENANCY_ID:-$(awk -F= '/^[[:space:]]*tenancy[[:space:]]*=/{gsub(/[[:space:]]/,"",$2); print $2; exit}' ~/.oci/config 2>/dev/null || true)}"
[[ "${TENANCY_ID}" == ocid1.tenancy.* ]] || { echo 'TENANCY_ID could not be discovered; export it and retry.' >&2; exit 5; }
COMPARTMENT_ID="${COMPARTMENT_ID:-${TENANCY_ID}}"

HOME_REGION="$(oci iam region-subscription list --query 'data[?"is-home-region"==`true`]."region-name" | [0]' --raw-output)"
[[ -n "${HOME_REGION}" && "${HOME_REGION}" != 'null' ]] || { echo 'Unable to determine tenancy home region.' >&2; exit 6; }
export OCI_CLI_REGION="${HOME_REGION}"
echo "Using home region: ${HOME_REGION}"

mapfile -t COMPARTMENTS < <(
  { printf '%s\n' "${TENANCY_ID}"; oci iam compartment list \
      --compartment-id "${TENANCY_ID}" --compartment-id-in-subtree true \
      --access-level ACCESSIBLE --lifecycle-state ACTIVE --all \
      --query 'data[].id' --raw-output 2>/dev/null | tr -d '[]",' | tr ' ' '\n'; } | awk 'NF' | sort -u
)

EXISTING_TARGET=''
A1_OTHER=''
for cid in "${COMPARTMENTS[@]}"; do
  INSTANCES="$(oci compute instance list --compartment-id "${cid}" --all --output json 2>/dev/null || true)"
  [[ -n "${INSTANCES}" ]] || continue
  while IFS=$'\t' read -r iid name shape state; do
    [[ -n "${iid}" ]] || continue
    if [[ "${shape}" == "${SHAPE}" && "${state}" != 'TERMINATED' ]]; then
      if [[ "${name}" == "${DISPLAY_NAME}" ]]; then EXISTING_TARGET="${iid}"; else A1_OTHER="${iid}"; fi
    fi
  done < <(jq -r '.data[] | [.id,."display-name",.shape,."lifecycle-state"] | @tsv' <<<"${INSTANCES}")
done

if [[ -n "${EXISTING_TARGET}" ]]; then
  echo "INSTANCE_ID=${EXISTING_TARGET}"
  echo 'Existing Integritas A1 instance found; no new compute was created.'
  exit 0
fi
if [[ -n "${A1_OTHER}" ]]; then
  echo 'ALWAYS_FREE_LIMIT_IN_USE: another non-terminated A1 instance exists; this 2 OCPU/12 GB launch would consume the full current Always Free A1 allowance.' >&2
  exit 7
fi

VCN_JSON="$(oci network vcn list --compartment-id "${COMPARTMENT_ID}" --all --output json)"
VCN_ID="$(jq -r --arg n "${VCN_NAME}" '.data[] | select(."display-name"==$n and ."lifecycle-state"=="AVAILABLE") | .id' <<<"${VCN_JSON}" | head -1)"
if [[ -z "${VCN_ID}" ]]; then
  VCN_CREATE="$(oci network vcn create --compartment-id "${COMPARTMENT_ID}" \
    --cidr-blocks '["10.77.0.0/16"]' --display-name "${VCN_NAME}" --dns-label intgoc \
    --wait-for-state AVAILABLE --output json)"
  VCN_ID="$(jq -r '.data.id' <<<"${VCN_CREATE}")"
else
  VCN_CREATE="$(oci network vcn get --vcn-id "${VCN_ID}" --output json)"
fi

SECURITY_LIST_ID="$(jq -r '.data["default-security-list-id"]' <<<"${VCN_CREATE}")"
ROUTE_TABLE_ID="$(jq -r '.data["default-route-table-id"]' <<<"${VCN_CREATE}")"
oci network security-list update --security-list-id "${SECURITY_LIST_ID}" \
  --egress-security-rules '[{"destination":"0.0.0.0/0","protocol":"all","isStateless":false}]' \
  --ingress-security-rules '[]' --force >/dev/null

IGW_ID="$(oci network internet-gateway list --compartment-id "${COMPARTMENT_ID}" --vcn-id "${VCN_ID}" --all \
  --query "data[?\"display-name\"=='${IGW_NAME}' && \"lifecycle-state\"=='AVAILABLE'].id | [0]" --raw-output)"
if [[ -z "${IGW_ID}" || "${IGW_ID}" == 'null' ]]; then
  IGW_ID="$(oci network internet-gateway create --compartment-id "${COMPARTMENT_ID}" --vcn-id "${VCN_ID}" \
    --is-enabled true --display-name "${IGW_NAME}" --wait-for-state AVAILABLE --query data.id --raw-output)"
fi
oci network route-table update --rt-id "${ROUTE_TABLE_ID}" \
  --route-rules "[{\"cidrBlock\":\"0.0.0.0/0\",\"networkEntityId\":\"${IGW_ID}\"}]" --force >/dev/null

SUBNET_ID="$(oci network subnet list --compartment-id "${COMPARTMENT_ID}" --vcn-id "${VCN_ID}" --all \
  --query "data[?\"display-name\"=='${SUBNET_NAME}' && \"lifecycle-state\"=='AVAILABLE'].id | [0]" --raw-output)"
if [[ -z "${SUBNET_ID}" || "${SUBNET_ID}" == 'null' ]]; then
  SUBNET_ID="$(oci network subnet create --compartment-id "${COMPARTMENT_ID}" --vcn-id "${VCN_ID}" \
    --cidr-block '10.77.1.0/24' --display-name "${SUBNET_NAME}" --dns-label agents \
    --route-table-id "${ROUTE_TABLE_ID}" --security-list-ids "[\"${SECURITY_LIST_ID}\"]" \
    --prohibit-public-ip-on-vnic false --wait-for-state AVAILABLE --query data.id --raw-output)"
fi

IMAGE_ID="$(oci compute image list --compartment-id "${COMPARTMENT_ID}" --operating-system 'Oracle Linux' \
  --shape "${SHAPE}" --sort-by TIMECREATED --sort-order DESC --limit 1 --query 'data[0].id' --raw-output)"
[[ "${IMAGE_ID}" == ocid1.image.* ]] || { echo 'No compatible Oracle Linux ARM image found.' >&2; exit 8; }

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT
USER_DATA="${TMP_DIR}/cloud-init.yaml"
cp "${ROOT_DIR}/infra/oracle/cloud-init-oracle-linux.yaml.tpl" "${USER_DATA}"
encode() { base64 -w0 "$1"; }
sed -i \
  -e "s|__BOOTSTRAP_B64__|$(encode "${ROOT_DIR}/infra/oracle/bootstrap-oracle-linux.sh")|g" \
  -e "s|__INSTALLER_B64__|$(encode "${ROOT_DIR}/infra/openclaw/install-native.sh")|g" \
  -e "s|__CONFIG_B64__|$(encode "${ROOT_DIR}/infra/openclaw/openclaw.json5")|g" \
  -e "s|__SERVICE_B64__|$(encode "${ROOT_DIR}/infra/openclaw/openclaw-gateway.service")|g" \
  "${USER_DATA}"

grep -q '__[A-Z_]*__' "${USER_DATA}" && { echo 'Unresolved cloud-init placeholder.' >&2; exit 9; }

AGENT_CONFIG='{"isMonitoringDisabled":false,"areAllPluginsDisabled":false,"pluginsConfig":[{"name":"Compute Instance Run Command","desiredState":"ENABLED"}]}'
SHAPE_CONFIG="{\"ocpus\":${OCPUS},\"memoryInGBs\":${MEMORY_GB}}"

mapfile -t ADS < <(oci iam availability-domain list --compartment-id "${TENANCY_ID}" --query 'data[].name' --raw-output | tr -d '[]",' | tr ' ' '\n' | awk 'NF')
[[ "${#ADS[@]}" -gt 0 ]] || { echo 'No availability domains found.' >&2; exit 10; }

for ad in "${ADS[@]}"; do
  echo "Trying Always Free A1 capacity in ${ad} (one attempt only)."
  set +e
  LAUNCH="$(oci compute instance launch \
    --availability-domain "${ad}" \
    --compartment-id "${COMPARTMENT_ID}" \
    --shape "${SHAPE}" --shape-config "${SHAPE_CONFIG}" \
    --display-name "${DISPLAY_NAME}" --image-id "${IMAGE_ID}" \
    --subnet-id "${SUBNET_ID}" --assign-public-ip true \
    --user-data-file "${USER_DATA}" --agent-config "${AGENT_CONFIG}" \
    --wait-for-state RUNNING --max-wait-seconds 900 --output json 2>"${TMP_DIR}/launch.err")"
  RC=$?
  set -e
  if [[ "${RC}" -eq 0 ]]; then
    INSTANCE_ID="$(jq -r '.data.id' <<<"${LAUNCH}")"
    echo "INSTANCE_ID=${INSTANCE_ID}"
    echo "COMPARTMENT_ID=${COMPARTMENT_ID}"
    echo "HOME_REGION=${HOME_REGION}"
    exit 0
  fi
  cat "${TMP_DIR}/launch.err" >&2
  if ! grep -Eqi 'Out of host capacity|capacity|TooManyRequests|LimitExceeded' "${TMP_DIR}/launch.err"; then
    echo 'Launch failed for a reason other than free A1 capacity; refusing to retry blindly.' >&2
    exit "${RC}"
  fi
done

echo 'EXTERNAL_CAPACITY_BLOCKED: no verified A1 capacity was available. No paid shape fallback was attempted.' >&2
exit 20
