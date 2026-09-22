from pathlib import Path
import re

t = Path("app/components/vault/vault-dashboard.tsx").read_text(encoding="utf-8")
m = re.search(r"import \{([\s\S]*?)\} from \"@hugeicons/core-free-icons\"", t)
print("imports:", m.group(1) if m else None)
print("icon usages", re.findall(r"icon=\{([A-Za-z0-9]+)\}", t))

p = Path("app/components/portfolio/portfolio-dashboard.tsx").read_text(encoding="utf-8")
print("portfolio icons", sorted(set(re.findall(r"([A-Za-z0-9]+Icon)", p)))[:30])

for i, line in enumerate(t.splitlines(), 1):
    if "ErrorState" in line or "onRetry" in line:
        print(i, line.strip())

# Check ErrorState actual prop
s = Path("app/components/ui/states.tsx").read_text(encoding="utf-8")
print("ErrorState block:")
print(s[s.find("export function ErrorState") : s.find("export function ErrorState") + 350])
