---
name: oren-changelog
description: Create, revise, preview, and prepare publication of Oren changelog entries, including existing release films and screenshots. Use for Oren release notes or changelog publishing; do not automatically generate media or publish unrelated changes.
---

# Oren changelog

The editor is this workflow: versioned JSON content, local visual preview, and the existing Git deployment. There is no admin UI or write API.

## Establish the release

- Read root `AGENTS.md`, both `docs/api-build-board` files, and `app/AGENTS.md`. Inspect the relevant commits and product pages; distinguish deployed work from local work and planned functionality.
- Use the user's intended release date, in Africa/Lagos when deriving “today.” Never turn an entire build-board history into an announcement. Describe what users can actually do; label features still in development.
- Preserve unrelated work. Follow the repository's branch and Conventional Commit rules.

## Author an entry

Create one JSON file under `app/content/changelog/`, named after its permanent slug. Start from the existing token entry. The schema and validation are in `model.mjs` in that directory:

- Required: `slug` (lowercase words separated by hyphens), `date` (`YYYY-MM-DD`), `status` (`draft` or `published`), `title`, `summary`.
- Optional `sections`: objects with `heading` (`Added`, `Improved`, or `Fixed`) and nonempty `items` arrays. Each item is either plain text or `{title, description}` with both fields nonempty plain text; prefer short titled items when they make an update easier to scan. Use each heading at most once.
- Optional `links`: `{label, href}` objects. Links support app paths and HTTPS URLs.
- Optional `screenshots`: `{src, alt, width, height}` objects, using descriptive alternative text and actual pixel dimensions.
- Optional `video`: `{src, poster, label, caption, width, height}`. Use the approved MP4 and poster; explain any depicted functionality that is still in development in visible text.

Write concise product copy, not commit messages. Avoid internal IDs, speculative claims, and arbitrary HTML. Several entries may share a date. Set optional `sequence` to a nonnegative integer, increasing for each new release on that date. The feed sorts by date, then sequence (both newest first); entries without a sequence use zero, with slug order only as a deterministic tie-breaker. Keep a published slug stable so shared links continue working.

## Preview and media

1. Run `pnpm --dir app validate:changelog` and frontend tests. The production build also validates every entry, including drafts.
2. For drafts, set `OREN_CHANGELOG_PREVIEW=1` in the local development server environment. It only works with `NODE_ENV=development`; never use `NEXT_PUBLIC_` for this setting. Restart the server after content edits if necessary. Do not deploy draft preview.
3. Open `/changelog` and `/changelog/<slug>` at desktop and phone widths. Check copy, dates, links, keyboard focus, posters and playback. Entry pages have sharing metadata. Check the normal preview with draft mode off too.
4. Reuse existing reviewed media whenever possible. Do not generate a film merely because an entry supports video. New creative work requires its own user request and appropriate media workflow.
5. Videos remain ignored under `app/public/videos/` locally. Read `infra/VIDEO_ASSETS.md`; update `infra/videos.sha256` for new reviewed assets and use `infra/upload-videos.ps1 -DryRun` before an authorized upload. Use verified deployment credentials; do not invent a host or print secrets. Upload and verify media before deploying references to it, use new filenames for revisions, and retain assets needed by earlier releases. Screenshots can be optimized web images in `app/public/changelog/`.

## Prepare publication

- Change the intended entry to `published`, then run validation, frontend tests, TypeScript, lint, and the production build. Drafts must remain absent from production routes and metadata even if the preview variable is set.
- Refresh Status / Notes and task statuses in both shared build boards. These docs may be ignored and local; always update them without changing their tracking policy.
- Prepare a focused Conventional Commit such as `feat(web): publish token page changelog entry`. Commit only the intended changes. Git history is the revision record; removing an entry from public view means returning it to draft and deploying that change.
- A request to draft or add an entry does not by itself authorize a production push, merge, media upload, or deployment. Follow authorization already supplied in the conversation; when authorized to publish, carry the existing CI/deployment flow through verification.
- After deployment, verify the feed, permalink, canonical and social metadata, feature links, and media HTTP/byte-range responses. Report the live permalink and any unresolved verification limits. If not deployed, report the branch and local preview instead of claiming publication.
