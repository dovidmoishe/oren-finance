import { Injectable, Logger } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { PrivyWalletAuth } from '../auth/privy-wallet-auth';
import { SenviokEmailService } from '../senviok/senviok.service';
import { renderBriefEmail, type BriefEmailFacts } from './brief-email';
import { NotificationJobs, type Job } from './jobs';
import { BRIEF_GRACE_MS } from './schedule';
import { notificationSettings } from './settings';

export function unsubscribeToken(id: string, secret: string) {
  return `${id}.${createHmac('sha256', secret).update(`notifications-v1-${id}`).digest('base64url')}`;
}

export function unsubscribeJobId(token: string, secret: string) {
  const match = /^([\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12})\.[\w-]{43}$/i.exec(
    token,
  );
  if (!match) return null;
  const expected = unsubscribeToken(match[1], secret);
  return timingSafeEqual(Buffer.from(expected), Buffer.from(token))
    ? match[1]
    : null;
}

function render(job: Job, app: string, api: string, secret: string) {
  const stop = `${api}/api/notifications/unsubscribe/${unsubscribeToken(job.id, secret)}`;
  if (job.kind === 'brief-email') {
    return renderBriefEmail(
      job.payload as BriefEmailFacts,
      `${app}/app/settings/preferences`,
      stop,
    );
  }
  const { ticker, variant, mint, price, quoteAt, direction, target, assetId } =
    job.payload as {
      ticker: string;
      variant: string;
      mint: string;
      price: number;
      quoteAt: string;
      direction: string;
      target: string;
      assetId: string;
    };
  return {
    subject: `Oren price alert · ${ticker}`,
    text: [
      `${variant} (${mint}) reached your ${direction} ${target} USD alert.`,
      `Tokens.xyz price: ${price} USD at ${quoteAt}.`,
      `View stock: ${app}/app/stocks/${encodeURIComponent(assetId)}`,
      `Stop price-alert emails: ${stop}`,
    ].join('\n\n'),
  };
}

@Injectable()
export class NotificationDelivery {
  private readonly logger = new Logger(NotificationDelivery.name);

  constructor(
    private readonly jobs: NotificationJobs,
    private readonly auth: PrivyWalletAuth,
    private readonly senviok: SenviokEmailService,
  ) {}

  async send(job: Job) {
    const config = notificationSettings();
    const brief = job.kind === 'brief-email';
    if (
      !(brief ? config.briefs : config.alerts) ||
      !config.pilotUsers.has(job.user_id) ||
      (!brief && !config.alertMints.has(job.payload.mint as string)) ||
      !config.origin ||
      !config.apiOrigin ||
      !config.secret ||
      (brief &&
        Date.now() - new Date(job.payload.scheduled as string).getTime() >
          BRIEF_GRACE_MS)
    ) {
      return this.jobs.update(job, 'canceled');
    }
    // Leave at least one alert slot when there is more than one total slot.
    const total = config.emailPerMinute;
    const briefSlots =
      total > 1 && config.alerts ? Math.floor(total * 0.8) : total;
    if (total === 1 && brief && config.alerts) {
      const pending = await this.jobs.pending('alert-email');
      if (pending.length) return this.jobs.defer(job);
    }
    if (
      !(await this.jobs.budget(
        'senviok',
        total,
        brief ? { name: 'senviok-brief', limit: briefSlots } : undefined,
      ))
    ) {
      return this.jobs.defer(job);
    }
    const { email, wallet } = await this.auth.getNotificationIdentity(
      job.user_id,
      job.payload.wallet as string | null | undefined,
      brief,
    );
    if (
      !email ||
      (brief && (wallet ?? null) !== (job.payload.wallet ?? null)) ||
      (config.fixture && email.toLowerCase() !== config.fixtureRecipient)
    ) {
      return this.jobs.update(job, 'canceled');
    }
    const message = render(job, config.origin, config.apiOrigin, config.secret);
    if (!(await this.jobs.handoff(job)))
      return this.jobs.update(job, 'canceled');

    let result: Awaited<ReturnType<SenviokEmailService['sendEmail']>>;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      if (config.fixture) {
        await this.jobs.update(job, 'accepted', `fixture-${job.id}`);
        return;
      }
      result = await Promise.race([
        this.senviok.sendEmail({ ...message, to: email }),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error('Senviok submission timed out')),
            25_000,
          );
        }),
      ]);
    } catch (error: unknown) {
      const status =
        error && typeof error === 'object' && 'status' in error
          ? error.status
          : undefined;
      // A confirmed throttling response means the request was rejected.
      if (status === 429) {
        this.logger.warn('Senviok throttled notification submissions');
        return this.jobs.retry(job, true);
      }
      if (
        typeof status === 'number' &&
        [400, 401, 403, 404, 422].includes(status)
      ) {
        return this.jobs.failSend(job);
      }
      this.logger.warn('Notification submission outcome is uncertain');
      return this.jobs.update(job, 'uncertain');
    } finally {
      clearTimeout(timeout);
    }
    const id =
      result && 'id' in result && typeof result.id === 'string' && result.id
        ? result.id
        : undefined;
    await this.jobs.update(job, id ? 'accepted' : 'uncertain', id);
  }

  async subscription(token: string, apply: boolean) {
    const { secret } = notificationSettings();
    const id = secret && unsubscribeJobId(token, secret);
    if (!id) return null;
    return this.jobs.db.transaction(async (tx) => {
      const [source] = await tx.execute<{
        user_id: string;
        kind: 'brief-email' | 'alert-email';
      }>(sql`
        select user_id, kind from notification_jobs where id = ${id} and kind in ('brief-email','alert-email')`);
      if (!source || !apply) return source?.kind ?? null;
      const { user_id: userId, kind } = source;
      if (kind === 'brief-email') {
        await tx.execute(
          sql`update user_preferences set morning_brief = false, brief_due_at = null where user_id = ${userId}`,
        );
      } else {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`alerts-${userId}`}))`,
        );
        await tx.execute(sql`update price_alerts set state = 'canceled'
          where user_id = ${userId} and state in ('active','triggered','failed')`);
      }
      await tx.execute(sql`update notification_jobs set state = 'canceled', updated_at = now()
        where user_id = ${userId} and state in ('pending','running')
          and (kind = ${kind} or (${kind} = 'brief-email' and kind = 'brief'))`);
      return kind;
    });
  }
}
