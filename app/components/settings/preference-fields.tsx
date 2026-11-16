"use client";

import { useT } from "@/i18n/i18n";
import { Check, Cpu } from "lucide-react";
import { sectorIds, sectorThemes, interestLabelKey, type InterestId, type Preferences } from "@/services/preferences-service";

export function SectorChoices({ value, onChange, availableInterests = sectorIds }: {
  value: InterestId[];
  onChange: (sectors: InterestId[]) => void;
  availableInterests?: readonly InterestId[];
}) {
  const t = useT();
  const ordered = ["informationTechnology", ...sectorIds.filter((sector) => sector !== "informationTechnology")] as const;
  const themesAvailable = Object.values(sectorThemes).flat().some((theme) => availableInterests.includes(theme));

  function choice(interest: InterestId, nested = false) {
    const selected = value.includes(interest);
    return (
      <button
        key={interest}
        type="button"
        aria-pressed={selected}
        disabled={!availableInterests.includes(interest)}
        className={nested
          ? "inline-flex min-h-10 items-center gap-2 rounded-full border border-border bg-panel px-3 py-2 text-xs font-medium hover:bg-panel-subtle focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-45 aria-pressed:border-foreground aria-pressed:bg-foreground aria-pressed:text-background"
          : "flex min-h-10 w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-sm font-semibold hover:bg-panel-subtle focus-visible:outline-2 focus-visible:outline-offset-2 aria-pressed:bg-panel-subtle"}
        onClick={() => onChange(selected ? value.filter((item) => item !== interest) : [...value, interest])}
      >
        <span className="flex items-center gap-2">
          {interest === "informationTechnology" && <Cpu className="size-4 text-muted" aria-hidden="true" />}
          {t(interestLabelKey(interest))}
        </span>
        <span aria-hidden="true" className={selected
          ? "flex size-4 shrink-0 items-center justify-center rounded-full bg-foreground text-background"
          : "size-4 shrink-0 rounded-full border border-current opacity-35"}>
          {selected && <Check className="size-3" strokeWidth={3} />}
        </span>
      </button>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs leading-5 text-muted">{t("preferences.structureDetail")}</p>
      <div className="grid gap-2 @lg:grid-cols-2">
        {ordered.map((sector) => {
          const themes = sectorThemes[sector];
          return (
            <div key={sector} className={`min-w-0 rounded-2xl border border-border p-1 ${sector === "informationTechnology" ? "@lg:col-span-2" : ""}`}>
              {choice(sector)}
              {themes && (
                <div className="mx-3 mb-3 mt-1 border-l border-border pl-3">
                  <p className="mb-2 text-[11px] font-medium text-muted">{t("preferences.relatedThemes")}</p>
                  <div className="flex flex-wrap gap-1.5">{themes.map((theme) => choice(theme, true))}</div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {!themesAvailable && <p className="text-xs text-muted" role="status">{t("preferences.themesSoon")}</p>}
      <p className="text-xs text-muted" role="status">{t("preferences.selectedCount", { count: value.length })}</p>
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
