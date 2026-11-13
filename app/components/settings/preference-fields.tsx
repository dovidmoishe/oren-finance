"use client";

import { useT } from "@/i18n/i18n";
import { sectorIds, type Preferences, type SectorId } from "@/services/preferences-service";

export function SectorChoices({ value, onChange }: {
  value: SectorId[];
  onChange: (sectors: SectorId[]) => void;
}) {
  const t = useT();
  return (
    <div className="flex flex-wrap gap-2">
      {sectorIds.map((sector) => (
        <button
          key={sector}
          type="button"
          aria-pressed={value.includes(sector)}
          className="min-h-10 rounded-full border border-border px-3 py-2 text-sm font-medium hover:bg-panel-subtle focus-visible:outline-2 focus-visible:outline-offset-2 aria-pressed:border-foreground aria-pressed:bg-foreground aria-pressed:text-background"
          onClick={() => onChange(value.includes(sector)
            ? value.filter((item) => item !== sector)
            : [...value, sector])}
        >
          {t(`preferences.sectors.${sector}`)}
        </button>
      ))}
    </div>
  );
}

export function EmailChoices({ value, onChange, eligible }: {
  value: Preferences;
  onChange: (next: Preferences) => void;
  eligible: boolean;
}) {
  const t = useT();
  return (
    <div className="space-y-3">
      {(["morningBrief", "breakingNews"] as const).map((kind) => (
        <label key={kind} className="flex items-start justify-between gap-4 rounded-xl border border-border p-3">
          <span>
            <span className="block text-sm font-semibold">{t(`preferences.${kind}`)}</span>
            <span className="mt-1 block text-sm text-muted">{t(`preferences.${kind}Detail`)}</span>
          </span>
          <input
            type="checkbox"
            role="switch"
            aria-label={t(`preferences.${kind}`)}
            checked={eligible && value[kind]}
            disabled={!eligible}
            onChange={(event) => onChange({ ...value, [kind]: event.target.checked })}
            className="mt-1 size-5 shrink-0 accent-foreground"
          />
        </label>
      ))}
      <p className="text-sm text-muted">{t(eligible ? "preferences.deliveryLater" : "preferences.verifiedEmail")}</p>
    </div>
  );
}
