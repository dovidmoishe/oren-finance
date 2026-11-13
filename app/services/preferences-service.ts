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

export interface Preferences {
  sectors: SectorId[];
  morningBrief: boolean;
  breakingNews: boolean;
  briefTime: string;
  timeZone: string;
}

interface PreferencesResponse {
  preferences: Preferences | null;
  emailEligible: boolean;
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
