# Oren documentation

Independent Fumadocs / Next.js app for `https://docs.oren.finance`. Public guides live in `content/docs/`; the repository's existing `../docs/` remains internal engineering documentation.

## Local development

Use Node 22+ and pnpm 11.22.0:

```sh
cd docs-site
pnpm install --frozen-lockfile
pnpm dev
```

Open `http://localhost:3002`; the root redirects straight to the introduction at `/docs`. The site uses the documentation sidebar and search throughout, without a separate marketing landing page. No wallet providers, app secrets or API credentials are required. The docs do not make authenticated product API requests.

```sh
node scripts/validate-content.mjs
pnpm build
pnpm types:check
pnpm start --port 3002
```

The content check verifies document links, navigation and public tool names against `../api/src/mcp-auth/mcp-resource.ts`. Public content documents MCP tools only; internal agent inventories belong in the repository's engineering docs. Build compiles every MDX page and generates the search index, metadata and agent exports. CI also builds the standalone Docker image on Linux.

## Editing

Add MDX under `content/docs/` with `title` and `description` frontmatter. Add it to the folder's `meta.json` navigation. Keep examples consistent with the current API implementation. SDK and public REST pages are explicitly planned; do not invent published package names or stable endpoints.

Use Hugeicons for interface controls. The Webpack alias in `next.config.mjs` maps Fumadocs' built-in icon imports to `components/fumadocs-icons.tsx`, keeping search, navigation, code-copy and theme controls on the same icon set. When upgrading Fumadocs, extend that adapter for any new icon imports. Keep the `--webpack` build/dev flags.

`components/brand/oren-logo.tsx` replicates the web app's component with only its `cn` import adapted to this app. Its companion CSS copies the web logo's styles and reduced-motion rules from `app/app/globals.css`. Preserve the gradient shell, dark face, eye geometry and animation behavior when syncing changes. The favicon at `public/oren-logo.svg` is copied directly from `app/public/oren-mark.svg`. Typography uses self-hosted Instrument Sans Variable.

Search is local to the docs through `/api/search`; no external search service is required. `/llms.txt`, `/llms-full.txt` and `/llms.mdx/docs/<slug>/content.md` provide agent-readable content. The product MCP server remains `https://api.oren.finance/mcp`; this app does not host a trading MCP server.

## Production deployment

The **Deploy documentation** workflow in `.github/workflows/deploy-docs.yml` publishes changes to `docs-site/`, `infra/docs/`, the shared Caddyfile or its own workflow when they reach `master`. PRs run validation only; documentation-only changes do not create application previews. Ordinary docs-only pushes also skip the API/web deployment workflow. Shared Caddy changes retain the normal API/web release behavior.

The production workflow:

1. Validates the content and runs the deployment/rollback tests.
2. Builds the Linux standalone image and tests that actual container: exact release health, introduction redirect, guides, search, Markdown, agent exports and 404 handling.
3. Publishes the tested image as `ghcr.io/<owner>/oren-docs:<full-commit-sha>`.
4. Deploys the image by verified digest to a separate Compose project on the existing VPS.
5. Validates and reloads the shared Caddy configuration, then repeats the checks over `https://docs.oren.finance`.

Failed activation or public checks restore the prior docs image, Compose file and Caddy configuration. A failed first deployment removes its new docs service. Rollback failure is reported with recovery-file locations. The script never starts or stops API, app, database or signing services. Docs activation shares the existing `production-deploy` concurrency group so it cannot reload Caddy during an API/web release. Both workflows use `queue: max` to retain waiting releases rather than replace each other’s pending runs.

### Existing GitHub configuration

The workflow uses the existing `production` environment and these secrets:

- `VPS_HOST`
- `VPS_USER`
- `VPS_SSH_PRIVATE_KEY`
- `VPS_SSH_KNOWN_HOSTS`
- `VPS_PORT` (optional; defaults to 22)

GitHub supplies `GITHUB_TOKEN` for GHCR publication and pulls. No new wallet or provider credentials are required. The VPS must already have Docker Compose, `flock`, the `oren_oren` network and the `oren-caddy-1` container from the production stack.

### DNS and first activation

Point `docs.oren.finance` at the production VPS public IPv4 address. Configure AAAA only if the server serves IPv6. The canonical production Caddyfile now includes the docs host. On first activation, the docs script adds only that host if it is missing from the running configuration; existing API/web routing is preserved. No manual Caddy edit is needed.

Merge the documentation application and workflow together into `master`. Its push run builds, publishes and deploys automatically. If DNS/TLS has not settled when the public checks run, the release fails and restores prior state; rerun after DNS is ready. Local changes are not deployed until committed and merged.

The standalone container is non-root, read-only with temporary cache storage, and has no public host port. It joins `oren_oren` so Caddy resolves `oren-docs:3000`. The runtime health endpoint `/api/health` reports its `DOCS_RELEASE_SHA` with `Cache-Control: no-store`.

### Redeploy and rollback

In GitHub Actions, select **Deploy documentation**, choose **Run workflow** on `master`, and enter a previously published full 40-character commit SHA in `image_tag`. This reuses an existing image rather than rebuilding historical code. The image's revision label is checked, then its digest is pinned before activation.

Current release state is in `/opt/oren/docs/release.env`; the last successful predecessor is in `/opt/oren/docs/previous-release.env`. Both contain only the docs image reference and release SHA. The workflow uses the trusted master commit selected when the run started for deployment tooling, including during rollback. Existing Caddy routing is preserved; only a missing docs host is added.

### Local verification

`node --test infra/docs/*.test.mjs` runs smoke-check and mocked Bash deployment tests from the repository root. On Windows it uses Git Bash; Linux CI uses Bash directly. `bash -n infra/docs/deploy.sh` checks shell syntax. Docker packaging and production HTTPS acceptance run in the deployment workflow.
