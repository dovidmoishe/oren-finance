from pathlib import Path
import re

# --- Portfolio dashboard: add Vault link caption ---
dash_path = Path("app/components/portfolio/portfolio-dashboard.tsx")
dash = dash_path.read_text(encoding="utf-8")

if 'href="/vault"' not in dash and "href='/vault'" not in dash:
    if 'from "next/link"' not in dash and "from 'next/link'" not in dash:
        # insert after first import block client
        lines = dash.splitlines()
        insert_at = 0
        for i, line in enumerate(lines):
            if line.startswith("import "):
                insert_at = i + 1
        lines.insert(insert_at, 'import Link from "next/link";')
        dash = "\n".join(lines) + ("\n" if dash.endswith("\n") else "")

    # Replace locked metric detail with linked caption if still plain text
    if "open Vault to manage" in dash:
        # already updated caption text; wrap metric section with a note below the grid
        marker = 'label="Locked Positions"'
        if marker in dash and "View Vault" not in dash:
            # add a small note after the metrics grid closing - find Locked Positions block end
            dash = dash.replace(
                'detail="Timelocked holdings · open Vault to manage (program not live yet)"',
                'detail="Timelocked holdings"',
                1,
            )
            # After the three DetailMetric grid, inject a vault link line
            needle = 'label="Cash Balance"'
            idx = dash.find(needle)
            if idx != -1:
                # find closing of that DetailMetric / grid
                close_grid = dash.find("</div>", dash.find("Cash Balance"))
                # better: after metrics grid
                pass
            # Simpler: change detail to include markdown-ish text and add Link under locked value via detail JSX
            # Replace the Locked Positions DetailMetric entirely with one that has a link detail
            pattern = re.compile(
                r'(<DetailMetric[\s\S]*?label="Locked Positions"[\s\S]*?value=\{formatCurrency\(portfolio\?\.(?:lockedValueUsd|lockedValueUsd)\}\)\s*}/>)',
                re.M,
            )
            m = pattern.search(dash)
            if m:
                replacement = '''<div className="space-y-2">
          <DetailMetric
            change={portfolio?.changePct}
            className="bg-accent-pink"
            detail="Timelocked holdings"
            label="Locked Positions"
            value={formatCurrency(portfolio?.lockedValueUsd)}
          />
          <p className="px-1 text-xs text-muted">
            <Link className="font-semibold text-foreground underline-offset-2 hover:underline" href="/vault">
              Open Vault
            </Link>
            {" "}
            to preview locks. Onchain program is not live yet, so signing is disabled.
          </p>
        </div>'''
                # Try lockedValueUsd variants
                for field in ("lockedValueUsd", "lockedValueUsd"):
                    old = m.group(1)
                    if field in old or True:
                        # rebuild with detected field
                        field_used = "lockedValueUsd" if "lockedValueUsd" in dash else "lockedValueUsd"
                        replacement = replacement.replace("lockedValueUsd", field_used)
                        # detect changePct vs changePct
                        change_field = "changePct" if "changePct" in dash else "changePct"
                        replacement = replacement.replace("changePct", change_field)
                        # DetailMetric vs DetailMetric
                        if "DetailMetric" in dash:
                            replacement = replacement.replace("DetailMetric", "DetailMetric")
                        dash = dash[: m.start()] + replacement + dash[m.end() :]
                        break
                print("replaced locked metric with linked caption")
            else:
                print("Locked Positions DetailMetric not matched")
                for i, line in enumerate(dash.splitlines(), 1):
                    if "Locked" in line:
                        print(i, line.strip())
    dash_path.write_text(dash, encoding="utf-8")
else:
    print("vault link already present")

