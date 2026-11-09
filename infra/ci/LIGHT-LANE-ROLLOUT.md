# Light lane and idle downshift

The host measured at 1:34 WAT is 13 GiB and 4 CPUs. The budget and the second build account are in `HEAVY-PAIR-ROLLOUT.md`. The 7,424 MiB figures below are the previous host, not the profile to install.

Do not roll out commit `510903a2` or `c999eb5b`. `510903a2` treated every `Runner.Worker` as the admitted job, so a queued worker could block reclaim while `acquire` waited. `c999eb5b` asks `memory.reclaim` for `max(0, usage-512MiB)`, so a 487 MiB slice (510,881,792 bytes) writes zero six times and stays stuck. It also starts light work whenever `MemAvailable` is at least 2,816 MiB, which passes while an idle heavy slice can still grow about 3,353 MiB, and its `apply` installs files before it declines the restart. This document matches the later commit only. Do not apply it on the host from this tree until that commit is the one reviewed here.

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
| Light, static | 768 MiB | 768 MiB | 100% |
| Control | 512 MiB | unchanged | 25% |

The light max stays 768 MiB, so the 9,472 MiB cap sum and the 3,072 MiB production floor do not change. A frozen `pnpm install` under a 768 MiB cgroup with swap disabled is killed (peak 806,354,944 bytes). The same command with `--network-concurrency 1 --child-concurrency 1` is also killed at 805,306,368 bytes. Under a 3,840 MiB cap the install finishes and peaks at 2,566,193,152 bytes. The same cap then runs `node scripts/lint-bounded.mjs` to exit 0 with a cgroup peak of 643,956,736 bytes. App lint therefore runs on `oren-build`. The light runner keeps the aggregate check. Worst static CPU quota remains 100+100+25+25+100 = 350% of one CPU on the 4 CPU host.

Sum 5,632 MiB. Remainder 1,792 MiB (1.75 GiB). That remainder is the static cap sum, and it counts only when systemd is actually enforcing every one of those caps at the same time. It is not the light-start gate. Light start and heavy raise call one decision. With neither lease held, each account that can still be admitted contributes its rise from current usage up to 3,840 MiB (from the 512 MiB floor when it is already above that floor). The measured idle host, build 487 MiB and release 254 MiB with about 4.6 GiB available, fails that decision: the larger rise is about 3,586 MiB, and 3,586 + 768 + 1,792 does not fit in 4.6 GiB. A heavy lease already at 3,584 MiB has only about 256 MiB left to climb, and that is the only case where the old 2,816 MiB figure matches the real remainder. One heavy job at a time. No second heavy admission while a slice is draining or stuck.

Downshift reclaims file pages through the full user slice `memory.reclaim`. The request is the bytes above the 448 MiB floor (512 minus the 64 MiB margin), capped at 256 MiB per try. A 487 MiB slice therefore requests about 39 MiB, not zero. `MemoryHigh` is never set below current usage, and `MemoryMax` stays 3,840 MiB until usage plus 64 MiB fits in 512 MiB. After six tries without a 32 MiB drop, reclaim stops, a stuck diagnostic is written, and the heavy slot stays held. A later drop to the idle floor releases it. Recovery is another bounded `memory.reclaim` on that user slice, not killing dockerd and not starting another heavy job. Root can confirm that write on the host later; this tree only checks the byte string.

## What stays heavy

App test, app lint, Next `pnpm run build`, API (including its image build), preview infrastructure, preview image builds, and release image builds. GitHub still FIFO-schedules `oren-build`, and admission still allows two heavy jobs. Lint queues when both heavy slots are taken. There is no priority queue.

## Rollout

Only after this commit is reviewed. As root, from that checkout. `check` fails while any `Runner.Worker` exists, including app lint and control, or while either heavy slice is above the idle floor. Build at 487 MiB fails that floor. `apply` and `rollback` return before creating a backup, copying into `/opt/oren-ci`, writing a unit, or restarting admission. `stage <dir>` may copy the same files to a directory outside `/opt/oren-ci`, `/etc/systemd`, and `/home` while workers are still running. Admission `Restart=always` is why the installed program must not change first: a crash would load the new code beside live workers. A clean start restores a persisted lease file without changing that slice's caps.

```bash
bash infra/ci/light-lane.sh check
bash infra/ci/light-lane.sh apply
```

`apply` records mode, owner, and sha256 for the previous `admission.py` and `budgets.json`, installs the new admission program, budgets, and light hooks by rename, creates `oren-ci-light` if needed, writes the 768 MiB slice and the unstarted unit, and restarts admission only when the safety check passed before those writes. It does not start the runner, does not touch production Docker, and does not replace the heavy hooks.

Moving the aggregate job to `oren-light` removes the wait where that job sat behind a heavy build. On master `c7ace70`, CI run 42525882744 finished its substantive checks at 23:01:49 and the aggregate then waited on the heavy runner until 23:11:34. The production gate 42525882781 had already timed out at 23:06:26, so that release was not deployed. A later master `994bca63` production gate 42531684114 failed on a GitHub fetch status 500 while five CI jobs were queued. Do not rerun or deploy those. A bounded retry for that fetch is a separate change.

```bash
gh api --method POST repos/dovidmoishe/oren-finance/actions/runners/registration-token --jq .token | bash infra/ci/register-light.sh
```

That registers one `oren-vps-light` runner with label `oren-light`. The required aggregate check uses that label. App lint does not.

## Durable light slice

The runtime slice can be 768/100 while `/etc/systemd/system/user-<light-uid>.slice.d/oren-ci.conf` is still `MemoryHigh=640M` and `CPUQuota=25%`. A reboot restores the file. Copy only `infra/ci/light.slice.conf` into that path and reload systemd. Do not run `provision.sh` for this file. It stops runners.

```bash
id=$(id -u oren-ci-light)
install -m 644 infra/ci/light.slice.conf /etc/systemd/system/user-$id.slice.d/oren-ci.conf
systemctl daemon-reload
```

The file is `MemoryHigh=768M`, `MemoryMax=768M`, `MemorySwapMax=0`, `CPUQuota=100%`. Rollback is the previous drop-in: `MemoryHigh=640M`, `MemoryMax=768M`, `MemorySwapMax=0`, `CPUQuota=25%`, then `systemctl daemon-reload`. Do not restart admission for that file alone.

Before calling the lane in service: confirm `oren-ci-light` is not in `docker`, `sudo`, or `oren-ci-workers`; the slice is `MemoryMax=768M` and `MemoryHigh=768M`; production and the API return 200; a heavy worker exit reclaims file cache without a cgroup oom-kill of `dockerd`; and a second heavy job stays queued while `memory.current` is still above the idle floor. `infra/ci/light-lane-canary.sh` samples that full user slice while the chunked lint runs. A 447 MiB child RSS is not a pass and is not an input.

## Rollback

```bash
id=$(id -u oren-ci-light)
runuser -u oren-ci-light -- env XDG_RUNTIME_DIR=/run/user/$id DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/$id/bus \
  systemctl --user disable --now oren-runner-light.service
bash infra/ci/light-lane.sh rollback /root/oren-ci-light-backup-<stamp>/manifest.txt
```

Rollback restores only files that were backed up, and only when the idle check passes. Point the lint and aggregate jobs back at `oren-build` in git before removing the runner. Do not restore an older `job-started.sh`.
