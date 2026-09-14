#!/usr/bin/env bash
set -euo pipefail

INSTANCE_ID="${INSTANCE_ID:-${1:-}}"
ACTION="${ACTION:-${2:-status}}"
COMPARTMENT_ID="${COMPARTMENT_ID:-}"

[[ "${INSTANCE_ID}" == ocid1.instance.* ]] || { echo "INSTANCE_ID must be an OCI instance OCID." >&2; exit 2; }
[[ -n "${COMPARTMENT_ID}" ]] || { echo "COMPARTMENT_ID is required." >&2; exit 3; }

case "${ACTION}" in
  status)
    REMOTE='sudo systemctl status openclaw-gateway.service --no-pager'
    ;;
  restart)
    REMOTE='sudo systemctl restart openclaw-gateway.service && sudo systemctl is-active openclaw-gateway.service'
    ;;
  logs)
    REMOTE='sudo journalctl -u openclaw-gateway.service -n 200 --no-pager'
    ;;
  verify)
    REMOTE='sudo systemctl is-active openclaw-gateway.service && sudo -u openclaw /usr/bin/env OPENCLAW_CONFIG_PATH=/etc/openclaw/openclaw.json OPENCLAW_STATE_DIR=/var/lib/openclaw HOME=/var/lib/openclaw /opt/openclaw/bin/openclaw gateway status --deep --require-rpc && sudo -u openclaw /usr/bin/env OPENCLAW_CONFIG_PATH=/etc/openclaw/openclaw.json OPENCLAW_STATE_DIR=/var/lib/openclaw HOME=/var/lib/openclaw /opt/openclaw/bin/openclaw sandbox list --json'
    ;;
  *) echo "Unsupported action: ${ACTION}" >&2; exit 64 ;;
esac

TARGET="$(jq -nc --arg id "${INSTANCE_ID}" '{instanceId:$id}')"
CONTENT="$(jq -nc --arg cmd "${REMOTE}" '{source:{sourceType:"TEXT",text:$cmd},output:{outputType:"TEXT"},commandString:$cmd}')"
COMMAND_ID="$(oci instance-agent command create \
  --compartment-id "${COMPARTMENT_ID}" \
  --content "${CONTENT}" \
  --target "${TARGET}" \
  --timeout-in-seconds 900 \
  --query data.id --raw-output)"

echo "COMMAND_ID=${COMMAND_ID}"
for _ in $(seq 1 90); do
  RESULT="$(oci instance-agent command-execution get \
    --command-id "${COMMAND_ID}" \
    --instance-id "${INSTANCE_ID}" \
    --output json)"
  STATE="$(jq -r '.data["lifecycle-state"]' <<<"${RESULT}")"
  case "${STATE}" in
    SUCCEEDED|FAILED|TIMED_OUT|CANCELED)
      TEXT="$(jq -r '.data.content.text // empty' <<<"${RESULT}")"
      EXIT_CODE="$(jq -r '.data.content["exit-code"] // empty' <<<"${RESULT}")"
      [[ -n "${TEXT}" ]] && printf '%s\n' "${TEXT}"
      echo "STATE=${STATE} EXIT_CODE=${EXIT_CODE:-unknown}"
      [[ "${STATE}" == "SUCCEEDED" ]] || exit 10
      [[ -z "${EXIT_CODE}" || "${EXIT_CODE}" == "0" ]] || exit "${EXIT_CODE}"
      exit 0
      ;;
  esac
  sleep 5
done

echo "Timed out waiting for OCI Run Command ${COMMAND_ID}." >&2
exit 11
