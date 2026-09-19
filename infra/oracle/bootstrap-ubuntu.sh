#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root (for example: sudo bash infra/oracle/bootstrap-ubuntu.sh)" >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get install -y --no-install-recommends \
  ca-certificates \
  curl \
  git \
  jq \
  gnupg \
  lsb-release \
  unattended-upgrades \
  apt-transport-https

install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg

. /etc/os-release
ARCH="$(dpkg --print-architecture)"
echo \
  "deb [arch=${ARCH} signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
  > /etc/apt/sources.list.d/docker.list

apt-get update
apt-get install -y --no-install-recommends \
  docker-ce \
  docker-ce-cli \
  containerd.io \
  docker-buildx-plugin \
  docker-compose-plugin

systemctl enable --now docker
systemctl enable --now containerd

cat >/etc/docker/daemon.json <<'JSON'
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "20m",
    "max-file": "5"
  },
  "live-restore": true
}
JSON
systemctl restart docker

cat >/etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
systemctl enable --now unattended-upgrades || true

install -d -m 0750 /opt/integritas
install -d -m 0750 /opt/integritas/openclaw
install -d -m 0750 /opt/integritas/runtime

cat >/etc/sysctl.d/99-integritas.conf <<'EOF'
fs.inotify.max_user_watches=524288
fs.inotify.max_user_instances=1024
EOF
sysctl --system >/dev/null

# This script intentionally does NOT:
# - open inbound firewall/application ports
# - configure cloud credentials
# - pull or run an unpinned OpenClaw image
# - create a GitHub self-hosted runner
# - install a local LLM runtime
# - write API keys or other secrets

echo "Bootstrap complete."
echo "Architecture: $(uname -m) / Docker: $(docker --version) / Compose: $(docker compose version)"
echo "Next: verify a pinned linux/arm64 OpenClaw image digest before deployment."
