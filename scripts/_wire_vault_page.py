from pathlib import Path
import re

t = Path("app/components/vault/vault-dashboard.tsx").read_text(encoding="utf-8")

# Fix availableQuantity if wrong
# portfolio type uses availableQuantity
if "availableQuantity" not in t and "availableQuantity" in t:
    pass

print("availableQuantity count", t.count("availableQuantity"))
print("availableQuantity count", t.count("availableQuantity"))

# Fix any MetricTile/MetricTile mismatch - already OK
# Ensure page and index
Path("app/components/vault/index.ts").write_text(
    'export * from "./vault-dashboard";\nexport * from "./vault-review-modal";\n',
    encoding="utf-8",
)
Path("app/app/vault/page.tsx").write_text(
    '''import { VaultDashboard } from "@/components/vault";
import { AppShell } from "@/components/shell";

export default function VaultPage() {
  return (
    <AppShell>
      <div className="mx-auto max-w-[1540px] pb-20">
        <VaultDashboard />
      </div>
    </AppShell>
  );
}
''',
    encoding="utf-8",
)

# Patch portfolio dashboard locked tile caption
dash = Path("app/components/portfolio/portfolio-dashboard.tsx").read_text(encoding="utf-8")
old = '''        <DetailMetric
          change={portfolio?.changePct}
          className="bg-accent-pink"
          detail="Positions held inside Oren Vault"
          label="Locked Positions"
          value={formatCurrency(portfolio?.lockedValueUsd)}
        />'''

# try alternate field names
candidates = []
for locked_field in ["lockedValueUsd", "lockedValueUsd"]:
    for detail in [
        'detail="Positions held inside Oren Vault"',
        'detail="Positions held inside Oren Vault"',
    ]:
        pass

if "Positions held inside Oren Vault" in dash:
    dash2 = dash.replace(
        'detail="Positions held inside Oren Vault"',
        'detail="Timelocked holdings · open Vault to manage (program not live yet)"',
        1,
    )
    # Add Link import and wrap if not present - keep simple caption only
    if 'from "next/link"' not in dash2 and "from 'next/link'" not in dash2:
        # find a place - optional Link below metric
        pass
    Path("app/components/portfolio/portfolio-dashboard.tsx").write_text(dash2, encoding="utf-8")
    print("updated dashboard caption")
else:
    print("caption target not found")
    for i, line in enumerate(dash.splitlines(), 1):
        if "Locked" in line or "locked" in line:
            print(i, line.strip())

print("page:", Path("app/app/vault/page.tsx").read_text(encoding="utf-8")[:180])
