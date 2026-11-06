import type { GrantSettings } from "./mcp-grant-authorization";

export type GrantDraft = {
  perTradeUsd: string;
  dailyUsd: string;
  slippagePercent: string;
  durationHours: string;
};

export function parseGrantSettings(draft: GrantDraft, sellAvailable: boolean): GrantSettings {
  const dollars = (value: string, max: number) => {
    if (!/^\d+(?:\.\d{1,2})?$/.test(value) || Number(value) < 0.01 || Number(value) > max)
      throw new Error(`Enter an amount between $0.01 and $${max}.`);
    return Number(value);
  };
  const perTradeUsd = dollars(draft.perTradeUsd, 25);
  const dailyUsd = dollars(draft.dailyUsd, 50);
  if (dailyUsd < perTradeUsd) throw new Error("Your 24-hour limit must cover at least one trade.");
  if (!/^\d+(?:\.\d{1,2})?$/.test(draft.slippagePercent) ||
      Number(draft.slippagePercent) < 0.01 || Number(draft.slippagePercent) > 0.5)
    throw new Error("Choose a price tolerance between 0.01% and 0.5%.");
  const durationHours = Number(draft.durationHours);
  if (!draft.durationHours.trim() || !Number.isInteger(durationHours) || durationHours < 1 || durationHours > 24)
    throw new Error("Choose a duration between 1 and 24 hours.");
  return { perTradeUsd, dailyUsd, maxSlippageBps: Math.round(Number(draft.slippagePercent) * 100), durationHours, allowSell: sellAvailable };
}
