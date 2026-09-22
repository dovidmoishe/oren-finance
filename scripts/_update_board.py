from pathlib import Path
import re
from datetime import date

md_path = Path("docs/api-build-board.md")
html_path = Path("docs/api-build-board.html")
md = md_path.read_text(encoding="utf-8")

today = "2026-09-17"

# Update last updated
md = re.sub(r"(\*\*Last updated:\*\*\s*`?)[0-9-]+(`?)", rf"\g<1>{today}\2", md, count=1)

# Mark phase 16 tasks completed
for task_id in [
    "ui-vault-load",
    "ui-vault-list",
    "ui-lock-flow",
    "ui-unlock-flow",
    "ui-vault-safety",
]:
    md = re.sub(
        rf"(\|\s*{re.escape(task_id)}\s*\|[^|]*\|)\s*pending\s*(\|)",
        rf"\1 completed \2",
        md,
    )

# Progress summary 16 vault ui
md = re.sub(
    r"(\|\s*16 · Vault UI\s*\|[^|]*\|)\s*pending\s*(\|\s*)0/5",
    r"\1 completed \g<2>5/5",
    md,
)

# Status notes - add vault UI done bullet if missing
if "16 Vault UI" not in md and "Vault UI" not in md.split("### Done")[1][:2000]:
    pass

done_marker = "### Done"
if "Phase 16 Vault UI" not in md and "**16 Vault UI**" not in md:
    # insert after ### Done section start
    insert = (
        "\n- **16 Vault UI** — Vault page with locked-value summary, positions list, lock ticket, "
        "lock/unlock review modals, and a program-not-live banner; prepare/confirm gated by "
        "`VAULT_PROGRAM_LIVE=false` (`programLive` on GET /vaults, 503 `VAULT_PROGRAM_NOT_LIVE` on mutate).\n"
    )
    # Find a good place near other recent done items
    if "- **19 Jupiter Limit Orders**" in md:
        md = md.replace(
            "- **19 Jupiter Limit Orders**",
            insert.lstrip("\n") + "- **19 Jupiter Limit Orders**",
            1,
        )
    elif "### Done" in md:
        idx = md.find("### Done")
        nl = md.find("\n", idx)
        md = md[: nl + 1] + insert + md[nl + 1 :]

# Next section
md = re.sub(
    r"(\*\*Next\*\*\s*\n\s*\n-\s*\*\*16 Vault UI\*\*[^\n]*)",
    "- **17 Demo Polish** — Responsive/layout polish, loading states, finance-safe copy, and end-to-end demo script.",
    md,
    count=1,
)

# Active phase
md = re.sub(
    r"(\*\*Active phase:\*\*\s*`?)16-vault-ui(`?)",
    r"\g<1>17-demo-polish\2",
    md,
    count=1,
)
md = re.sub(
    r"(\*\*Active phase:\*\*\s*`?)[^`*\n]+(`?)",
    rf"\g<1>17-demo-polish\2",
    md,
    count=1,
)

# Planned next line
if "Vault UI remains" in md:
    md = md.replace(
        "Vault UI remains the app focus.",
        "Vault UI shipped (preview / program not live); Demo Polish is next.",
    )

md_path.write_text(md, encoding="utf-8")
print("markdown updated")

# HTML board
if html_path.exists():
    html = html_path.read_text(encoding="utf-8")
    html = html.replace("16-vault-ui", "17-demo-polish")
    for task_id in [
        "ui-vault-load",
        "ui-vault-list",
        "ui-lock-flow",
        "ui-unlock-flow",
        "ui-vault-safety",
    ]:
        html = re.sub(
            rf'("{re.escape(task_id)}"\s*:\s*")pending(")',
            rf'\1completed\2',
            html,
        )
    if "16 Vault UI" not in html and "Vault UI —" not in html:
        html = html.replace(
            "Next\n• 16 Vault UI",
            "Done\n• 16 Vault UI — preview page + programLive=false gate (prepare/confirm 503)\nNext\n• 17 Demo Polish",
        )
    # notes next line variants
    html = html.replace(
        "• 16 Vault UI — surface locked positions and prepare lock/unlock interactions in the app before final demo polish.",
        "• 16 Vault UI — shipped preview UI with program-not-live banner; signing/prepare gated until VAULT_PROGRAM_LIVE=true.\n• 17 Demo Polish — responsive polish, loading states, finance-safe copy, end-to-end demo script.",
    )
    html = re.sub(r"(Updated:\s*<strong>)[0-9-]+(</strong>)", rf"\g<1>{today}\2", html)
    html_path.write_text(html, encoding="utf-8")
    print("html updated")
else:
    print("html missing")

# show task statuses
for line in md.splitlines():
    if "ui-vault" in line or "ui-lock" in line or "ui-unlock" in line:
        print(line)
