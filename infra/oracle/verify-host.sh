#!/usr/bin/env bash
set -euo pipefail

ARCH="$(uname -m)"
MEM_KB="$(awk '/MemTotal/ {print $2}' /proc/meminfo)"
MEM_GB=$(( MEM_KB / 1024 / 1024 ))
ROOT_AVAIL_KB="$(df -Pk / | awk 'NR==2 {print $4}')"
ROOT_AVAIL_GB=$(( ROOT_AVAIL_KB / 1024 / 1024 ))

printf 'Host architecture: %s\n' "${ARCH}"
printf 'Approx memory: %s GiB\n' "${MEM_GB}"
printf 'Root filesystem available: %s GiB\n' "${ROOT_AVAIL_GB}"
printf 'Kernel: %s\n' "$(uname -r)"

case "${ARCH}" in
  aarch64|arm64) ;;
  *)
    echo "WARNING: expected ARM64/aarch64 for an Oracle A1 host; found ${ARCH}." >&2
    ;;
esac

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is not installed." >&2
  exit 2
fi

if ! systemctl is-active docker >/dev/null 2>&1; then
  echo "Docker service is not active." >&2
  exit 3
fi

printf 'Docker: %s\n' "$(docker --version)"
printf 'Compose: %s\n' "$(docker compose version)"
echo "Docker service: active"
echo "Docker socket/container enumeration intentionally skipped for the restricted integritas-control worker."

echo "Listening TCP sockets (review before exposing anything):"
/usr/sbin/ss -ltnp 2>/dev/null || /usr/sbin/ss -ltn

echo "Host verification complete. This script made no changes."
