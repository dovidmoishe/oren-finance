#!/usr/bin/env bash
# Install only isolated CI prerequisites/services. Registration is a separate
# stdin-token operation. Never restart or reconfigure production Docker.
set -euo pipefail
[[ $EUID == 0 ]]
SOURCE=$(cd -- "$(dirname -- "$0")" && pwd)
for account in oren-ci-build oren-ci-release oren-ci-control oren-ci-light; do
  if id "$account" >/dev/null 2>&1 && pgrep -u "$(id -u "$account")" -x Runner.Worker >/dev/null; then
    echo "Wait for $account jobs to finish before provisioning" >&2; exit 1
  fi
done
for spec in oren-ci-build:build oren-ci-release:release oren-ci-control:control-1 oren-ci-control:control-2 oren-ci-light:light; do
  account=${spec%:*}; lane=${spec#*:}
  if id "$account" >/dev/null 2>&1; then
    id=$(id -u "$account")
    runuser -u "$account" -- env XDG_RUNTIME_DIR="/run/user/$id" DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$id/bus" systemctl --user disable --now "oren-runner-$lane.service" 2>/dev/null || true
  fi
done
ROOT=/opt/oren-ci
install -d -m 755 "$ROOT" "$ROOT/bin" "$ROOT/downloads" "$ROOT/toolchain"
install -m 755 "$SOURCE/network.sh" "$SOURCE/job-started.sh" "$SOURCE/job-completed.sh" "$ROOT/bin/"
install -m 755 "$SOURCE/control-started.sh" "$SOURCE/light-started.sh" "$SOURCE/light-completed.sh" "$ROOT/bin/"
install -m 644 "$SOURCE/admission.py" "$SOURCE/budgets.json" "$SOURCE/lease-client.py" "$SOURCE/trusted-job.mjs" "$ROOT/bin/"
export DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=l
apt-get update -qq
apt-get install -y --no-install-recommends uidmap dbus-user-session slirp4netns fuse-overlayfs curl jq git unzip zip python3-minimal
getent group oren-ci-workers >/dev/null || groupadd --system oren-ci-workers
for account in oren-ci-build oren-ci-release oren-ci-control oren-ci-light; do
  if ! id "$account" >/dev/null 2>&1; then useradd --create-home --shell /bin/bash "$account"; fi
  # Refuse accidental reuse of a privileged identity.
  [[ " $(id -nG "$account") " != *' docker '* && " $(id -nG "$account") " != *' sudo '* ]]
  chmod 700 "/home/$account"
done
BUILD_ID=$(id -u oren-ci-build)
RELEASE_ID=$(id -u oren-ci-release)
CONTROL_ID=$(id -u oren-ci-control)
LIGHT_ID=$(id -u oren-ci-light)
usermod -a -G oren-ci-workers oren-ci-build
usermod -a -G oren-ci-workers oren-ci-release
install -d -m 750 -o root -g oren-ci-workers /run/oren-ci-build
printf 'd /run/oren-ci-build 0750 root oren-ci-workers -\n' > /etc/tmpfiles.d/oren-ci.conf

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

install -d "/etc/systemd/system/user-$CONTROL_ID.slice.d"
cat > "/etc/systemd/system/user-$CONTROL_ID.slice.d/oren-ci.conf" <<EOF
[Slice]
MemoryAccounting=yes
MemoryMax=512M
MemorySwapMax=0
CPUAccounting=yes
CPUQuota=25%
CPUWeight=50
TasksMax=512
EOF
install -d "/etc/systemd/system/user-$LIGHT_ID.slice.d"
cat > "/etc/systemd/system/user-$LIGHT_ID.slice.d/oren-ci.conf" <<EOF
[Slice]
MemoryAccounting=yes
MemoryHigh=768M
MemoryMax=768M
MemorySwapMax=0
CPUAccounting=yes
CPUQuota=100%
CPUWeight=50
TasksMax=512
EOF
for id in "$BUILD_ID" "$RELEASE_ID"; do
  install -d "/etc/systemd/system/user@$id.service.d" "/etc/systemd/system/user-$id.slice.d"
  cat > "/etc/systemd/system/user-$id.slice.d/oren-ci.conf" <<EOF
[Slice]
MemoryAccounting=yes
MemoryHigh=448M
MemoryMax=512M
MemorySwapMax=0
CPUAccounting=yes
CPUQuota=25%
CPUWeight=25
TasksMax=2048
EOF
  cat > "/etc/systemd/system/user@$id.service.d/oren-ci.conf" <<EOF
[Service]
Delegate=cpu cpuset io memory pids
[Unit]
Requires=oren-ci-network.service
Wants=oren-ci-admission.service
After=oren-ci-network.service oren-ci-admission.service
EOF
done
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
cat > /etc/systemd/system/oren-ci-admission.service <<EOF
[Unit]
Description=Bound and serialize isolated CI builders
After=dbus.service
[Service]
ExecStart=/usr/bin/python3 $ROOT/bin/admission.py
Restart=always
RestartSec=2
MemoryMax=128M
CPUQuota=5%
TasksMax=64
UMask=0077
NoNewPrivileges=yes
ProtectHome=yes
PrivateTmp=yes
[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable oren-ci-network.service
systemctl restart oren-ci-network.service
systemctl enable oren-ci-admission.service
systemctl restart oren-ci-admission.service
for account in oren-ci-build oren-ci-release oren-ci-control oren-ci-light; do
  loginctl enable-linger "$account"
  id=$(id -u "$account")
  if [[ "$account" == oren-ci-build || "$account" == oren-ci-release ]]; then
    systemctl set-property --runtime "user-$id.slice" MemoryMax=3840M MemoryHigh=3584M CPUQuota=100%
  fi
  systemctl restart "user@$id.service"
  if [[ "$account" == oren-ci-build || "$account" == oren-ci-release ]]; then
    systemctl set-property --runtime "user-$id.slice" MemoryMax=512M MemoryHigh=448M CPUQuota=25%
  fi
done
for account in oren-ci-build oren-ci-release; do
  id=$(id -u "$account")
  # Registration/listeners remain stopped during serial daemon bootstrap.
  systemctl set-property --runtime "user-$id.slice" MemoryMax=3840M MemoryHigh=3584M CPUQuota=100%
  runuser -u "$account" -- env XDG_RUNTIME_DIR="/run/user/$id" DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$id/bus" dockerd-rootless-setuptool.sh install --force
  runuser -u "$account" -- env XDG_RUNTIME_DIR="/run/user/$id" DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$id/bus" systemctl --user enable --now docker
  runuser -u "$account" -- env DOCKER_HOST="unix:///run/user/$id/docker.sock" docker info --format '{{.DockerRootDir}} {{.CgroupVersion}} {{.CgroupDriver}}'
  systemctl set-property --runtime "user-$id.slice" MemoryMax=512M MemoryHigh=448M CPUQuota=25%
done
for spec in oren-ci-build:build oren-ci-release:release oren-ci-control:control-1 oren-ci-control:control-2 oren-ci-light:light; do
  account=${spec%:*}; lane=${spec#*:}; directory="/home/$account/runner-$lane"
  if [[ ! -d "$directory" ]]; then
    install -d -m 750 -o "$account" -g "$account" "$directory"
    tar -xzf "$ROOT/downloads/$RUNNER" -C "$directory"
    chown -R "$account:$account" "$directory"
  fi
  install -d -m 700 -o "$account" -g "$account" "$directory/_work" "$directory/_diag" "/home/$account/.config/systemd/user"
  hooks="Environment=ACTIONS_RUNNER_HOOK_JOB_STARTED=$ROOT/bin/control-started.sh"
  mask=0077
  if [[ "$lane" == light ]]; then
    mask=0022
    hooks="Environment=ACTIONS_RUNNER_HOOK_JOB_STARTED=$ROOT/bin/light-started.sh
Environment=ACTIONS_RUNNER_HOOK_JOB_COMPLETED=$ROOT/bin/light-completed.sh"
  elif [[ "$lane" == build || "$lane" == release ]]; then
    id=$(id -u "$account")
    mask=0022
    hooks="Environment=ACTIONS_RUNNER_HOOK_JOB_STARTED=$ROOT/bin/job-started.sh
Environment=ACTIONS_RUNNER_HOOK_JOB_COMPLETED=$ROOT/bin/job-completed.sh
Environment=DOCKER_HOST=unix:///run/user/$id/docker.sock"
  fi
  install -m 755 "$directory/bin/runsvc.sh" "$directory/runsvc.sh"
  printf '%s\n' "$ROOT/toolchain/node-v22.23.4-linux-x64/bin:$ROOT/bin:/usr/local/bin:/usr/bin:/bin" > "$directory/.path"
  cat > "/home/$account/.config/systemd/user/oren-runner-$lane.service" <<EOF
[Unit]
Description=Oren GitHub Actions $lane runner
After=network-online.target
[Service]
WorkingDirectory=$directory
ExecStart=$directory/runsvc.sh
Restart=always
RestartSec=10
TimeoutStopSec=60
KillMode=control-group
UMask=$mask
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
