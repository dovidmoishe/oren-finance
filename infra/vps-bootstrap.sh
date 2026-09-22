#!/usr/bin/env bash
set -euo pipefail

# Run once on Ubuntu/Debian as root:
#   sudo OREN_DEPLOY_USER=<non-root-ssh-user> bash infra/vps-bootstrap.sh
if [[ "${EUID}" -ne 0 ]]; then
  echo "Run with sudo/root." >&2
  exit 1
fi

DEPLOY_USER="${OREN_DEPLOY_USER:-${SUDO_USER:-}}"
if [[ -z "${DEPLOY_USER}" || "${DEPLOY_USER}" == "root" ]] || ! id "${DEPLOY_USER}" >/dev/null 2>&1; then
  echo "Set OREN_DEPLOY_USER to an existing non-root SSH user." >&2
  exit 1
fi

apt-get update
apt-get install -y ca-certificates curl gnupg ufw
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/"$(. /etc/os-release && echo "${ID}")"/gpg \
  -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
ARCH="$(dpkg --print-architecture)"
CODENAME="$(. /etc/os-release && echo "${VERSION_CODENAME}")"
DISTRO="$(. /etc/os-release && echo "${ID}")"
echo "deb [arch=${ARCH} signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/${DISTRO} ${CODENAME} stable" > /etc/apt/sources.list.d/docker.list
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
usermod -aG docker "${DEPLOY_USER}"
install -d -m 0750 -o "${DEPLOY_USER}" -g "${DEPLOY_USER}" /opt/oren /opt/oren/backups
SSH_PORT="${OREN_SSH_PORT:-22}"
if [[ ! "${SSH_PORT}" =~ ^[0-9]+$ ]] || (( SSH_PORT < 1 || SSH_PORT > 65535 )); then
  echo "OREN_SSH_PORT must be a valid TCP port." >&2
  exit 1
fi
ufw allow "${SSH_PORT}/tcp"
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
echo "VPS ready. Log out and back in as ${DEPLOY_USER} before using Docker."