# --- Agent prompt ---
prompt_path = Path("api/src/agent/agent.prompt.ts")
prompt = prompt_path.read_text(encoding="utf-8")
if "Vault program" not in prompt and "vault program" not in prompt.lower():
    addition = """

Vault:
- Users can ask about locked positions and upcoming unlocks. Call getVaults for indexed vault state.
- The onchain vault program is not live yet. Do not claim a lock or unlock can be created, signed, or withdrawn.
- If the user asks to lock or unlock assets, explain that Vault UI is available as a preview at /vault, and that signing stays disabled until the program is deployed.
- Never prepare vault transactions. Money-moving vault actions stay user-reviewed later when the program is live.
"""
    # insert before closing trim
    if prompt.rstrip().endswith("`;") or prompt.rstrip().endswith(".trim();"):
        # find last Limit orders section end
        if "Limit orders:" in prompt:
            prompt = prompt.rstrip()
            if prompt.endswith(".trim();"):
                # content is in `...`.trim();
                core = prompt[: prompt.rfind("`")]
                # find closing backtick of template
                # structure: export const X = `...`.trim();
                start = prompt.find("`")
                end = prompt.rfind("`.trim()")
                body = prompt[start + 1 : end]
                body = body.rstrip() + addition
                prompt = prompt[: start + 1] + body + prompt[end:]
            else:
                prompt = prompt + addition
        else:
            prompt = prompt.replace(
                "Keep answers concise, grounded, and useful for a consumer investing product.",
                "Keep answers concise, grounded, and useful for a consumer investing product." + addition,
                1,
            )
    else:
        prompt = prompt.replace(
            "Keep answers concise, grounded, and useful for a consumer investing product.",
            "Keep answers concise, grounded, and useful for a consumer investing product." + addition,
            1,
        )
    prompt_path.write_text(prompt, encoding="utf-8")
    print("updated agent prompt")
else:
    print("agent prompt already mentions vault program")

# --- Agent artifacts richer vaults card ---
art_path = Path("app/components/agent/agent-artifacts.tsx")
art = art_path.read_text(encoding="utf-8")
if "next unlock" not in art.lower() and "case 'vaults'" in art:
    old = """    case 'vaults':
      return (
        <ArtifactShell icon={SafeIcon} label="Vault" tone="lavender">
          <p className="font-display text-2xl font-semibold">{formatCurrency(artifact.data.totalLockedValueUsd)}</p>
          <p className="mt-1 text-xs text-muted">{artifact.data.positions.length} locked position{artifact.data.positions.length === 1 ? '' : 's'}</p>
        </ArtifactShell>
      );"""
    # try alternate naming
    alts = [
        old,
        old.replace("ArtifactShell", "ArtifactShell").replace("SafeIcon", "SafeIcon"),
        old.replace("tone=\"lavender\"", "tone=\"lavender\""),
    ]
    # find actual block
    idx = art.find("case 'vaults'")
    chunk = art[idx : idx + 500]
    print("vault artifact chunk:\n", chunk)
    # Build replacement from actual shell component name
    shell = "ArtifactShell" if "ArtifactShell" in chunk else "ArtifactShell"
    icon = "SafeIcon" if "SafeIcon" in chunk else "SafeIcon"
    new = f"""    case 'vaults': {{
      const nextUnlock = [...artifact.data.positions].sort(
        (a, b) => new Date(a.unlockAt).getTime() - new Date(b.unlockAt).getTime(),
      )[0];
      return (
        <{shell} icon={{{icon}}} label="Vault" tone="lavender">
          <p className="font-display text-2xl font-semibold">{{formatCurrency(artifact.data.totalLockedValueUsd)}}</p>
          <p className="mt-1 text-xs text-muted">
            {{artifact.data.positions.length}} locked position{{artifact.data.positions.length === 1 ? '' : 's'}}
            {{nextUnlock ? ` · next unlock ${{nextUnlock.ticker ?? 'asset'}}` : ''}}
          </p>
          <p className="mt-2 text-xs leading-5 text-muted">
            Vault UI preview is available, but the onchain program is not live yet so locks cannot be signed.
          </p>
        </{shell}>
      );
    }}"""
    # Replace from case to break before next case
    end = art.find("case '", idx + 5)
    if end == -1:
        end = art.find("case \"", idx + 5)
    if end != -1:
        art = art[:idx] + new + "\n" + art[end:]
        art_path.write_text(art, encoding="utf-8")
        print("updated vault artifact")
    else:
        print("could not find end of vaults case")
else:
    print("vault artifact already enriched or missing")

print("done gate-signing patches")
