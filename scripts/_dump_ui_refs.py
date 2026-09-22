from pathlib import Path

q = Path("app/components/trading/quote-review-modal.tsx").read_text(encoding="utf-8")
Path("scripts/_tmp_quote.txt").write_text(q[3500:7600], encoding="utf-8")

a = Path("app/components/agent/agent-artifacts.tsx").read_text(encoding="utf-8")
idx = a.find("case 'vaults'")
Path("scripts/_tmp_artifact.txt").write_text(a[idx : idx + 600], encoding="utf-8")

d = Path("app/components/portfolio/portfolio-dashboard.tsx").read_text(encoding="utf-8")
Path("scripts/_tmp_dash.txt").write_text("\n".join(d.splitlines()[325:355]), encoding="utf-8")

c = Path("app/components/calendar/trading-calendar.tsx").read_text(encoding="utf-8")
lines = []
for i, line in enumerate(c.splitlines(), 1):
    if i < 200 and any(k in line for k in ("useEffect", "loadCalendar", "address", "connected", "useWalletStore", "usePortfolioStore")):
        lines.append(f"{i}:{line}")
Path("scripts/_tmp_cal.txt").write_text("\n".join(lines), encoding="utf-8")

prompt = Path("api/src/agent/agent.prompt.ts").read_text(encoding="utf-8")
Path("scripts/_tmp_prompt.txt").write_text(prompt, encoding="utf-8")
print("ok")
