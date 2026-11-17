import { apiRequest } from "./api-client";

export const sectorIds = [
  "communicationServices",
  "consumerDiscretionary",
  "consumerStaples",
  "energy",
  "financials",
  "healthCare",
  "industrials",
  "informationTechnology",
  "materials",
  "realEstate",
  "utilities",
] as const;

export type SectorId = (typeof sectorIds)[number];

export const themeIds = [
  "artificialIntelligence", "semiconductors", "cybersecurity", "cloudComputing",
  "robotics", "cleanEnergy", "fintech", "spaceAndDefense",
] as const;
export type ThemeId = (typeof themeIds)[number];
export const interestIds = [...sectorIds, ...themeIds] as const;
export type InterestId = (typeof interestIds)[number];

export const sectorThemes: Partial<Record<SectorId, readonly ThemeId[]>> = {
  informationTechnology: ["artificialIntelligence", "semiconductors", "cloudComputing", "cybersecurity", "robotics"],
  energy: ["cleanEnergy"],
  financials: ["fintech"],
  industrials: ["spaceAndDefense"],
};

export function interestLabelKey(interest: InterestId | null) {
  if (!interest) return "marketForYou.match";
  return (themeIds as readonly string[]).includes(interest)
    ? `preferences.themes.${interest as ThemeId}` as const
    : `preferences.sectors.${interest as SectorId}` as const;
}

export interface Preferences {
  // Retain the API field name for existing account preferences.
  sectors: InterestId[];
  morningBrief: boolean;
  breakingNews: boolean;
  briefTime: string;
  timeZone: string;
}

interface PreferencesResponse {
  preferences: Preferences | null;
  emailEligible: boolean;
  supportedInterests?: InterestId[];
}

export function defaultPreferences(): Preferences {
  return {
    sectors: [],
    morningBrief: false,
    breakingNews: false,
    briefTime: "08:00",
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  };
}

export async function requestPreferences(
  getAccessToken: () => Promise<string | null>,
  signal: AbortSignal,
  body?: Preferences,
) {
  const token = await getAccessToken();
  signal.throwIfAborted();
  if (!token) throw new Error("Sign in to manage preferences");
  return apiRequest<PreferencesResponse>("me/preferences", {
    method: body ? "PUT" : "GET",
    body,
    cache: "no-store",
    signal,
    headers: { Authorization: `Bearer ${token}` },
  });
}
