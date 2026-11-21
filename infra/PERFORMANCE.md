# Mobile performance

The web client reports a 10% sample of document Web Vitals (LCP, INP, CLS,
TTFB and FCP), read-request durations, and account-ready time. Set the build-time
`NEXT_PUBLIC_PERFORMANCE_SAMPLE_RATE` to 0 to disable or 1 for a controlled
measurement run. Docker builds accept the same build argument. No backend
service, database migration or third-party analytics account is required.

Batches POST to the Next.js route `/api/telemetry/performance`, which emits
structured `oren.performance` events in the app container logs. Filter those
events in the existing log collector and group by metric name, route, device
and browser; read events also contain a resource category. Web Vitals belong to
the initial document route, while read timings use the current route at
completion. Account-ready includes deferred SDK download and session restore;
it measures readiness for both authenticated and anonymous sessions.

The schema only permits finite numeric values and fixed categories. It
excludes wallet/asset/user IDs, URLs/queries, chat content, credentials, raw
browser strings and persistent visitor identifiers. The client omits cookies,
honors Do Not Track/Global Privacy Control, caps events at 100/document and
batches at eight. The route caps streamed bodies at 4 KiB, rejects unknown
fields and cross-origin browser submissions, and accepts at most 120 batches
per minute per process. It does not retry. The ingress budget is process-local,
so use proxy-wide rate limiting if traffic requires a fleet-wide budget.

For validation, use the same production build, device, network and cache
conditions. Cover Markets opening and scrolling at phone/desktop widths,
stock navigation with delayed analysis/news, chart ranges, wallet switches,
agent opening/closing, and landing scrolling/backgrounding/reduced motion.
Track request counts and long tasks separately from transfer size. A desktop
phone-sized viewport alone does not establish Safari or physical-phone speed.

Display chart responses use a 30-second process-local cache with shared
pending requests, at most 256 results, eight active provider tasks and 64
pending keys. Client mini charts use a separate visibility-gated queue of four
active requests and 128 cache/pending entries. They cancel when the last visible
consumer leaves. These caches do not apply to executable quotes or signing.
