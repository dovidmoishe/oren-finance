"use client";

import { create } from "zustand";
import { ApiError } from "@/services/api-client";
import {
  createReleaseReminder,
  deleteReleaseReminder,
  listReleaseReminders,
  type ReleaseReminder,
} from "@/services/reminder-service";

/** Short messages a bell shows next to itself. Keys live under `calendar.reminder.*`. */
export type ReminderNotice = "failed" | "verifyEmail" | "limit";
type AccessToken = () => Promise<string | null>;

interface ReleaseReminderState {
  /** The account this state belongs to. Another sign-in starts over. */
  owner?: string;
  loaded: boolean;
  enabled: boolean;
  emailVerified: boolean;
  /** Reminders that are on, by `MarketEvent.id`. */
  reminders: Record<string, ReleaseReminder>;
  busy: Record<string, boolean>;
  notices: Record<string, ReminderNotice>;
  /** One request per account, shared by every bell on the page. */
  load: (owner: string, getAccessToken: AccessToken) => Promise<void>;
  toggle: (owner: string, eventId: string, getAccessToken: AccessToken) => Promise<void>;
}

const RETRY_MS = 60_000;
const NOTICE_MS = 6_000;

let loading: { owner: string; promise: Promise<void> } | undefined;
let failure: { owner: string; at: number } | undefined;
const noticeTimers = new Map<string, ReturnType<typeof setTimeout>>();

function blank(owner?: string) {
  return { owner, loaded: false, enabled: false, emailVerified: false, reminders: {}, busy: {}, notices: {} };
}

function without<T>(record: Record<string, T>, key: string) {
  const next = { ...record };
  delete next[key];
  return next;
}

function noticeFor(error: unknown): ReminderNotice {
  if (error instanceof ApiError) {
    if (error.status === 409) return "limit";
    if (error.status === 400 && /verified email/i.test(error.message)) return "verifyEmail";
  }
  return "failed";
}

export const useReleaseReminderStore = create<ReleaseReminderState>((set, get) => {
  function notify(eventId: string, notice: ReminderNotice) {
    const owner = get().owner;
    clearTimeout(noticeTimers.get(eventId));
    set({ notices: { ...get().notices, [eventId]: notice } });
    noticeTimers.set(
      eventId,
      setTimeout(() => {
        noticeTimers.delete(eventId);
        if (get().owner === owner) set({ notices: without(get().notices, eventId) });
      }, NOTICE_MS),
    );
  }

  return {
    ...blank(),
    load(owner, getAccessToken) {
      if (get().owner !== owner) {
        loading = undefined;
        failure = undefined;
        set(blank(owner));
      }
      if (get().loaded) return Promise.resolve();
      if (loading?.owner === owner) return loading.promise;
      // A failed list stays quiet for a minute instead of retrying per row.
      if (failure?.owner === owner && Date.now() - failure.at < RETRY_MS) return Promise.resolve();
      const promise = listReleaseReminders(getAccessToken)
        .then((data) => {
          if (get().owner !== owner) return;
          failure = undefined;
          set({
            loaded: true,
            enabled: data.enabled,
            emailVerified: data.emailVerified,
            reminders: Object.fromEntries(data.reminders.map((reminder) => [reminder.eventId, reminder])),
          });
        })
        .catch(() => {
          if (get().owner === owner) failure = { owner, at: Date.now() };
        })
        .finally(() => {
          if (loading?.promise === promise) loading = undefined;
        });
      loading = { owner, promise };
      return promise;
    },
    async toggle(owner, eventId, getAccessToken) {
      const state = get();
      if (state.owner !== owner || !state.loaded || state.busy[eventId]) return;
      const existing = state.reminders[eventId];
      if (!existing && !state.emailVerified) return notify(eventId, "verifyEmail");
      // Optimistic: the bell flips now and flips back if the request fails.
      set({
        busy: { ...state.busy, [eventId]: true },
        notices: without(state.notices, eventId),
        reminders: existing
          ? without(state.reminders, eventId)
          : { ...state.reminders, [eventId]: { id: "", eventId, remindAt: "" } },
      });
      try {
        if (existing) {
          await deleteReleaseReminder(getAccessToken, existing.id);
        } else {
          const created = await createReleaseReminder(getAccessToken, eventId);
          if (get().owner === owner) set({ reminders: { ...get().reminders, [eventId]: created } });
        }
      } catch (error) {
        if (get().owner !== owner) return;
        set({
          reminders: existing ? { ...get().reminders, [eventId]: existing } : without(get().reminders, eventId),
        });
        notify(eventId, noticeFor(error));
      } finally {
        if (get().owner === owner) set({ busy: without(get().busy, eventId) });
      }
    },
  };
});
