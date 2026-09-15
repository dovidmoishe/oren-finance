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
- Money moves: **propose → prepare → user reviews → user signs**. Never broadcast/sign for the user.
- Prefer extending existing Nest modules under `api/src/` and types under `api/types/`.
- Do not commit secrets (`.env`). Use `api/.env.example` as the template.
- Do not commit `node_modules/`, `dist/`, `target/`, or `.env`.

## Current focus (update as you go)

See **Active phase** at the top of [`docs/api-build-board.md`](docs/api-build-board.md). As of the last sync: **Phase 16 — Vault UI** is active. **Phase 18 — Agent Technical Analysis** and **Phase 19 — Jupiter Limit Orders** are completed (Trigger V1 propose/sign flow; market quotes auto-refresh on expiry).

## App-specific notes

- Next.js rules for `app/` may also appear in [`app/AGENTS.md`](app/AGENTS.md). Follow both: root board + app Next guidance.
