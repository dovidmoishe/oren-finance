import { Inject, Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import { DRIZZLE } from '../config/constants';
import type { Database } from '../database/database.provider';
import type { SenviokSendFailure } from './senviok-error';
import { notificationSettings } from './settings';
import {
  BRIEF_GRACE_MS,
  BRIEF_SCHEDULE_BATCH,
  MINUTE_MS,
  briefAdmitPerMinute,
  localDate,
  nextBrief,
} from './schedule';

export type Kind = 'brief' | 'brief-email' | 'alert-email' | 'reminder-email';
export type Job = {
  id: string;
  user_id: string;
  kind: Kind;
  attempts: number;
  lease_token: string;
  logical_key: string;
  payload: Record<string, unknown>;
};
export type BriefSchedule = {
  brief_time: string;
  time_zone: string;
  brief_wallet: string | null;
  brief_wallet_since: Date | string | null;
};
type Due = BriefSchedule & {
  user_id: string;
  brief_due_at: Date | string | null;
};

@Injectable()
export class NotificationJobs {
  constructor(@Inject(DRIZZLE) readonly db: Database) {}

  /**
   * Arm and admit Morning Briefs for opted-in users.
   * Reads at most BRIEF_SCHEDULE_BATCH due rows. A shared brief time stays in
   * user_preferences until a slot is free: admission is capped at the brief
   * share of the email and Tokens budgets, and in-flight brief jobs are capped
   * at that rate times the grace window so a backlog cannot outlive BRIEF_GRACE_MS.
   * Returns how many stored due times fell outside the grace window.
   */
  async schedule(now: Date) {
    const config = notificationSettings();
    if (!config.briefs) return 0;
    const perMinute = briefAdmitPerMinute(config);
    const horizon = BRIEF_GRACE_MS / MINUTE_MS;
    const cap = perMinute * horizon;
    return this.db.transaction(async (tx) => {
      const [inflight] = await tx.execute<{ waiting: number }>(sql`
        select count(*)::int as waiting from notification_jobs
        where kind in ('brief', 'brief-email')
          and state in ('pending', 'running', 'sending')
      `);
      let admit = Math.min(
        perMinute,
        Math.max(0, cap - Number(inflight?.waiting ?? 0)),
      );
      let missed = 0;
      const cutoff = new Date(now.getTime() - BRIEF_GRACE_MS);
      const due = await tx.execute<Due>(sql`
        select user_id, brief_time, time_zone, brief_due_at, brief_wallet, brief_wallet_since
        from user_preferences
        where morning_brief
          and (brief_due_at is null or brief_due_at <= ${now.toISOString()})
        order by brief_due_at asc nulls last, user_id
        limit ${BRIEF_SCHEDULE_BATCH}
        for update skip locked
      `);
      for (const row of due) {
        if (!row.brief_due_at) {
          await this.setDue(
            tx,
            row,
            nextBrief(now, row.brief_time, row.time_zone),
          );
          continue;
        }
        const previousDue = new Date(row.brief_due_at);
        const scheduled =
          previousDue >= cutoff
            ? previousDue
            : nextBrief(
                new Date(cutoff.getTime() - 1),
                row.brief_time,
                row.time_zone,
              );
        const stale = previousDue < cutoff;
        if (scheduled > now) {
          if (stale) missed++;
          await this.setDue(tx, row, scheduled);
          continue;
        }
        if (admit < 1) continue;
        const date = localDate(scheduled, row.time_zone);
        await tx.execute(
          insertJob(row.user_id, 'brief', `brief-${row.user_id}-${date}`, {
            date,
            scheduled: scheduled.toISOString(),
            time: row.brief_time,
            zone: row.time_zone,
          }),
        );
        await this.setDue(
          tx,
          row,
          nextBrief(now, row.brief_time, row.time_zone),
        );
        if (stale) missed++;
        admit--;
      }
      return missed;
    });
  }

  private async setDue(tx: Pick<Database, 'execute'>, row: Due, due: Date) {
    await tx.execute(sql`update user_preferences
      set brief_due_at = ${due.toISOString()}
      where user_id = ${row.user_id}`);
  }

  async sweep() {
    // A send that passed the handoff boundary is never automatically reissued.
    const uncertain = await this.db.execute(sql`
      update notification_jobs set state = 'uncertain', updated_at = now()
      where state = 'sending' and lease_until < now() returning id`);
    await this.db.execute(sql`
      update notification_jobs set state = case when attempts >= 5 then 'failed' else 'pending' end,
        lease_token = null, lease_until = null, updated_at = now()
      where state = 'running' and lease_until < now()`);
    // An alert whose email permanently failed or was canceled by the system is
    // marked failed so the user can see it was not delivered. User cancels and
    // unsubscribes mark the alert canceled first, so they are unaffected.
    await this.db.execute(sql`
      update price_alerts a set state = 'failed'
      from notification_jobs j
      where j.logical_key = 'alert-' || a.id::text and j.kind = 'alert-email'
        and j.state in ('failed', 'canceled') and a.state = 'triggered'`);
    return uncertain.length;
  }

  async pending(kind: Kind) {
    return this.db.execute<{ id: string }>(sql`
      select id from notification_jobs
      where state = 'pending' and kind = ${kind} and run_after <= now()
      order by run_after, id limit 100`);
  }

  async claim(id: string, kind: Kind): Promise<Job | undefined> {
    const [job] = await this.db.execute<Job>(sql`
      update notification_jobs set state = 'running', attempts = attempts + 1,
        lease_until = now() + interval '10 minutes', lease_token = gen_random_uuid(), updated_at = now()
      where id = ${id} and kind = ${kind} and state = 'pending' and run_after <= now()
      returning id, user_id, kind, attempts, lease_token, logical_key, payload`);
    return job;
  }

  async update(
    job: Job,
    state: 'complete' | 'canceled' | 'uncertain' | 'accepted',
    providerId?: string,
    failure?: SenviokSendFailure,
  ) {
    await this.db.execute(sql`
      update notification_jobs set state = ${state}, provider_id = ${providerId ?? null},
        last_error_status = ${failure?.status ?? null}, last_error = ${failure?.message ?? null},
        lease_until = null, updated_at = now()
      where id = ${job.id} and lease_token = ${job.lease_token}
        and state in ('running', 'sending', 'uncertain')`);
  }

  async failSend(job: Job, failure: SenviokSendFailure) {
    await this.db.execute(sql`
      update notification_jobs set state = 'failed',
        last_error_status = ${failure.status}, last_error = ${failure.message},
        lease_until = null, updated_at = now()
      where id = ${job.id} and lease_token = ${job.lease_token} and state = 'sending'`);
  }

  async retry(job: Job, submitted = false, failure?: SenviokSendFailure) {
    const seconds = 30 * 2 ** Math.min(job.attempts - 1, 4);
    if (failure) {
      await this.db.execute(sql`
        update notification_jobs set state = ${job.attempts >= 5 ? 'failed' : 'pending'},
          run_after = now() + ${seconds} * interval '1 second',
          last_error_status = ${failure.status}, last_error = ${failure.message},
          lease_token = null, lease_until = null, updated_at = now()
        where id = ${job.id} and lease_token = ${job.lease_token}
          and state = ${submitted ? 'sending' : 'running'}`);
      return;
    }
    await this.db.execute(sql`
      update notification_jobs set state = ${job.attempts >= 5 ? 'failed' : 'pending'},
        run_after = now() + ${seconds} * interval '1 second',
        lease_token = null, lease_until = null, updated_at = now()
      where id = ${job.id} and lease_token = ${job.lease_token}
        and state = ${submitted ? 'sending' : 'running'}`);
  }

  async defer(job: Job) {
    await this.db.execute(sql`update notification_jobs set state = 'pending',
      attempts = greatest(0, attempts - 1), lease_token = null, lease_until = null,
      run_after = now() + interval '1 minute', updated_at = now()
      where id = ${job.id} and lease_token = ${job.lease_token} and state = 'running'`);
  }

  async handoff(job: Job) {
    // A reminder goes out only while its release is still upcoming at the
    // time it was queued for; a moved release is queued again by the scan.
    const allowed =
      job.kind === 'brief-email'
        ? sql`exists (select 1 from user_preferences where user_id = ${job.user_id}
          and morning_brief and brief_time = ${job.payload.time as string}
          and time_zone = ${job.payload.zone as string})`
        : job.kind === 'reminder-email'
          ? sql`exists (select 1 from release_reminders r join market_events e on e.id = r.event_id
          where r.id = ${(job.payload.reminderId as string) ?? null}::uuid and r.user_id = ${job.user_id}
            and r.state = 'sent' and e.date_status = 'scheduled'
            and date_trunc('milliseconds', e.scheduled_at) = ${(job.payload.scheduledAt as string) ?? null}::timestamptz
            and e.scheduled_at > now())`
          : sql`exists (select 1 from price_alerts where id = ${job.payload.alertId as string}
          and user_id = ${job.user_id} and state = 'triggered')`;
    const rows = await this.db.execute(sql`
      update notification_jobs set state = 'sending', lease_until = now() + interval '5 minutes', updated_at = now()
      where id = ${job.id} and lease_token = ${job.lease_token} and state = 'running'
        and lease_until > now() and ${allowed} returning id`);
    return rows.length === 1;
  }

  async scheduleFor(userId: string) {
    const [row] = await this.db.execute<BriefSchedule>(sql`
      select brief_time, time_zone, brief_wallet, brief_wallet_since from user_preferences where user_id = ${userId} and morning_brief`);
    return row;
  }

  async queueBriefEmail(job: Job, body: Record<string, unknown>) {
    return this.db.transaction(async (tx) => {
      const rows =
        await tx.execute(sql`update notification_jobs set state = 'complete',
        lease_until = null, updated_at = now()
        where id = ${job.id} and lease_token = ${job.lease_token}
        and state = 'running' and lease_until > now() returning id`);
      if (rows.length)
        await tx.execute(
          insertJob(
            job.user_id,
            'brief-email',
            `${job.logical_key}-email`,
            body,
          ),
        );
    });
  }

  async budget(
    scope: string,
    limit: number,
    lane?: { name: string; limit: number },
  ): Promise<boolean> {
    if (limit < 1 || (lane && lane.limit < 1)) return false;
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${scope}))`);
      const [minute] = await tx.execute<{ minute: string }>(
        sql`select date_trunc('minute', now())::text as minute`,
      );
      const [total] = await tx.execute<{ used: number }>(
        sql`select used from notification_budgets where scope = ${scope} and minute = ${minute.minute}`,
      );
      if ((total?.used ?? 0) >= limit) return false;
      if (lane) {
        const [count] = await tx.execute<{ used: number }>(
          sql`select used from notification_budgets where scope = ${lane.name} and minute = ${minute.minute}`,
        );
        if ((count?.used ?? 0) >= lane.limit) return false;
        await tx.execute(increment(lane.name, minute.minute));
      }
      await tx.execute(increment(scope, minute.minute));
      return true;
    });
  }
}

function increment(scope: string, minute: string) {
  return sql`insert into notification_budgets (scope, minute, used) values (${scope}, ${minute}, 1)
    on conflict (scope, minute) do update set used = notification_budgets.used + 1`;
}

export function insertJob(
  userId: string,
  kind: Kind,
  logicalKey: string,
  payload: Record<string, unknown>,
): SQL {
  return sql`insert into notification_jobs (user_id, kind, logical_key, payload)
    values (${userId}, ${kind}, ${logicalKey}, ${JSON.stringify(payload)}::jsonb)
    on conflict (logical_key) ${
      kind === 'alert-email'
        ? sql`do nothing`
        : sql`
      do update set payload = excluded.payload, state = 'pending', attempts = 0,
        run_after = now(), lease_token = null, lease_until = null, updated_at = now()
      where notification_jobs.state = 'canceled' or (
        ${kind} = 'brief' and notification_jobs.state = 'complete'
        and exists (select 1 from notification_jobs as email
          where email.logical_key = notification_jobs.logical_key || '-email' and email.state = 'canceled')
      )`
    }`;
}
