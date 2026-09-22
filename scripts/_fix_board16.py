from pathlib import Path
import re

md = Path("docs/api-build-board.md")
text = md.read_text(encoding="utf-8")
lines = text.splitlines()
for i, line in enumerate(lines):
    if "16-vault-ui" in line and line.startswith("###") and line.rstrip().endswith("pending"):
        lines[i] = line[: -len("pending")] + "completed"
        print("fixed header")

text2 = "\n".join(lines) + ("\n" if text.endswith("\n") else "")
if "program-not-live" not in text2 and "VAULT_PROGRAM_LIVE=false" not in text2:
    lines = text2.splitlines()
    for i, line in enumerate(lines):
        if line.strip().startswith("### Done"):
            lines.insert(
                i + 1,
                "- **16 Vault UI** — Full vault page with program-not-live banner; "
                "API `VAULT_PROGRAM_LIVE=false` gates prepare/confirm and exposes `programLive` on list.",
            )
            text2 = "\n".join(lines) + ("\n" if text.endswith("\n") else "")
            print("added done note")
            break

md.write_text(text2, encoding="utf-8")

html_path = Path("docs/api-build-board.html")
if html_path.exists():
    html = html_path.read_text(encoding="utf-8")
    for tid in [
        "ui-vault-load",
        "ui-vault-list",
        "ui-lock-flow",
        "ui-unlock-flow",
        "ui-vault-safety",
    ]:
        html = re.sub(
            rf'("{re.escape(tid)}"\s*:\s*")pending(")',
            r"\1completed\2",
            html,
        )
    html_path.write_text(html, encoding="utf-8")
    print("html synced")

# verify
for line in md.read_text(encoding="utf-8").splitlines():
    if "16-vault-ui" in line and line.startswith("###"):
        print("header:", line.encode("ascii", "replace").decode())
