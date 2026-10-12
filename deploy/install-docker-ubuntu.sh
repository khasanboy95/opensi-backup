#!/usr/bin/env bash
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo 'Run this script with sudo on the VPS.' >&2
  exit 1
fi
if command -v docker >/dev/null 2>&1; then
  docker info >/dev/null
  docker compose version
  echo 'Existing Docker installation retained.'
  exit 0
fi
. /etc/os-release
if [[ ${ID:-} != ubuntu || ! ${VERSION_ID:-} =~ ^(22\.04|24\.04|26\.04)$ ]]; then
  echo 'This installer supports Ubuntu 22.04, 24.04 and 26.04 only.' >&2
  exit 1
fi
for package in docker.io docker-compose docker-compose-v2 docker-doc docker-buildx podman-docker containerd runc; do
  if dpkg-query -W -f='${Status}' "$package" 2>/dev/null | grep -q 'install ok installed'; then
    echo "Existing package $package needs review; no packages were removed." >&2
    exit 1
  fi
done
if [[ -e /etc/apt/sources.list.d/docker.sources || -e /etc/apt/keyrings/docker.asc ]]; then
  echo 'Existing Docker repository configuration needs review.' >&2
  exit 1
fi
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl
install -m 0755 -d /etc/apt/keyrings
curl --fail --silent --show-error --location --proto '=https' https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
cat > /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: ${UBUNTU_CODENAME:-$VERSION_CODENAME}
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker
docker info >/dev/null
docker compose version
