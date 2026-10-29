#!/usr/bin/env bash
set -euo pipefail

# Visit counts for the web app from Caddy's access log.
# Usage (on the VPS): /opt/oren/infra/visits.sh [days]   (default 7)
# A page view is a successful GET for a page, not assets, /_next, or prefetches.
# A visitor is a unique IP + user agent per day. Bots are excluded by user agent.
days="${1:-7}"
cd /opt/oren
docker compose --env-file .env --env-file .release.env -f deploy.yml exec -T caddy \
  sh -c 'cat /data/access/site*.log 2>/dev/null' | python3 -c '
import sys, json, re, datetime as dt
days = int(sys.argv[1])
since = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=days)
asset = re.compile(r"\.(js|css|map|png|jpe?g|gif|svg|ico|webp|avif|woff2?|ttf|txt|xml|json)$", re.I)
bot = re.compile(r"bot|crawl|spider|slurp|curl|wget|python|go-http|headless|monitor|uptime", re.I)
views, visitors, paths = {}, {}, {}
for line in sys.stdin:
    try:
        e = json.loads(line)
    except ValueError:
        continue
    t = dt.datetime.fromtimestamp(e.get("ts", 0), dt.timezone.utc)
    r = e.get("request", {})
    h = r.get("headers", {})
    ua = (h.get("User-Agent") or [""])[0]
    uri = r.get("uri", "").split("?")[0]
    if t < since or r.get("method") != "GET" or e.get("status") != 200:
        continue
    if uri.startswith("/_next") or uri.startswith("/api/") or asset.search(uri):
        continue
    if "RSC" in h or "Next-Router-Prefetch" in h or "Purpose" in h or bot.search(ua):
        continue
    day = t.astimezone(dt.timezone(dt.timedelta(hours=1))).date().isoformat()
    views[day] = views.get(day, 0) + 1
    visitors.setdefault(day, set()).add((r.get("client_ip") or r.get("remote_ip"), ua))
    paths[uri] = paths.get(uri, 0) + 1
print(f"Last {days} day(s), dates in WAT (UTC+1)")
print("date".ljust(12) + "visitors".rjust(10) + "page views".rjust(12))
for d in sorted(views):
    print(f"{d:<12}{len(visitors[d]):>10}{views[d]:>12}")
print("total".ljust(12) + f"{sum(len(v) for v in visitors.values()):>10}{sum(views.values()):>12}")
print("\nTop pages:")
for u, n in sorted(paths.items(), key=lambda x: -x[1])[:10]:
    print(f"{n:>6}  {u}")
' "$days"
