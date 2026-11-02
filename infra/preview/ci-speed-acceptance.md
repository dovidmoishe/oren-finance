# CI and deployment speed acceptance

## Rollout

- Production CI overlap: PR #33; exact-SHA master CI and both image jobs must pass.
- Independent web checks: PR #34; stable aggregate remains required.
- This PR: paired measurement collector and isolated dependency-cache experiment.
- No old PR is modified or reopened. No release cache or web reuse is enabled here.

## Measurements

Run from a machine with authenticated `gh` and Node (read-only API access):

```sh
node infra/preview/ci-speed.mjs --label=baseline --limit=10 --output=infra/preview/ci-speed-baseline.json
node infra/preview/ci-speed.mjs --label=after --since=AFTER_ROLLOUT_UTC --limit=10 --output=infra/preview/ci-speed-after.json
node --test infra/preview/ci-speed.test.mjs
```

Replace `AFTER_ROLLOUT_UTC` with the actual rollout timestamp. Collect at least five
distinct successful preview heads and five distinct production merge SHAs **after
each change** before claiming gains. Keep raw timestamps, IDs, conclusions and
excluded samples; report median and nearest-rank p90 for each cohort, plus failures.
Do not mix old, serial and overlapping production workflows. For isolating the web
split's contribution, collect five previews before merging the next optimization.
Stratify web-changing versus API-only releases and cold versus warm runs.

Preview latency is exact-head CI creation to verified preview status creation.
This is a PR-push timing proxy: GitHub's historical run API does not expose the
original push receipt timestamp. It includes queueing from CI creation, unlike
adding medians from separate stages. Production latency uses actual PR `merged_at`
to completion of the public health step. No-op preview workflows, manual runs,
retries and direct pushes are excluded from comparable latency samples. Their
failures/exclusions remain visible. A superseded preview without successful health
does not become a success sample. Successful later-inactivated previews still count.
The collector examines the most recent 100 deployments and production runs; widen
the API window before drawing conclusions if the cutoff falls outside it.

Post-change acceptance is pending until these future merges and real previews
exist. Unit tests, synthetic reruns and dependency-only benchmarks cannot establish
PR-to-preview or merge-to-healthy speedups.

After merge, `CI speed evidence` automatically saves a 90-day JSON artifact after
preview, production or benchmark completion. It uses trusted workflow code and
read-only permissions. The job summary separates serial/parallel web previews and
serial/overlapped production, and marks cohorts below five samples as pending.
Retain the committed baseline snapshot; the rolling API window is not an archive.

## Web dependency cache experiment

`Benchmark web dependency cache` runs automatically when its workflow changes in a
PR, or manually after merge. It builds only the Dockerfile's `dependencies` target;
it does not publish an image, use production credentials or deploy. Six rounds each
compare an uncached runner with a GHA remote cache in an isolated PR/run + input-hash
scope. Every sample gets a new runner and BuildKit builder. Round 1 seeds a cold
cache; rounds 2-6 provide five warm candidates. No local builder cache survives
between rounds. Save full logs and verify that the pnpm install layer says `CACHED`
before counting a warm hit; a completed cache import alone is not proof of a hit.

Use total image-job duration, including import, export and post-job cleanup, and
report cold/warm medians, p90, failures and pnpm-layer hit count. The collector saves
benchmark job and step durations when the workflow is available. Dependency-target
results establish only dependency caching cost: require five warm **full-image**
comparisons before enabling it for production or previews. Keep the current cache
policy if cache transfer costs erase the install savings. PR-scoped cache writes
are intentionally isolated and cannot populate the production scope.

## Unchanged production web image assessment

Tree-only reuse is unsafe today. `NEXT_PUBLIC_COMMIT_SHA` is passed to every
production build, and Next.js embeds it; the other public build arguments can also
change independently of Git. Preview images embed their environment, PR and SHA
and must never be promoted to production.

Before a separate reuse rollout:

1. Remove the SHA build argument from **production only**, after verifying its only
   UI consumer remains preview-only. Preserve all preview metadata and runtime API
   commit identity.
2. Define a versioned production input fingerprint covering the entire app Git
   tree (including Dockerfile and ignore rules), API URL, Privy app ID, environment,
   resolved base-image digest, architecture and any external build inputs. Pin or
   bound the age of the base image; equal app source does not establish equal build
   inputs when a base tag moves.
3. Persist that fingerprint and web image digest in a successful production health
   record. Old records lacking the fingerprint cannot authorize reuse. Verify
   candidate records came from successful production workflows and are within the
   approved freshness window. A preview record is never eligible.
4. Match every input, verify the source registry digest and retag it for the exact
   new merge SHA; verify the target digest agrees. Missing metadata, mismatches,
   expired candidates or registry errors must fall back to a normal build.
5. Preserve CI for the exact new merge SHA, runtime SHA checks, health, digest
   records and rollback. Record reuse hit/miss reasons. Benchmark five API-only
   merges and changed-web controls before enabling by default.

No web checks are skipped by this work. Conservative path-based CI can be assessed
later; shared contracts/configuration must remain covered.
