# AGENTS.md — Oren (project-wide)

This file is the **global agent contract** for the Oren monorepo (`api/`, `app/`, `program/`). Codex, Cursor, and any other coding agent working in this repo **must** follow it.

## Always read first

1. **Build board (source of truth for progress):** [`docs/api-build-board.md`](docs/api-build-board.md)
2. **Visual board (open in browser):** [`docs/api-build-board.html`](docs/api-build-board.html)
3. Product intent: [`prd.md`](prd.md) (local; may be gitignored — use if present)

Do **not** treat the Cursor-only canvas under `~/.cursor/projects/.../canvases/` as the shared source of truth. Prefer the files in `docs/` so every agent sees the same status.

## Mandatory board hygiene

Whenever you finish a meaningful chunk of work (phase task, endpoint, module):

1. Update task statuses in [`docs/api-build-board.md`](docs/api-build-board.md) (`pending` → `in_progress` → `completed`).
2. Mark shipped endpoints in the Endpoints checklist in that file.
3. Refresh the **Status / Notes** section (what landed, what’s next, blockers).
4. Mirror the same status into [`docs/api-build-board.html`](docs/api-build-board.html) so the HTML view stays accurate.
5. If a Cursor canvas exists for this board, update it too when practical — but **never skip the `docs/` files**.

Do not leave completed work marked `pending` on the board.

## Repo layout

| Path | Role |
|------|------|
| `api/` | NestJS backend — portfolio, market, execution, intelligence, (news/agent/vault next) |
| `app/` | Next.js web client |
| `program/` | Anchor timelock / vault program |
| `docs/` | Shared agent docs including the build board |

## Working rules

- Keep Postgres as **app memory only** — Solana is the financial ledger.
- Users think in **stocks**; Oren resolves tokenized variants + Jupiter under the hood.
- Intelligence scores are **deterministic**; LLMs explain, they do not invent indicators.
- Money moves: **propose → prepare → authorize → sign → broadcast**. Authorization is either the user's review and signature for this exact trade, or an explicit, revocable Privy signer grant for bounded quick trades. A delegated trade must be bound to the authenticated user and embedded wallet, allowed asset and route, spend and slippage limits, grant expiry, and an idempotent prepared intent. Enforce these limits server-side immediately before signing; never let an LLM supply a wallet or arbitrary transaction to sign. No signing or broadcast without a valid authorization path.
- Prefer extending existing Nest modules under `api/src/` and types under `api/types/`.
- Do not commit secrets (`.env`). Use `api/.env.example` as the template.
- Do not commit `node_modules/`, `dist/`, `target/`, or `.env`.

## Current focus (update as you go)

See **Active phase** at the top of [`docs/api-build-board.md`](docs/api-build-board.md). As of the last sync: **Phase 16 — Vault UI** is active. **Phase 18 — Agent Technical Analysis** and **Phase 19 — Jupiter Limit Orders** are completed (Trigger V1 propose/sign flow; market quotes auto-refresh on expiry). Growth reporting for this checkout is documented in [`infra/growth/architecture.md`](infra/growth/architecture.md). Root `docs/` stays untracked.

## App-specific notes

- Use Tailwind CSS v4 utilities in JSX for first-party web and docs styling. Reuse Tailwind theme tokens and use responsive, state, and accessibility variants for conditional styles. Do not add CSS Modules, standalone vanilla CSS, or static inline styles. Keep custom CSS in the Tailwind entry points or their imports only when necessary, such as keyframes, browser-specific behavior, and third-party integration overrides. Use inline styles for values computed at runtime when classes cannot represent them.

- Use named icons from `lucide-react` for interface icons across the website, including arrows, controls, status indicators, and social links. Use Lucide React instead of Hugeicons for new or updated interface icons. Sidebar icons use the shared `AnimatedIcons` components with `motion/react`, hover and keyboard-focus feedback, and reduced-motion support. Preserve original brand logos, product illustrations and data charts as their own visuals.

- For release notes and changelog publishing, use [the Oren changelog skill](.agents/skills/oren-changelog/SKILL.md). Entries live in `app/content/changelog/`; films follow the existing separately deployed media workflow.

- For product launch films and motion design in the Oren Drip style, use [the Continuous Product Motion skill](.agents/skills/continuous-product-motion/SKILL.md). It includes camera, UI, pacing, audio and delivery guidance plus a bundled visual benchmark.

- For social graphics and Codex image prompts in the approved Oren style, use [the brand graphics skill](.agents/skills/brand-graphics/SKILL.md). The style guide is [brand.md](.agents/skills/brand-graphics/brand.md), with the approved example beside it.

- Next.js rules for `app/` may also appear in [`app/AGENTS.md`](app/AGENTS.md). Follow both: root board + app Next guidance.
