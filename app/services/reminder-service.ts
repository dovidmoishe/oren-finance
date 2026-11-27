import { apiRequest } from "./api-client";

/** A release reminder that is still on. Mirrors `api/types/release-reminder.ts`. */
export interface ReleaseReminder {
  id: string;
  /** `MarketEvent.id` of the release. */
  eventId: string;
  /** 15 minutes before the release's current time, ISO 8601. */
  remindAt: string;
}

export interface ReleaseRemindersResponse {
  /** Reminders are on for this account. They follow the price-alert switches. */
  enabled: boolean;
  /** Creating a reminder needs a verified email. */
  emailVerified: boolean;
  reminders: ReleaseReminder[];
}

type AccessToken = () => Promise<string | null>;

async function authenticated<T>(
  getAccessToken: AccessToken,
  path: string,
  init: { method?: "GET" | "POST" | "DELETE"; body?: object; signal?: AbortSignal } = {},
) {
  const token = await getAccessToken();
  init.signal?.throwIfAborted();
  if (!token) throw new Error("Sign in to manage release reminders");
  return apiRequest<T>(`/me/release-reminders${path}`, {
    ...init,
    cache: "no-store",
    headers: { Authorization: `Bearer ${token}` },
  });
}

/** The signed-in account's reminders for upcoming releases. */
export function listReleaseReminders(getAccessToken: AccessToken, signal?: AbortSignal) {
  return authenticated<ReleaseRemindersResponse>(getAccessToken, "", { signal });
}

/** Email 15 minutes before a release. Repeating it returns the same reminder. */
export function createReleaseReminder(getAccessToken: AccessToken, eventId: string, signal?: AbortSignal) {
  return authenticated<ReleaseReminder>(getAccessToken, "", { method: "POST", body: { eventId }, signal });
}

export function deleteReleaseReminder(getAccessToken: AccessToken, id: string, signal?: AbortSignal) {
  return authenticated<{ canceled: true }>(getAccessToken, `/${encodeURIComponent(id)}`, { method: "DELETE", signal });
}
