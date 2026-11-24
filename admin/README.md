# Oren Admin

Independent React + TypeScript + Vite admin app, built on PR #87 (`afc015b`). TanStack Router handles routes and TanStack Query handles server state. The consumer Next.js app is unchanged. The admin uses a plain white/black/gray design with self-hosted Instrument Sans, a reduced overview and a single-column sign-in form.

## Local development

Use Node 22.12+ and the pinned pnpm version.

```powershell
cd admin
pnpm install --frozen-lockfile
# Run the Nest API on port 3001 with DEPLOYMENT_ENV=development.
$env:ADMIN_API_TARGET='http://127.0.0.1:3001'
pnpm dev
```

Open `http://127.0.0.1:3070`. All browser API calls use `/api/admin` on the same origin. The Vite proxy forwards only that prefix. No browser bearer, Privy login, localStorage token, or build-time secret is used. Bootstrap a real local admin with the existing offline command in `infra/growth/operations.md`; there is no default account or public signup.

For the first master to also read reports and operational screens, explicitly add `--permissions reports.read,dashboard.access` to the offline **bootstrap** command. Omitting it preserves #87's management-only master. The flag rejects unknown permissions, creates the account and permission rows in one transaction, and does not apply to recovery. Nothing in this app grants those permissions automatically.

For a **disposable visual fixture**, start these in two terminals:

```powershell
cd admin
node tests/fixture-server.mjs --local-fixture
```

```powershell
cd admin
$env:ADMIN_API_TARGET='http://127.0.0.1:3072'
pnpm dev
```

Fixture sign-in: `admin@example.test` / `local-preview-only`. Both servers bind to loopback. The workspace displays **LOCAL FIXTURE / Sample data**. Invitations, resets and revocations affect only sample memory. The fixture is excluded from the Docker image and is never imported into the app. It does not validate production credentials or execute trades.

## Screens and access

- Overview, traffic chart/daily observations/CSV, activation funnel with grouping, research return windows, campaign comparisons, and data definitions/collection coverage require `reports.read`.
- Connected accounts, OAuth connections/scopes and agent trade intents require `dashboard.access`. Operational tables are paginated at 25 records; search filters the current page. Counts labelled “not revoked” do not establish token expiry. The accounts list contains accounts with MCP connections, not the entire Privy directory. Trade rows are agent intents, not every browser execution or the financial ledger.
- Team invitations, temporary-password replacement, revocation and audit history require an active master admin. Neither `isMaster` nor `dashboard.access` implicitly grants `reports.read`.
- Every admin can change their own password. First-time password replacement gates the workspace. Password changes invalidate sessions and require sign-in again.

## API additions

- `GET /api/admin/auth/session`: restores safe account metadata and a deterministic session-bound CSRF token. No password/session hashes are returned. Earlier sessions with randomly generated CSRF tokens require sign-in again. Tokens remain in memory, session IDs in HttpOnly cookies.
- `GET /api/admin/dashboard/users?page=1`
- `GET /api/admin/dashboard/connections?page=1`
- `GET /api/admin/dashboard/trades?page=1`
- `GET /api/admin/dashboard/audit?page=1` (master only)

These routes require the admin marker header and a live admin cookie. Machine reporting credentials do not authorize operational routes. All admin auth/operational responses use `Cache-Control: no-store`. The operational repository explicitly selects safe fields; it does not return OAuth payloads, signing material or transaction bodies. Existing report authorization remains unchanged.

The UI keeps unknown values separate from zero, gaps separate from observed days, daily uniques separate from lifetime counts, and MCP stock context separate from research activation. Traffic can use UTC or Lagos days; funnel/comparison/retention use UTC. Retention follows accounts for 7 or 30 days after their first research in the selected period. External syncs remain unconnected and historical imports remain offline.

## Checks

```powershell
pnpm test
pnpm build
```

`build` runs TypeScript then produces `dist/`. `.github/workflows/admin.yml` validates admin-only changes independently. API changes remain covered by existing API CI. The existing main web CI may still run for an admin-only PR; consolidating repository-wide path filters belongs to the CI rollout, not this app.

New HTTP authorization/lifecycle coverage lives in `api/src/admin/dashboard/dashboard-access.spec.ts`. It uses an isolated Nest test app. With MCP_TEST_POSTGRES_URL set to the disposable local oren_mcp_test database, admin.integration.spec.ts also exercises migrations, concurrent login, report reads, and daily rollups against PostgreSQL.

## Independent container

```powershell
docker build -t oren-admin:local admin
```

The runtime is static Caddy on port 8080, with `ADMIN_API_UPSTREAM` defaulting to the pinned production API container name `oren-api-1:3000`. Put it on the appropriate API network and publish it through the existing TLS edge on the chosen admin host. The runtime proxies only `/api/admin/*`; other `/api/*` paths return 404. SPA routes fall back to `index.html`; hashed assets are immutable and HTML revalidates. CSP blocks third-party scripts and framing.

There are no automatic deployment changes, DNS changes, production accounts, permission grants, historical imports, or financial actions in this implementation. Production deployment must use the API containing these additions and the two existing #87 migrations (`0025_growth_reporting`, `0026_admin_auth`).
