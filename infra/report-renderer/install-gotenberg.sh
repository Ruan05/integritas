#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="${INTEGRITAS_REPO_ROOT:-/opt/integritas/current}"
SOURCE_COMPOSE="${REPO_ROOT}/infra/report-renderer/gotenberg-compose.yml"
TARGET_DIR="/opt/integritas-report-renderer"
TARGET_COMPOSE="${TARGET_DIR}/compose.yml"
MIN_FREE_KB=${INTEGRITAS_RENDERER_MIN_FREE_KB:-4194304}

if [[ "$(id -u)" -ne 0 ]]; then
  echo "install-gotenberg.sh must run as root" >&2
  exit 2
fi

if [[ ! -f "${SOURCE_COMPOSE}" ]]; then
  echo "renderer compose file not found: ${SOURCE_COMPOSE}" >&2
  exit 3
fi

free_kb="$(df -Pk / | awk 'NR==2 {print $4}')"
if [[ -z "${free_kb}" || "${free_kb}" -lt "${MIN_FREE_KB}" ]]; then
  echo "refusing renderer install: less than ${MIN_FREE_KB} KiB free on /" >&2
  exit 4
fi

docker compose version >/dev/null
install -d -m 0755 "${TARGET_DIR}"
install -m 0644 "${SOURCE_COMPOSE}" "${TARGET_COMPOSE}"

docker compose -f "${TARGET_COMPOSE}" pull
docker compose -f "${TARGET_COMPOSE}" up -d --remove-orphans

healthy=0
for _ in $(seq 1 40); do
  if curl -fsS --max-time 3 http://127.0.0.1:3000/health >/dev/null; then
    healthy=1
    break
  fi
  sleep 2
done
if [[ "${healthy}" -ne 1 ]]; then
  docker compose -f "${TARGET_COMPOSE}" ps >&2 || true
  echo "Gotenberg failed its localhost health check" >&2
  exit 5
fi

listeners="$(ss -ltnH | awk '$4 ~ /:3000$/ {print $4}')"
if ! grep -qx '127.0.0.1:3000' <<<"${listeners}"; then
  echo "expected localhost Gotenberg listener is missing" >&2
  exit 6
fi
if grep -Eq '^(0\.0\.0\.0|\*|\[::\]):3000$' <<<"${listeners}"; then
  echo "refusing public Gotenberg listener" >&2
  exit 7
fi

echo "Gotenberg healthy at http://127.0.0.1:3000"
df -h /
