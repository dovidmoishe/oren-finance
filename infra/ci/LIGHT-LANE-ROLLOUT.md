# Light lane and idle downshift

Do not roll out commit `510903a2`. Its drain treated every `Runner.Worker` as the admitted job, so a queued worker could block reclaim while `acquire` waited for that reclaim. It also carried master's old `job-started.sh`, which runs two unbounded `docker info` calls before admission. This document matches the later commit only.

`infra/ci/light-lane.sh apply` does not copy `job-started.sh` or `job-completed.sh`. Those tracked files are the live hotfix bytes. A future `provision.sh` installs those same bytes; do not replace `/opt/oren-ci/bin/job-started.sh` or `job-completed.sh` from an older tree.

## Evidence

| Fact | Value |
| --- | --- |
| Host | 7.25 GiB (7,424 MiB), 2 cores |
| Heavy slice while busy | 3.50 GiB = 564 MiB anon + 2.46 GiB file + 504 MiB kernel/slab |
| Rootless dockerd | 265 MiB current, 230 MiB anon, peak 1.37 GiB |
| Control / release at the same sample | 418 MiB / 261 MiB |
| MemAvailable at 23:34 WAT | 4.4 GiB (host was not in the heavy-build peak) |
| Full `eslint` process | 1,140,269,056 bytes (1,087 MiB), child tree only |
| One file / one directory / 12-file chunk | 432 / 443 / 447 MiB |

1,280 MiB and 1,536 MiB light caps leave about 1.25 GiB and 1.0 GiB and are not used. The full eslint process does not run on the light lane.

## Budgets

| Account | MemoryMax | MemoryHigh | CPU |
| --- | --- | --- | --- |
| Heavy, admitted | 3,840 MiB | 3,584 MiB | 100% |
| Heavy, idle | 512 MiB | 448 MiB | 25% |
| Light, static | 768 MiB | 640 MiB | 25% |
| Control | 512 MiB | unchanged | 25% |

Sum 5,632 MiB. Remainder 1,792 MiB (1.75 GiB). The light hook still refuses to start unless `MemAvailable` is at least 2,816 MiB: 768 + 256 of unused heavy cap + 1,792 reserve. One heavy job at a time. No second heavy admission while a slice is draining or stuck.

Downshift reclaims file pages through the full user slice `memory.reclaim`, in 256 MiB requests. `MemoryHigh` is never set below current usage, and `MemoryMax` stays 3,840 MiB until usage plus 64 MiB fits in 512 MiB. After six tries without a 32 MiB drop, reclaim stops, a stuck diagnostic is written, and the heavy slot stays held. A later drop to the idle floor releases it. Recovery is another bounded `memory.reclaim` on that user slice, not killing dockerd and not starting another heavy job.

## What stays heavy

App test, Next `pnpm run build`, API (including its image build), preview infrastructure, preview image builds, and release image builds. GitHub still FIFO-schedules `oren-build`. There is no priority queue.

## Rollout

Only after this commit is reviewed. As root, from that checkout, with no `Runner.Worker` and both heavy slices inside the idle floor:

```bash
bash infra/ci/light-lane.sh check
bash infra/ci/light-lane.sh apply
```

`apply` records mode, owner, and sha256 for the previous `admission.py` and `budgets.json`, installs the new admission program, budgets, and light hooks by rename, creates `oren-ci-light` if needed, writes the 768 MiB slice and the unstarted unit, and restarts admission only when `check` passes. It does not start the runner, does not touch production Docker, and does not replace the heavy hooks.

```bash
gh api --method POST repos/dovidmoishe/oren-finance/actions/runners/registration-token --jq .token | bash infra/ci/register-light.sh
```

That registers one `oren-vps-light` runner with label `oren-light`. Do not merge until that runner is online; the lint job and the required aggregate check queue on the missing label until then.

Before calling the lane in service: confirm `oren-ci-light` is not in `docker`, `sudo`, or `oren-ci-workers`; the slice is `MemoryMax=768M` and `MemoryHigh=640M`; production and the API return 200; a heavy worker exit reclaims file cache without a cgroup oom-kill of `dockerd`; and a second heavy job stays queued while `memory.current` is still above the idle floor.

## Rollback

```bash
id=$(id -u oren-ci-light)
runuser -u oren-ci-light -- env XDG_RUNTIME_DIR=/run/user/$id DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/$id/bus \
  systemctl --user disable --now oren-runner-light.service
bash infra/ci/light-lane.sh rollback /root/oren-ci-light-backup-<stamp>/manifest.txt
```

Rollback restores only files that were backed up, and only when the idle check passes. Point the lint and aggregate jobs back at `oren-build` in git before removing the runner. Do not restore an older `job-started.sh`.
