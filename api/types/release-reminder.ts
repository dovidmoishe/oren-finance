/**
 * Email reminders for official US releases. A reminder goes out 15 minutes
 * before the release's current time, so a moved release still reminds on time.
 */

/** One reminder that is still on: waiting, or queued for an upcoming release. */
export interface ReleaseReminder {
  id: string;
  /** The market event (`MarketEvent.id`) the reminder is for. */
  eventId: string;
  /** ISO instant 15 minutes before the release's current scheduled time. */
  remindAt: string;
}

export interface ReleaseRemindersResponse {
  /** Reminders are on for this account. They follow the price-alert switches. */
  enabled: boolean;
  /** A verified email is required to create a reminder. */
  emailVerified: boolean;
  reminders: ReleaseReminder[];
}

export interface CreateReleaseReminderRequest {
  eventId: string;
}
