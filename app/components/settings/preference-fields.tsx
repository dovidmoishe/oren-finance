"use client";

import { useT } from "@/i18n/i18n";
import { useId, useState } from "react";
import { Building2, Check, ChevronDown, Cpu, Factory, HeartPulse, Landmark, Layers3, Lightbulb, Radio, ShoppingBag, ShoppingBasket, Zap, type LucideIcon } from "lucide-react";
import { sectorIds, sectorThemes, interestLabelKey, type InterestId, type Preferences, type SectorId } from "@/services/preferences-service";

const sectorIcons: Record<SectorId, LucideIcon> = {
  informationTechnology: Cpu,
  communicationServices: Radio,
  consumerDiscretionary: ShoppingBag,
  consumerStaples: ShoppingBasket,
  energy: Zap,
  financials: Landmark,
  healthCare: HeartPulse,
  industrials: Factory,
  materials: Layers3,
  realEstate: Building2,
  utilities: Lightbulb,
};

const orderedSectors = ["informationTechnology", ...sectorIds.filter((sector) => sector !== "informationTechnology")] as const;
const sectorColumns = [orderedSectors.slice(0, 6), orderedSectors.slice(6)];

export function SectorChoices({ value, onChange, availableInterests = sectorIds }: {
  value: InterestId[];
  onChange: (sectors: InterestId[]) => void;
  availableInterests?: readonly InterestId[];
}) {
  const t = useT();
  const id = useId();
  const [expanded, setExpanded] = useState<readonly SectorId[]>(() =>
    orderedSectors.filter((sector) => sectorThemes[sector]?.some((theme) => value.includes(theme))),
  );
  const themesAvailable = Object.values(sectorThemes).flat().some((theme) => availableInterests.includes(theme));

  function toggle(interest: InterestId) {
    onChange(value.includes(interest) ? value.filter((item) => item !== interest) : [...value, interest]);
  }

  function themeChoice(interest: InterestId) {
    const selected = value.includes(interest);
    return (
      <button
        key={interest}
        type="button"
        aria-pressed={selected}
        disabled={!availableInterests.includes(interest)}
        className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-border bg-panel px-2.5 py-1.5 text-xs font-medium hover:bg-panel-subtle focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-55 aria-pressed:border-foreground aria-pressed:bg-foreground aria-pressed:text-background"
        onClick={() => toggle(interest)}
      >
        {selected && <Check className="size-3 shrink-0" strokeWidth={2.5} aria-hidden="true" />}
        {t(interestLabelKey(interest))}
      </button>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs leading-5 text-muted">{t("preferences.structureDetail")}</p>
      <div className="grid gap-x-5 rounded-2xl border border-border px-2 py-1 @lg:grid-cols-2 @lg:px-3">
        {sectorColumns.map((sectors, column) => (
          <div key={column} className="min-w-0 divide-y divide-border first:border-b first:border-border @lg:first:border-b-0">
            {sectors.map((sector) => {
              const themes = sectorThemes[sector];
              const open = expanded.includes(sector);
              const selected = value.includes(sector);
              const selectedThemes = themes?.filter((theme) => value.includes(theme)).length ?? 0;
              const Icon = sectorIcons[sector];
              const panelId = `${id}-${sector}`;
              return (
                <div key={sector} className="accordion py-1" data-open={open}>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      aria-pressed={selected}
                      disabled={!availableInterests.includes(sector)}
                      className="flex min-h-11 min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 text-left text-sm hover:bg-panel-subtle focus-visible:outline-2 focus-visible:outline-offset-2 aria-pressed:bg-panel-subtle"
                      onClick={() => toggle(sector)}
                    >
                      <Icon className="size-4 shrink-0 text-muted" strokeWidth={1.75} aria-hidden="true" />
                      <span className="min-w-0 flex-1 font-medium">{t(interestLabelKey(sector))}</span>
                      {selectedThemes > 0 && <span className="rounded-md bg-panel-subtle px-1.5 py-0.5 text-[10px] text-muted" aria-label={t("preferences.selectedCount", { count: selectedThemes })}>{selectedThemes}</span>}
                      <span aria-hidden="true" className={`flex size-4 shrink-0 items-center justify-center rounded border ${selected ? "border-foreground bg-foreground text-background" : "border-border-strong"}`}>
                        {selected && <Check className="size-3" strokeWidth={2.5} />}
                      </span>
                    </button>
                    {themes ? (
                      <button
                        type="button"
                        aria-expanded={open}
                        aria-controls={panelId}
                        aria-label={`${t(interestLabelKey(sector))}: ${t("preferences.relatedThemes")}`}
                        className="flex size-9 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-panel-subtle hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2"
                        onClick={() => setExpanded((current) => current.includes(sector) ? current.filter((item) => item !== sector) : [...current, sector])}
                      >
                        <ChevronDown className="accordion-chevron size-3.5" aria-hidden="true" />
                      </button>
                    ) : <span className="size-9 shrink-0" aria-hidden="true" />}
                  </div>
                  {themes && (
                    <div id={panelId} className="accordion-panel" aria-hidden={!open} inert={!open}>
                      <div className="accordion-content min-h-0">
                        <div className="flex flex-wrap gap-1.5 pb-3 pl-8 pr-2 pt-1">{themes.map(themeChoice)}</div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
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
