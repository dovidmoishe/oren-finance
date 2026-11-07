#!/usr/bin/env bash
# Install only isolated CI prerequisites/services. Registration is a separate
# stdin-token operation. Never restart or reconfigure production Docker.
set -euo pipefail
[[ $EUID == 0 ]]
SOURCE=$(cd -- "$(dirname -- "$0")" && pwd)
ROOT=/opt/oren-ci
install -d -m 755 "$ROOT" "$ROOT/bin" "$ROOT/downloads" "$ROOT/toolchain"
install -m 755 "$SOURCE/network.sh" "$SOURCE/job-started.sh" "$SOURCE/job-completed.sh" "$ROOT/bin/"
export DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=l
apt-get update -qq
apt-get install -y --no-install-recommends uidmap dbus-user-session slirp4netns fuse-overlayfs curl jq git unzip zip
for account in oren-ci-build oren-ci-control; do
  if ! id "$account" >/dev/null 2>&1; then useradd --create-home --shell /bin/bash "$account"; fi
  # Refuse accidental reuse of a privileged identity.
  [[ " $(id -nG "$account") " != *' docker '* && " $(id -nG "$account") " != *' sudo '* ]]
  chmod 700 "/home/$account"
done
BUILD_ID=$(id -u oren-ci-build)
CONTROL_ID=$(id -u oren-ci-control)

cd "$ROOT/downloads"
RUNNER=actions-runner-linux-x64-2.338.2.tar.gz
if [[ ! -f "$RUNNER" ]]; then curl -fSL --retry 3 "https://github.com/actions/runner/releases/download/v2.338.2/$RUNNER" -o "$RUNNER"; fi
printf 'baebf204307bac6193480852732f0aba2ae97b6c5597c244f4d5558390147c40  %s\n' "$RUNNER" | sha256sum -c -
GH=gh_2.103.3_linux_amd64.tar.gz
if [[ ! -f "$GH" ]]; then curl -fSL --retry 3 "https://github.com/cli/cli/releases/download/v2.103.3/$GH" -o "$GH"; fi
printf '4c806978ffce1cec70853302a56d70ac6da4f19bae7adca4e1a8ab00633dd91d  %s\n' "$GH" | sha256sum -c -
tar -xzf "$GH" -C "$ROOT/toolchain"
install -m 755 "$ROOT/toolchain/gh_2.103.3_linux_amd64/bin/gh" "$ROOT/bin/gh"
NODE=node-v22.23.4-linux-x64.tar.xz
curl -fsSL --retry 3 https://nodejs.org/dist/v22.23.4/SHASUMS256.txt -o node-SHASUMS256.txt
if [[ ! -f "$NODE" ]]; then curl -fSL --retry 3 "https://nodejs.org/dist/v22.23.4/$NODE" -o "$NODE"; fi
grep "  $NODE\$" node-SHASUMS256.txt | sha256sum -c -
if [[ ! -d "$ROOT/toolchain/node-v22.23.4-linux-x64" ]]; then tar -xJf "$NODE" -C "$ROOT/toolchain"; fi

install -d "/etc/systemd/system/user-$BUILD_ID.slice.d" "/etc/systemd/system/user-$CONTROL_ID.slice.d" "/etc/systemd/system/user@$BUILD_ID.service.d"
cat > "/etc/systemd/system/user-$BUILD_ID.slice.d/oren-ci.conf" <<EOF
[Slice]
MemoryAccounting=yes
MemoryHigh=3840M
MemoryMax=4G
MemorySwapMax=0
CPUAccounting=yes
CPUQuota=125%
CPUWeight=25
TasksMax=2048
EOF
cat > "/etc/systemd/system/user-$CONTROL_ID.slice.d/oren-ci.conf" <<EOF
[Slice]
MemoryAccounting=yes
MemoryMax=768M
MemorySwapMax=0
CPUAccounting=yes
CPUQuota=25%
CPUWeight=50
TasksMax=512
EOF
cat > "/etc/systemd/system/user@$BUILD_ID.service.d/oren-ci.conf" <<EOF
[Service]
Delegate=cpu cpuset io memory pids
[Unit]
Requires=oren-ci-network.service
After=oren-ci-network.service
EOF
cat > /etc/systemd/system/oren-ci-network.service <<EOF
[Unit]
Description=Restrict dedicated CI build egress to public services and test loopback
After=ufw.service
[Service]
Type=oneshot
ExecStart=$ROOT/bin/network.sh
RemainAfterExit=yes
[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now oren-ci-network.service
for account in oren-ci-build oren-ci-control; do
  loginctl enable-linger "$account"
  systemctl start "user@$(id -u "$account").service"
done
as_build() { runuser -u oren-ci-build -- env XDG_RUNTIME_DIR="/run/user/$BUILD_ID" DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$BUILD_ID/bus" "$@"; }
as_build dockerd-rootless-setuptool.sh install --force
as_build systemctl --user enable --now docker
as_build env DOCKER_HOST="unix:///run/user/$BUILD_ID/docker.sock" docker info --format '{{.DockerRootDir}} {{.CgroupVersion}} {{.CgroupDriver}}'
for spec in oren-ci-build:build oren-ci-control:control-1 oren-ci-control:control-2; do
  account=${spec%:*}; lane=${spec#*:}; directory="/home/$account/runner-$lane"
  if [[ ! -d "$directory" ]]; then
    install -d -m 750 -o "$account" -g "$account" "$directory"
    tar -xzf "$ROOT/downloads/$RUNNER" -C "$directory"
    chown -R "$account:$account" "$directory"
  fi
  install -d -m 700 -o "$account" -g "$account" "$directory/_work" "$directory/_diag" "/home/$account/.config/systemd/user"
  hooks=''
  if [[ "$lane" == build ]]; then
    hooks="Environment=ACTIONS_RUNNER_HOOK_JOB_STARTED=$ROOT/bin/job-started.sh
Environment=ACTIONS_RUNNER_HOOK_JOB_COMPLETED=$ROOT/bin/job-completed.sh
Environment=DOCKER_HOST=unix:///run/user/$BUILD_ID/docker.sock"
  fi
  cat > "/home/$account/.config/systemd/user/oren-runner-$lane.service" <<EOF
[Unit]
Description=Oren GitHub Actions $lane runner
After=network-online.target
[Service]
WorkingDirectory=$directory
ExecStart=$directory/bin/Runner.Listener run --startuptype service
Restart=always
RestartSec=10
TimeoutStopSec=60
KillMode=control-group
UMask=0077
Environment=PATH=$ROOT/toolchain/node-v22.23.4-linux-x64/bin:$ROOT/bin:/usr/local/bin:/usr/bin:/bin
Environment=RUNNER_TOOL_CACHE=/home/$account/toolcache
$hooks
[Install]
WantedBy=default.target
EOF
  chown root:root "/home/$account/.config/systemd/user/oren-runner-$lane.service"
  chmod 644 "/home/$account/.config/systemd/user/oren-runner-$lane.service"
done
printf 'CI prerequisites ready. Build UID %s; control UID %s. Register each runner with a short-lived token; services remain unstarted.\n' "$BUILD_ID" "$CONTROL_ID"
