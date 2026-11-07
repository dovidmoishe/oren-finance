# Oren self-hosted CI

The owner authorized immediate migration on the current two-CPU / 7,424 MiB VPS, then deployment of PR #84 after its checks pass. The future three-CPU / 10 GB profile is retained as a reference; no upgrade is required for the current rollout.

## Execution and resource boundaries

- `oren-vps-build` / `oren-build`: one listener under `oren-ci-build`, rootless Docker, aggregate 4 GiB memory, no swap, 125% CPU quota. The quota covers runner, daemon, builds and service containers through the entire Unix user's systemd slice.
- `oren-vps-control-1` and `oren-vps-control-2` / `oren-control`: separate `oren-ci-control` account, aggregate 768 MiB / 25% CPU quota. They run trusted orchestration, polling gates and SSH deployments, never ordinary PR test/build code.
- Build users have no sudo or production Docker group. Production files and root SSH keys are inaccessible. UID/subuid egress rules reject production private subnets and metadata addresses; loopback test servers and public dependency/registry services remain available.
- Runner executables/configuration are root-owned; only work/log directories and tool caches are writable by the runner. Current official runner 2.338.2 is checksum-pinned with auto-update disabled. Update the pinned release within GitHub's supported update window (normally 30 days after a new release), checking official digests and restarting only idle CI services.
- These are persistent, shared-kernel runners for this private repository's trusted collaborators. They do not provide disposable-VM isolation. Do not make the repository public or admit arbitrary untrusted code without revisiting the runner isolation model.
- Build admission waits for 4.5 GiB available host memory and 15 GiB free disk. Open previews are not stopped. If headroom does not recover, the CI job fails for retry rather than consuming production's reserve. Post-job cleanup removes only containers belonging to the dedicated rootless daemon and the verified CI workspace, preserving image/cache layers.

## Workflow behavior

All thirteen workflows route to the registered self-hosted labels. Every existing test/check and exact-SHA release gate is retained. API tests bind Postgres to a dynamic loopback port and provision roles with `docker exec`, without host networking. Preview fixture files live under runner temp; Compose defaults still point to deployed paths. Isolation-test Compose project names include run/job identifiers.

CI jobs, including the aggregate App check, use the build lane. Otherwise a control gate waiting for CI could block the aggregate needed to finish CI. Two control listeners prevent a single polling gate from blocking all orchestration. Preview and production image builds wait for their exact-SHA CI gate, avoiding speculative duplicate work competing with checks on the one build worker. No optional fallback silently spends hosted runner minutes.

## Installation and validation

`provision.sh` installs official prerequisites, verified Node/GitHub CLI/runner distributions, unprivileged users, rootless Docker, narrow egress rules and bounded user services. It does not disable/restart production Docker, register runners or start financial features. Review the fixed account/path names before installation.

`register.sh` receives a short-lived repository registration token on stdin. It never stores a PAT or the registration token. It configures one build and two control listeners, locks executable files to root ownership and starts only the CI services.

Run `bash infra/ci/validate.sh` on Linux for infrastructure tests and syntax checks. `capacity.mjs` remains a read-only JSON budget assessor; passing its arithmetic is not proof of network or controller enforcement. Validate actual cgroup memory/cpu files, production socket/file denial, private-network denial, real Actions checks and public readiness before declaring cutover complete.

The current server is slower than hosted parallel runners. Five or six PRs queue; newer commits cancel superseded checks per PR. The existing preview admission policy is independent of CI queue capacity. Future capacity upgrades should change only verified CI resource limits and admission thresholds, followed by a one-/two-job trial; do not infer resources from the provider slider or reboot production automatically.

## Recovery

CI services run under the dedicated users' systemd managers. Stop/start them with `systemctl --user` under the corresponding account and XDG runtime directory. The rootless Docker socket is `/run/user/<build-uid>/docker.sock`; never substitute `/var/run/docker.sock`. Inspect `journalctl _UID=<uid>` and runner `_diag` logs. To undo routing, use a reviewed workflow change; do not leave required jobs targeting missing labels. Existing GitHub account billing restrictions may still affect hosted-only features; verify actual self-hosted runs.

Official references: [rootless resource limits](https://docs.docker.com/engine/security/rootless/tips/), [GitHub runner routing](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/use-in-a-workflow), [runner security](https://docs.github.com/en/actions/reference/security/secure-use).
