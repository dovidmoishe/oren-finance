# Two heavy accounts and one light account

Do not run this on the host until the commit below has been reviewed and the canary has been run by ops. This tree does not mutate the host.

Ops at 1:34 WAT measured 13 GiB total RAM (the marketed size is about 14 GB; the budget uses 13 GiB), 10 GiB available, 4 logical CPUs, and no swap. Production web and the API returned 200. The software still running there is one heavy cap of 3,840 MiB and one core, with 13 jobs queued on `oren-build` and one job waiting for the missing `oren-light` label.

## Budget

| Slice | MemoryMax | MemoryHigh | CPU | Counted when idle |
| --- | --- | --- | --- | --- |
| `oren-ci-build` active | 3,840 MiB | 3,584 MiB | 100% (1 CPU) | no, 512 MiB |
| `oren-ci-build-2` active | 3,840 MiB | 3,584 MiB | 100% (1 CPU) | no, 512 MiB |
| `oren-ci-release` active | 3,840 MiB | 3,584 MiB | 100% (1 CPU) | yes, 512 MiB |
| `oren-ci-control` | 512 MiB | unchanged | 25% | yes, 512 MiB |
| `oren-ci-light` | 768 MiB | 640 MiB | 25% | yes, 768 MiB |

Admission allows two of the three heavy accounts to be active at once. The third stays at its 512 MiB idle cap. Worst case is `2 × 3840 + 512 + 512 + 768 = 9472` MiB. On a 13,312 MiB host that leaves **3,840 MiB** (3.75 GiB) outside those caps. That is the production and OS reserve. The per-job cap stays 3,840 MiB because a busy build was already measured at 3,584 MiB; this change does not raise it.

`runtimeFreeFloorMiB` is 1,024. Admission refuses a raise when live `MemAvailable` minus the remaining rise of every enforced cap would leave fewer than 1,024 MiB free. The 3,840 MiB reserve is not added a second time on top of `MemAvailable`, because that remainder is already the memory outside the caps. Unreadable memory or an unreadable light state denies the raise.

A second `oren-build` listener on the existing build UID would share `user-<build>.slice` and the 3,840 MiB cap. `oren-ci-build-2` is a separate UID, home, rootless dockerd, and `user-<uid>.slice`. Release keeps its own UID, trusted-job hook, and rootless daemon. The migration does not add `oren-ci-release` to any group and does not let `oren-ci-build-2` run the release provenance check. `oren-ci-build-2` joins `oren-ci-workers` only so it can open the admission socket, the same way `oren-ci-build` already can. It is not added to `docker` or `sudo`. Light stays out of all three.

## Order

`apply` must already be idle. It does not pause a listener while a job is running: a stopped `Runner.Listener` does not reap an exiting `Runner.Worker`, and that zombie keeps a wait from finishing. A live worker, an unreadable cgroup for an account that already exists, or a safety check that exits without a result all refuse before any listener is paused and before any installed file is copied. A never-created account is not a cgroup. After a clean idle reading, listeners are held for the rest of the bootstrap and continued again if a job appears or a later check fails.

`budgets.json` records 13,312 MiB as the planning figure for the marketed 13 GiB host. The script reads live `MemTotal` and refuses when that value leaves less than 3,072 MiB after the 9,472 MiB of caps. A host under 13,312 MiB can still pass when the remainder stays at least 3 GiB. Earlier "no swap" was unused swap, not `SwapTotal=0`. The host may have about 1 GiB of swap allocated. Every CI slice in this migration sets `MemorySwapMax=0`, so that swap is not available to CI.

Rollback stops the build-2 rootless docker service and disables its linger, and it removes slice drop-ins and runner units this migration created. It restores the backed-up admission files. It does not delete the Unix accounts or their home directories; those leftovers are printed and are not left with a running daemon. Release groups are not changed.

Only after that wait does it create `oren-ci-build-2` and `oren-ci-light` if they are missing, write the root-owned `oren-runner-build-2.service` (UMask 0022, the heavy hooks, and `DOCKER_HOST` for the new UID) and the light unit, install rootless Docker for build-2, and restart admission. The light account exists before that restart, so the light socket is opened. Runners are not registered by `apply`.

```bash
bash infra/ci/heavy-pair.sh check
bash infra/ci/heavy-pair.sh apply
```

`stage <dir>` can copy the files outside `/opt/oren-ci`, `/etc/systemd`, and `/home`.

Then register the second build runner. The unit file must already exist; registration does not create it. The token is read from stdin and is not stored. This does not restart admission.

```bash
gh api --method POST repos/dovidmoishe/oren-finance/actions/runners/registration-token --jq .token | bash infra/ci/register-build-2.sh
```

Light registration stays `infra/ci/register-light.sh`. Do not point lint at `oren-light` until that runner is online. Do not treat a 447 MiB child RSS as proof the light slice fits. `infra/ci/light-lane-canary.sh` must run as `oren-ci-light` and it exits before lint if the light permit is refused.

## Rollback

```bash
id=$(id -u oren-ci-build-2)
runuser -u oren-ci-build-2 -- env XDG_RUNTIME_DIR=/run/user/$id DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/$id/bus \
  systemctl --user disable --now oren-runner-build-2.service
bash infra/ci/heavy-pair.sh rollback /root/oren-ci-heavy-pair-backup-<stamp>/manifest.txt
```

Rollback restores the backed-up admission program, budgets, and heavy hooks, and only when the idle check passes. It does not change the release account's groups or delete the release runner. The build-2 home can stay on disk; its runner is stopped. Do not restore an older `job-started.sh` that rejects `oren-ci-build-2` while that runner is still enabled.
