#!/usr/bin/env bash
set -euo pipefail

[[ "${EUID}" -eq 0 ]] || { echo "Run as root." >&2; exit 1; }
. /etc/os-release
case "${ID:-}" in
  ol|rhel|centos) ;;
  *) echo "Expected Oracle Linux/RHEL-compatible host; found ${ID:-unknown}." >&2; exit 2 ;;
esac
case "$(uname -m)" in
  aarch64|arm64) ;;
  *) echo "Expected ARM64/aarch64 Oracle A1 host." >&2; exit 3 ;;
esac

dnf -y install ca-certificates curl git jq dnf-plugins-core tar gzip
if ! dnf repolist --all 2>/dev/null | grep -q '^docker-ce-stable'; then
  dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
fi
dnf -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

install -d -m 0750 /opt/integritas/openclaw /etc/openclaw
install -d -m 0750 /var/lib/openclaw/integritas

cat >/etc/docker/daemon.json <<'JSON'
{
  "log-driver": "json-file",
  "log-opts": {"max-size": "20m", "max-file": "5"},
  "live-restore": true
}
JSON

systemctl enable --now containerd docker
systemctl restart docker

cat >/etc/sysctl.d/99-integritas.conf <<'EOF'
fs.inotify.max_user_watches=524288
fs.inotify.max_user_instances=1024
EOF
sysctl --system >/dev/null

echo "Oracle Linux bootstrap complete: $(uname -m)"
echo "Docker: $(docker --version)"
echo "No inbound application ports or credentials were configured."
