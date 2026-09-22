from pathlib import Path
import re

d = Path("app/components/portfolio/portfolio-dashboard.tsx").read_text(encoding="utf-8")
print("accents", re.findall(r"bg-accent-[a-z0-9-]+", d)[:10])
print("font-display", "font-display" in d)
print("font-display", "font-display" in d)

# Also check panel-subtle vs panel-subtle
print("panel-subtle", "panel-subtle" in d, "bg-panel-subtle" in d)
