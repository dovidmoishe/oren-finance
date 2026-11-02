# Oren PR previews

Trusted collaborator PRs targeting `master` receive `https://pr-N.preview.oren.finance` after CI succeeds. Each has a separate app, API, database, volume, network and MCP OAuth issuer keys. Research uses live providers and the shared Privy app; financial execution and background processing are disabled. Production still deploys after successful push CI on `master`.

## First installation

1. Merge the reviewed infrastructure bootstrap PR using the existing merge process. The privileged preview workflows must exist on `master` before they can handle PRs. Do not enable required preview checks yet.
2. On the VPS, verify Docker Compose v2, `jq`, `flock`, `curl` and `openssl` are installed. Create `/opt/oren/preview` owned by the existing non-root deployment user if that user cannot create it. Keep the same production Compose project/container names (`oren`, `oren-caddy-1`).
3. Add wildcard DNS `*.preview.oren.finance` pointing at the existing VPS. Keep HTTPS ports reachable. Caddy obtains individual hostname certificates; no wildcard certificate or DNS API secret is needed. A burst of new PRs can encounter CA issuance limits; retry later rather than weaken TLS.
4. Use the existing production Privy application, as agreed for this deployment. Add `https://*.preview.oren.finance` to its Web & mobile web allowed origins while keeping production entries. Privy users and wallets are shared across environments; preview app-memory databases remain separate. A separate Privy application is optional if independent test users are desired later.
5. In GitHub's existing **Preview** environment, add variable `PREVIEW_PRIVY_APP_ID` with that app's public ID and `PREVIEW_DOMAIN=preview.oren.finance`. Make the existing `VPS_HOST`, `VPS_USER`, `VPS_SSH_PRIVATE_KEY`, `VPS_SSH_KNOWN_HOSTS` and optional `VPS_PORT` secrets available there. Set deployment branches to the selected branch **master only**. Every preview workflow runs trusted orchestration from master; PR builds get no SSH, provider or admin secrets.
6. Run **Preview setup → install-controller**, using `master`. It installs `/opt/oren/preview/control`, starts the access gateway, and generates credentials without printing them. Controller updates are explicit through this same workflow, never copied from a PR. Existing configuration survives reinstalls.
7. Edit `/opt/oren/preview/provider.env` on the VPS. Populate `TOKENS_API_KEY`, `ALCHEMY_API_KEY`, `PRIVY_APP_ID`, `PRIVY_APP_SECRET` and `OPENAI_API_KEY` from the existing production provider configuration; Jupiter and Titan may reuse their existing settings too. Copy only provider variables. The Privy app ID must match the GitHub build variable; unquoted, single-quoted and double-quoted values are supported. Keep this file mode `600`; never copy production `.env` wholesale or commit credentials.
8. Add one hostname per line to `/opt/oren/preview/privy-origins`, **after** registering its HTTPS origin in Privy. If wildcard support was verified and configured, a literal `*.preview.oren.finance` line permits automatic PR creation. This file is an operator attestation, not a Privy API client; deployment fails closed when an origin is absent.
9. Retrieve the generated tester password privately from `/opt/oren/preview/tester-password` (mode `600`) and share it through the team's normal private channel. `/opt/oren/preview/access.env` contains its scrypt hash, session-signing key and preview domain. No password belongs in a URL or GitHub variable.
10. Ensure the current production deployment has the preview-sites bind mount and shared access network from this branch. The normal production workflow creates those prerequisites. Preview apps/API share only their own edge network with Caddy; the access service has a separate network. No app receives a Docker socket or production network attachment.

Production and previews share provider quotas and billing when using these credentials. Container caps do not limit provider spend. Separate keys and budgets remain an optional later isolation improvement.

## Tester workflow and acceptance

Open a PR from a repository collaborator's branch. CI builds/tests the final code; the preview workflow separately builds the exact PR head with preview configuration. `Preview ready` links to the environment. Draft PRs work. Forks/bot-authored PRs have no automatic credentialled preview; move reviewed changes to a collaborator-owned repository branch.

Enter the preview password, then sign in to Oren normally. The gateway cookie is secure, host-only, signed and valid for eight hours. It leaves `Authorization: Bearer ...` intact. The banner identifies the PR/commit; financial actions are disabled. `Lock preview` clears access on this browser. Separate PR origins require separate password entry.

