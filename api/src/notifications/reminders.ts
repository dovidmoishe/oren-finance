import {
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { inArray, sql, type SQL } from 'drizzle-orm';
import type {
  ReleaseReminder,
  ReleaseRemindersResponse,
} from '../../types/release-reminder';
import { DRIZZLE } from '../config/constants';
import type { Database } from '../database/database.provider';
import { marketEvents } from '../database/schema';
import { toMarketEvent } from '../market/calendar/market-calendar.service';
import { insertJob, NotificationJobs } from './jobs';
import {
  REMINDER_LEAD_MINUTES,
  type ReminderEmailFacts,
} from './reminder-email';
import { alertUserAllowed, notificationSettings } from './settings';

/** Most reminders one account can have waiting at once. */
export const MAX_ACTIVE_REMINDERS = 50;
/** Reminder creations one account can make per minute. */
const CREATE_PER_MINUTE = 30;
/** Due reminders queued per batch, and batches per scan. */
const SCAN_BATCH = 500;
const SCAN_BATCHES = 20;
const UUID = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;
const lead = sql.raw(`interval '${REMINDER_LEAD_MINUTES} minutes'`);

type Row = { id: string; event_id: string; remind_at: string };

/**
 * Reminders ride on the price-alert switches: the same feature flag, pilot
 * list, verified-email rule, outbox, email budget and unsubscribe handling.
 */
export function remindersAllowed(
  userId: string,
  config = notificationSettings(),
) {
  return config.alerts && alertUserAllowed(userId, config);
}

export function reminderJobKey(id: string) {
  return `reminder-${id}`;
}

/** ISO 8601 UTC with milliseconds, so the driver's timestamp format never leaks. */
function iso(value: SQL) {
  return sql`to_char((${value}) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
}

function parseReminder(body: unknown) {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new BadRequestException('Invalid release reminder');
  const { eventId } = body as Record<string, unknown>;
  if (
    Object.keys(body).length !== 1 ||
    typeof eventId !== 'string' ||
    !UUID.test(eventId)
  )
    throw new BadRequestException('Supply the release to be reminded about');
  return { eventId: eventId.toLowerCase() };
}

function toResponse(row: Row): ReleaseReminder {
  return { id: row.id, eventId: row.event_id, remindAt: row.remind_at };
}

@Injectable()
export class ReleaseReminders {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly jobs: NotificationJobs,
  ) {}

  /** Reminders that are still on, whether or not the feature is on, so they can be turned off. */
  async list(
    userId: string,
    eligible: boolean,
  ): Promise<ReleaseRemindersResponse> {
    const rows = await this.db.execute<Row>(sql`
      select r.id, r.event_id, ${iso(sql`e.scheduled_at - ${lead}`)} as remind_at
      from release_reminders r join market_events e on e.id = r.event_id
      where r.user_id = ${userId} and r.state in ('active', 'sent')
        and e.scheduled_at > now()
      order by e.scheduled_at, r.id limit ${MAX_ACTIVE_REMINDERS * 2}`);
    return {
      enabled: remindersAllowed(userId),
      emailVerified: eligible,
      reminders: rows.map(toResponse),
    };
  }

  /** Idempotent: a reminder that is already on comes back unchanged. */
  async create(
    userId: string,
    eligible: boolean,
    body: unknown,
  ): Promise<ReleaseReminder> {
    if (!remindersAllowed(userId))
      throw new ServiceUnavailableException(
        'Release reminders are unavailable',
      );
    if (!eligible)
      throw new BadRequestException('A verified email is required');
    if (
      !(await this.jobs.budget(`create-reminder-${userId}`, CREATE_PER_MINUTE))
    )
      throw new HttpException('Too many reminder requests', 429);
    const { eventId } = parseReminder(body);
    return this.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`reminders-${userId}`}))`,
      );
      const [event] = await tx.execute<{
        date_status: string;
        time_precision: string;
        upcoming: boolean;
        remind_at: string;
      }>(sql`
        select date_status, time_precision, scheduled_at > now() as upcoming,
          ${iso(sql`scheduled_at - ${lead}`)} as remind_at
        from market_events where id = ${eventId} and family = 'macro'`);
      if (!event) throw new NotFoundException('This release was not found');
      if (event.date_status === 'cancelled')
        throw new BadRequestException('This release was cancelled');
      if (event.date_status === 'released' || !event.upcoming)
        throw new BadRequestException('This release is already out');
      if (event.time_precision !== 'datetime')
        throw new BadRequestException('This release has no set time yet');
      const [existing] = await tx.execute<{ id: string }>(sql`
        select id from release_reminders
        where user_id = ${userId} and event_id = ${eventId} and state in ('active', 'sent')
        order by created_at desc limit 1`);
      if (existing)
        return toResponse({
          id: existing.id,
          event_id: eventId,
          remind_at: event.remind_at,
        });
      const [total] = await tx.execute<{ count: number }>(sql`
        select count(*)::integer as count
        from release_reminders r join market_events e on e.id = r.event_id
        where r.user_id = ${userId} and r.state = 'active' and e.scheduled_at > now()`);
      if (total.count >= MAX_ACTIVE_REMINDERS)
        throw new ConflictException(
          `You can have up to ${MAX_ACTIVE_REMINDERS} release reminders`,
        );
      const [created] = await tx.execute<{ id: string }>(sql`
        insert into release_reminders (user_id, event_id) values (${userId}, ${eventId})
        on conflict (user_id, event_id) where state = 'active' do nothing returning id`);
      if (!created)
        throw new ConflictException('This release reminder already exists');
      return toResponse({
        id: created.id,
        event_id: eventId,
        remind_at: event.remind_at,
      });
    });
  }

  async cancel(userId: string, id: string) {
    return this.cancelAll(userId, id);
  }

  /** Cancel one reminder, or all of them, and any email not yet handed off. */
  async cancelAll(userId: string, id?: string) {
    await this.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`reminders-${userId}`}))`,
      );
      await tx.execute(sql`update release_reminders set state = 'canceled'
        where user_id = ${userId} and state in ('active', 'sent', 'failed')
        ${id ? sql`and id = ${id}` : sql``}`);
      await tx.execute(sql`update notification_jobs set state = 'canceled', updated_at = now()
        where user_id = ${userId} and kind = 'reminder-email' and state in ('pending', 'running')
        ${id ? sql`and logical_key = ${reminderJobKey(id)}` : sql``}`);
    });
  }
}

/**
 * Runs once a minute in the notification worker. It reads each event's
 * current scheduled_at, so a reminder for a moved release waits for the new
 * time, and one for a cancelled release is canceled.
 */
@Injectable()
export class ReleaseReminderScan {
  constructor(private readonly jobs: NotificationJobs) {}

  async scan(now = new Date()) {
    const config = notificationSettings();
    if (!config.alerts) return;
    const at = sql`${now.toISOString()}::timestamptz`;
    // Same membership as price alerts: everyone when public, else the pilot list.
    const users = config.alertsPublic
      ? null
      : config.pilotUsers.size
        ? sql.join(
            [...config.pilotUsers].map((id) => sql`${id}`),
            sql`, `,
          )
        : undefined;
    await this.jobs.db.transaction(async (tx) => {
      const [lock] = await tx.execute<{ acquired: boolean }>(sql`
        select pg_try_advisory_xact_lock(hashtext('notification-reminder-scan')) as acquired`);
      if (!lock.acquired) return;

      // A queued email the delivery canceled because its release moved: wait
      // for the new time. The job is queued again under the same key.
      await tx.execute(sql`
        update release_reminders r set state = 'active', sent_at = null
        from notification_jobs j, market_events e
        where j.logical_key = 'reminder-' || r.id::text and j.kind = 'reminder-email'
          and j.state = 'canceled' and r.state = 'sent' and e.id = r.event_id
          and e.date_status = 'scheduled' and e.scheduled_at > ${at}
          and date_trunc('milliseconds', e.scheduled_at)
            is distinct from (j.payload->>'scheduledAt')::timestamptz`);

      // A cancelled release cancels its reminders and any email not handed off.
      const cancelled = await tx.execute<{ id: string }>(sql`
        update release_reminders r set state = 'canceled'
        from market_events e
        where e.id = r.event_id and e.date_status = 'cancelled' and r.state in ('active', 'sent')
          and not exists (select 1 from notification_jobs j
            where j.logical_key = 'reminder-' || r.id::text
              and j.state in ('sending', 'accepted', 'uncertain', 'complete'))
        returning r.id`);
      if (cancelled.length)
        await tx.execute(sql`
          update notification_jobs set state = 'canceled', updated_at = now()
          where kind = 'reminder-email' and state in ('pending', 'running')
            and logical_key in (${sql.join(
              cancelled.map(({ id }) => sql`${reminderJobKey(id)}`),
              sql`, `,
            )})`);

      // An email that permanently failed or was canceled by the system. User
      // cancels and unsubscribes mark the reminder canceled first.
      await tx.execute(sql`
        update release_reminders r set state = 'failed'
        from notification_jobs j
        where j.logical_key = 'reminder-' || r.id::text and j.kind = 'reminder-email'
          and j.state in ('failed', 'canceled') and r.state = 'sent'`);

      // The release came out before the reminder could be queued.
      await tx.execute(sql`
        update release_reminders r set state = 'failed'
        from market_events e
        where e.id = r.event_id and r.state = 'active'
          and (e.date_status = 'released' or e.scheduled_at <= ${at})`);

      if (users === undefined) return;
      for (let batch = 0; batch < SCAN_BATCHES; batch++) {
        const due = await tx.execute<{
          id: string;
          user_id: string;
          event_id: string;
        }>(sql`
          select r.id, r.user_id, r.event_id from release_reminders r
          join market_events e on e.id = r.event_id
          where r.state = 'active' and e.date_status = 'scheduled'
            and e.time_precision = 'datetime'
            and e.scheduled_at > ${at} and e.scheduled_at - ${lead} <= ${at}
            ${users ? sql`and r.user_id in (${users})` : sql``}
          order by e.scheduled_at, r.id limit ${SCAN_BATCH} for update of r`);
        if (!due.length) return;
        const ids = [...new Set(due.map((row) => row.event_id))];
        const events = new Map(
          (
            await tx
              .select()
              .from(marketEvents)
              .where(inArray(marketEvents.id, ids))
          ).map((row) => [row.id, toMarketEvent(row, now)]),
        );
        for (const reminder of due) {
          const event = events.get(reminder.event_id);
          if (!event) continue;
          const payload: ReminderEmailFacts = {
            reminderId: reminder.id,
            eventId: event.id,
            kind: event.kind,
            title: event.title,
            agencyId: event.agencyId,
            agency: event.agency,
            scheduledAt: event.scheduledAt,
            dateEt: event.dateEt,
            timeBasis: event.timeBasis,
            referenceLabel: event.referenceLabel,
            sourceUrl: event.sourceUrl,
          };
          await tx.execute(sql`update release_reminders set state = 'sent', sent_at = ${at}
            where id = ${reminder.id} and state = 'active'`);
          await tx.execute(
            insertJob(
              reminder.user_id,
              'reminder-email',
              reminderJobKey(reminder.id),
              payload,
            ),
          );
        }
        if (due.length < SCAN_BATCH) return;
      }
    });
  }
}
