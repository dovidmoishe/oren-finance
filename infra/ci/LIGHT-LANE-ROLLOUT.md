# Light lane and idle downshift

This is the host procedure for the current VPS. Do not run `provision.sh` or `register.sh` for this change. Those scripts restart admission and the existing runners.

## Evidence used for the budgets

| Fact | Value | Source |
| --- | --- | --- |
| Host | 2 cores, 7,424 MiB | existing budget file and the 23:14 WAT audit |
| Heavy active cap | 3,840 MiB max, 3,584 MiB high, 1 core | unchanged; a live build was already near this high watermark |
| Idle dockerd | 235 MiB (191 anon, 29 file, 15 kernel) | 23:18 WAT audit |
| Build peak, not idle RSS | 1.35 GiB historical; an earlier sample saw BuildKit at 1.77 GiB | audit |
| App `pnpm run lint` | 1,140,269,056 bytes (1,087 MiB) process-tree peak | one run on Node 22.23.4 and pnpm 11.22.0, 8 Nov 2026 |
| App aggregate | `test "$RESULT" = success` | workflow source |

512 MiB max / 448 MiB high can hold the measured idle dockerd (235 + 64 MiB margin is below 512). It cannot hold eslint. App lint, app test, Next build, API, preview infrastructure, and image builds stay on `oren-build` or `oren-release`.

The only job moved to `oren-light` is the aggregate App check. Its required check name stays `App test, lint, and build`.

A 768 MiB inactive heavy floor was not adopted. It is not required to protect the measured 235 MiB daemon, and 3,840 + 768 + 512 + 512 = 5,632 MiB is not proof the host can spare that much. The steady idle cap remains 512 MiB. The OOM fix is the order of the shrink: CPU and MemoryHigh drop immediately, MemoryMax stays 3,840 MiB until usage plus 64 MiB is within 512 MiB, and the next heavy job waits until then.

Configured simultaneous maximums:

| Account | MemoryMax | MemoryHigh | CPU |
| --- | --- | --- | --- |
| Heavy, admitted | 3,840 MiB | 3,584 MiB | 100% |
| Heavy, idle | 512 MiB | 448 MiB | 25% |
| Light, static | 512 MiB | 448 MiB | 25% |
| Control, unchanged | 512 MiB | none | 25% |

Sum 5,376 MiB. Against a 7,424 MiB host that leaves 2,048 MiB, which is 512 MiB less reserve than the previous heavy-plus-control sum. That is the cost of the light cap. It is not a measurement that production stays healthy during overlap. The first real overlap still has to be watched.

## What is not solved

GitHub still runs the one `oren-build` label in arrival order. Moving the aggregate off that label does not prioritize preview image builds ahead of API tests or Next builds. No custom queue was added.

App tests were not measured and stay on the heavy lane.

## Rollout

Run from a checkout of the reviewed commit, as root, on the host. The script refuses to restart admission when any `Runner.Worker` exists or either heavy slice's `memory.current` plus 64 MiB exceeds 512 MiB.

```bash
bash infra/ci/light-lane.sh check
bash infra/ci/light-lane.sh apply
```

`apply` backs up the live `admission.py` and `budgets.json` with mode, owner, and sha256, installs the new admission program and the light hooks by rename in place, creates `oren-ci-light` if needed, writes its 512 MiB slice and the unstarted user unit, and restarts admission only when `check` would pass. It does not start the runner and does not touch production Docker.

Registration is separate and needs a short-lived token on stdin. `gh` on the laptop can create that token; none is stored in git.

```bash
gh api --method POST repos/dovidmoishe/oren-finance/actions/runners/registration-token --jq .token | bash infra/ci/register-light.sh
```

`register-light.sh` extracts the already downloaded runner tarball only when its pinned sha256 matches, registers one runner named `oren-vps-light` with label `oren-light`, and starts only that user service.

Before treating the lane as in service, with one heavy job actually running:

- `oren-ci-light` is not in `docker`, `sudo`, or `oren-ci-workers`.
- Its slice files show `MemoryMax=512M`, `MemoryHigh=448M`, `CPUQuota=25%`, `MemorySwapMax=0`.
- The aggregate job is the only workflow job with `oren-light`.
- Production `/` and the API health URL return 200.
- After a heavy worker exits, `memory.current` for that uid falls, `MemoryMax` stays 3,840 MiB until then, and `journalctl -k` shows no new cgroup oom-kill for `dockerd`.
- A second heavy job does not start while the first cgroup is still above the idle floor.

Do not merge the workflow change until `oren-vps-light` is online. Until then the required aggregate check queues for a label with no runner.

## Rollback

Stop and remove only the light runner, then restore the admission backup. The manifest path was printed by `apply`.

```bash
id=$(id -u oren-ci-light)
runuser -u oren-ci-light -- env XDG_RUNTIME_DIR=/run/user/$id DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/$id/bus \
  systemctl --user disable --now oren-runner-light.service
bash infra/ci/light-lane.sh rollback /root/oren-ci-light-backup-<stamp>/manifest.txt
```

Rollback also refuses to restart admission while a worker exists or a heavy cgroup is above the idle floor. Revert the workflow commit in git so the aggregate job returns to `oren-build`; do not leave that job pointed at a removed label. Removing the `oren-ci-light` user is optional and is not done by the script.