MCP discovery, OAuth consent and browser prepare flows use the same preview origin behind the password gateway. The trusted controller creates `stacks/pr-N/oauth.env` (mode 600) with unique OAuth keys on first deployment and keeps it across updates; stop/reset removes it with that preview. The preview issuer is `https://pr-N.preview.oren.finance/oauth`. External agent servers cannot use the password-protected MCP resource without a gateway session, so test its OAuth/prepare flow with a controlled client carrying that session. Browser review may display a quote, but signing and broadcast are blocked by the preview execution gate. Do not put production MCP OAuth keys in `provider.env`.

Before enabling merge protection, verify **two distinct PRs** concurrently:

- Both URLs show the correct commit/banner; create a conversation in one and confirm it is absent from the other. Production remains unchanged.
- Password rejection, expiry/logout, Oren email login, wallet linking, portfolio reads, market research and streaming agent responses work. Test desktop and phone widths.
- Direct prepare/approve/sign/broadcast/confirm/cancel requests return `403` with `code: PREVIEW_EXECUTION_DISABLED`; no real transaction is signed or submitted. Relevant UI controls are disabled.
- The MCP and OAuth discovery paths require the preview gateway cookie. With a cookie they advertise the PR-specific issuer and resource. Reusing an OAuth token from another PR fails its audience and grant checks.
- Push a new commit while an earlier build is running. Only the latest successful commit becomes ready. Preserve preview account/conversation data across a compatible migration.
- A failed migration makes the preview unavailable, never silently resets its database, and never changes production. A failed new build does not claim readiness for the new SHA.
- Close a PR; its route, containers and database disappear. Verify reconciliation handles a missed close event and seven-day expiry. Recreate an expired preview via manual redeploy.

GitHub approval represents tester signoff. Updating the PR dismisses stale approvals, and the branch must be up to date with master. This checks the PR head against current master; production still reruns CI/build for the actual merged commit.

## Maintenance and recovery

- **Redeploy:** Run **PR preview** on `master`, input PR number. The latest head must already have passing PR CI. The controller verifies its SHA and open state before changing containers, before routing and before recording success.
- **Stop:** Run **Preview maintenance → stop**, input PR number. Deletes only that preview's app-memory database and containers. Closing a PR does this automatically.
- **Reset:** Run **Preview maintenance → reset**, input PR number and `RESET-pr-N`. This explicitly destroys that preview database; then redeploy. Wrong confirmation does not remove routing or data.
- **Reconcile:** Runs hourly and can be dispatched manually. Open previews expire seven days after their last successful deployment. Failed allocations also expire; a redeploy refreshes lifetime only after success. Preview expiry invalidates readiness for the current commit.
- **Capacity:** Maximum three allocations, including failed stacks awaiting cleanup. New allocations need at least 3 GiB available RAM and 15 GiB disk. Existing updates need no extra slot. Apps are capped at 512 MiB/0.5 CPU, APIs at 1 GiB/1 CPU and databases at 512 MiB/0.5 CPU. Stop an unused preview and retry rather than evicting testers. Check production load before the first rollout; these are shared-host limits, not a dedicated production resource reservation.
- **Migration failure:** Inspect the failed Actions run and exact stack logs; fix the migration and redeploy, or explicitly reset disposable preview data. Returning to an older image does not reverse database migrations.
- **Logs:** `docker compose --project-name oren-pr-N --env-file /opt/oren/preview/stacks/pr-N/release.env -f /opt/oren/preview/control/compose.yml logs --tail 100 api app`. Logs rotate at 10 MiB with three files per service. Avoid printing environment files or cookies.
- **Password rotation:** Use `node /service/access.mjs hash` in the access-service image with the new password on stdin, update the hash and session key in `access.env`, then recreate the gateway with `docker compose -f /opt/oren/preview/control/access.compose.yml up -d --force-recreate`. Rotating the signing key invalidates existing cookies.
- **Images:** Stack cleanup never runs global Docker pruning. Old image tags are deliberately retained; inspect unused `pr-N-<sha>` images and remove only selected preview images during maintenance. Keep production release images for rollback. GHCR retention is a separate operator policy.
- **New preview media:** Mount a dedicated directory only for the affected PR through reviewed controller changes. Never modify `/opt/oren/media/videos` from a preview.

