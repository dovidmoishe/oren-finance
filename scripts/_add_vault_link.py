from pathlib import Path

p = Path("app/components/portfolio/portfolio-dashboard.tsx")
t = p.read_text(encoding="utf-8")

if "Open Vault" in t:
    print("already has Open Vault")
else:
    marker = 'label="Cash Balance"'
    idx = t.find(marker)
    if idx < 0:
        raise SystemExit("Cash Balance marker missing")
    close = t.find("</div>", idx)
    if close < 0:
        raise SystemExit("grid close missing")
    # close is the metrics grid closing div
    insert = """

      <p className="text-sm text-muted">
        <Link className="font-semibold text-foreground underline-offset-2 hover:underline" href="/vault">
          Open Vault
        </Link>
        {" "}
        to preview locks and unlock eligibility. The onchain program is not live yet, so signing stays disabled.
      </p>"""
    t = t[: close + len("</div>")] + insert + t[close + len("</div>") :]
    p.write_text(t, encoding="utf-8")
    print("inserted vault link")

# Ensure Link import
t = p.read_text(encoding="utf-8")
if "from \"next/link\"" not in t and "from 'next/link'" not in t:
    lines = t.splitlines()
    insert_at = 1
    for i, line in enumerate(lines):
        if line.startswith("\"use client\""):
            insert_at = i + 1
            break
    lines.insert(insert_at, 'import Link from "next/link";')
    p.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("added Link import")
else:
    print("Link import present")

# Verify agent prompt vault section
prompt = Path("api/src/agent/agent.prompt.ts").read_text(encoding="utf-8")
print("prompt has not live", "not live" in prompt.lower())
art = Path("app/components/agent/agent-artifacts.tsx").read_text(encoding="utf-8")
print("artifact has next unlock", "next unlock" in art)
print("artifact has not live", "not live" in art.lower())