The host controller globally serializes container/routing changes, including cleanup; the workflow also serializes deployments per PR. Temporary database downtime during updates is intentional. The latest public status and workflow logs distinguish failed builds, missing origin configuration, capacity failures and migration errors.

## Enable merge protection

After both previews pass tester acceptance, run **Preview setup → enable-merge-protection** on master with `ACCEPTED-preview-login-and-research`. It requires two distinct currently successful preview deployments. Add a repository-scoped fine-grained `PREVIEW_ADMIN_TOKEN` secret in the Preview environment with Administration write, Contents read and Deployments read; only the setup step uses it. Alternatively apply equivalent rules manually using an admin account.

The setup refuses to overwrite existing branch protection. It requires `API test and build`, `App test, lint, and build`, `Preview infrastructure tests`, and `Preview ready`, an up-to-date branch and one approving review; stale approvals are dismissed and admins follow the rules too. Do not enable it while bootstrap/acceptance is incomplete. Keep fork PRs blocked until reviewed changes are moved to a trusted branch.

## Production release records

Successful production deployment plus public HTTPS homepage/readiness checks creates `prod-YYYYMMDD-<run-id>` with generated notes, source SHA, **running containers' repository image digests**, migration source link and workflow link. A failed deploy/smoke creates no successful release; publication failures can be retried without duplicating a release. The run's creation date makes rerun tags stable across midnight.

Manual production deployments accept a full Git SHA and load its matching deployment configuration. They reuse existing images and are labelled “Manual deployment / rollback” in the new record. Database migrations are not automatically reversed. Rollback to a commit predating preview routing can remove preview connectivity; restore the current reviewed Caddy/Compose routing configuration afterward. No permanent staging branch or semantic-version automation is introduced.

## Image build speed rollout

Production starts on the same `master` push as CI. The existing API/web image jobs and
the exact-SHA CI gate run concurrently; deployment requires the gate and both image
jobs to succeed. Failed, cancelled, missing or timed-out CI never authorizes deployment.
The gate only accepts the newest `ci.yml` push run from this repository on `master`
for the release SHA, and waits at most 30 minutes. CI reruns do not implicitly redeploy:
after a failed gate, rerun the production workflow once CI succeeds.

Manual deployment/rollback still uses existing images for the selected full SHA and
its matching deployment configuration. It must run from `master` and now requires
successful master CI for that selected SHA too. Public readiness, environment/SHA,
media checksum verification and running-image digest release records remain required.

Production and preview API/web images build in parallel. The production web build runs without the previous large GitHub Actions cache; previews remain uncached. Keep the exact SHA tags and the existing CI, deployment and health gates.

Baseline image-job times from 2026-11-01: production runs 41284434443, 41281655445 and 41280080809 took about 4m31s, 4m25s and 5m06s; preview run 41228180240 took about 3m21s. Compare at least two new production image jobs and two warm preview image jobs using their Actions start/end timestamps. A preview cache experiment should use a separate scope per PR and service; keep it only if its warm total job time beats the uncached preview baseline. Likewise, restore a production web cache only if total image-job time improves. Do not judge a cache by the `next build` line alone: include layer import, export and builder cleanup.

API image reuse is implemented but off by default. After the timing comparison, set repository Actions variable `API_IMAGE_REUSE_ENABLED=true` to enable it. A recent successful production release or same-PR preview deployment must record an API digest, be no older than seven days, and have the same `api/` Git tree as the target commit. The workflow copies that image by digest to the new exact-SHA tag; missing records, API changes or registry failures trigger a normal build. Preview success records the API digest for later runs. The web image always rebuilds because its public preview banner embeds PR/commit metadata. The API reads the new commit SHA from deployment environment variables, including when its image is reused.

## Verification commands

```sh
node --test infra/preview/*.test.mjs
for script in infra/preview/*.sh; do bash -n "$script"; done
cd api && pnpm test --runInBand && pnpm build
cd ../app && pnpm test && pnpm exec tsc --noEmit && pnpm lint && pnpm build
```

CI also validates preview Compose configuration on Linux with Docker Compose v2. Live DNS/TLS, Privy login, actual two-stack operation and human acceptance remain rollout checks; local unit tests do not establish those outcomes.
