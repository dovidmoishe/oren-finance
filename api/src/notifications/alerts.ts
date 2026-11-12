import {
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE } from '../config/constants';
import type { Database } from '../database/database.provider';
import { TokensService } from '../tokens/tokens.service';
import { insertJob, NotificationJobs } from './jobs';
import { crossed, providerQuote, type Quote } from './quotes';
import { notificationSettings } from './settings';

type Alert = {
  id: string;
  user_id: string;
  mint: string;
  asset_id: string;
  ticker: string;
  variant: string;
  direction: 'above' | 'below';
  target: string;
  state: 'active' | 'triggered' | 'canceled';
  created_at: string | Date;
  quote_at: string | Date | null;
  quote_price: string | null;
};

type NewAlert = {
  assetId: string;
  mint: string;
  direction: 'above' | 'below';
  target: string;
};

function parseAlert(body: unknown): NewAlert {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new BadRequestException('Invalid price alert');
  const { assetId, mint, direction, target } = body as Record<string, unknown>;
  if (
    Object.keys(body).length !== 4 ||
    typeof assetId !== 'string' ||
    !/^[\w.-]{1,120}$/.test(assetId) ||
    typeof mint !== 'string' ||
    !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint) ||
    (direction !== 'above' && direction !== 'below') ||
    typeof target !== 'string' ||
    !/^\d{1,12}(?:\.\d{1,8})?$/.test(target) ||
    Number(target) <= 0
  ) {
    throw new BadRequestException(
      'Supply an asset, variant, direction, and positive USD price',
    );
  }
  return { assetId, mint, direction, target };
}

@Injectable()
export class PriceAlerts {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly jobs: NotificationJobs,
  ) {}

  async list(userId: string, eligible: boolean, assetId?: string) {
    const config = notificationSettings();
    const enabled = eligible && config.alerts && config.pilotUsers.has(userId);
    const rows = await this.db.execute<Alert>(sql`select * from price_alerts
      where user_id = ${userId} and state in ('active','triggered')
      ${assetId ? sql`and asset_id = ${assetId}` : sql``}
      order by (state = 'active') desc, created_at desc limit 100`);
    const variants: Array<{ mint: string }> =
      enabled && assetId
        ? await this.db.execute<{ mint: string }>(sql`
      select item->>'mint' as mint from cached_stocks
      cross join lateral jsonb_array_elements(alert_variants) item
      where asset_id = ${assetId} and category = 'equity' and expires_at > now()`)
        : [];
    return {
      enabled,
      variants: variants
        .map(({ mint }) => mint)
        .filter((mint) => config.alertMints.has(mint)),
      alerts: rows.map(toResponse),
    };
  }

  async create(userId: string, eligible: boolean, body: unknown) {
    const config = notificationSettings();
    if (!config.alerts || !config.pilotUsers.has(userId))
      throw new ServiceUnavailableException('Price alerts are unavailable');
    if (!eligible)
      throw new BadRequestException('A verified email is required');
    if (!(await this.jobs.budget(`create-alert-${userId}`, 10)))
      throw new HttpException('Too many alert requests', 429);
    const alert = parseAlert(body);
    if (!config.alertMints.has(alert.mint))
      throw new BadRequestException('This variant is not available for alerts');
    return this.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`alerts-${userId}`}))`,
      );
      const [total] = await tx.execute<{
        count: number;
      }>(sql`select count(*)::integer as count
        from price_alerts where user_id = ${userId} and state = 'active'`);
      if (total.count >= 20)
        throw new ConflictException('You can have up to 20 active alerts');
      const [variant] = await tx.execute<{
        ticker: string;
        symbol: string;
      }>(sql`
        select ticker, item->>'symbol' as symbol from cached_stocks
        cross join lateral jsonb_array_elements(alert_variants) item
        where asset_id = ${alert.assetId} and category = 'equity' and expires_at > now()
          and item->>'mint' = ${alert.mint} limit 1`);
      if (!variant)
        throw new BadRequestException(
          'This variant is not available for alerts',
        );
      const [created] = await tx.execute<Alert>(sql`
        insert into price_alerts (user_id, asset_id, ticker, variant, mint, direction, target)
        values (${userId}, ${alert.assetId}, ${variant.ticker}, ${variant.symbol}, ${alert.mint}, ${alert.direction}, ${alert.target})
        on conflict (user_id, mint, direction, target) where state = 'active' do nothing returning *`);
      if (!created)
        throw new ConflictException('This price alert already exists');
      return toResponse(created);
    });
  }

  async cancel(userId: string, id: string) {
    return this.cancelRules(userId, id);
  }

  async cancelRules(userId: string, id?: string) {
    await this.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`alerts-${userId}`}))`,
      );
      await tx.execute(sql`update price_alerts set state = 'canceled'
        where user_id = ${userId} and state in ('active','triggered')
        ${id ? sql`and id = ${id}` : sql``}`);
      await tx.execute(sql`update notification_jobs set state = 'canceled', updated_at = now()
        where user_id = ${userId} and kind = 'alert-email' and state in ('pending','running')
        ${id ? sql`and logical_key = ${`alert-${id}`}` : sql``}`);
    });
  }
}

function toResponse(alert: Alert) {
  return {
    id: alert.id,
    assetId: alert.asset_id,
    mint: alert.mint,
    ticker: alert.ticker,
    variant: alert.variant,
    direction: alert.direction,
    target: alert.target,
    state: alert.state,
  };
}

@Injectable()
export class PricePolling {
  private readonly logger = new Logger(PricePolling.name);

  constructor(
    private readonly jobs: NotificationJobs,
    private readonly tokens: TokensService,
  ) {}

  async scan() {
    const config = notificationSettings();
    if (!config.alerts || !config.tokensPerMinute || !config.pilotUsers.size)
      return;
    const users = sql.join(
      [...config.pilotUsers].map((id) => sql`${id}`),
      sql`, `,
    );
    const eligibleMints = sql.join(
      [...config.alertMints].map((mint) => sql`${mint}`),
      sql`, `,
    );
    const startedAt = new Date();
    const deadline = startedAt.getTime() + 25_000;
    await this.jobs.db.transaction(async (tx) => {
      const [lock] = await tx.execute<{ acquired: boolean }>(sql`
        select pg_try_advisory_xact_lock(hashtext('notification-price-poll')) as acquired`);
      if (!lock.acquired) return;
      const [cycle] =
        await tx.execute(sql`insert into notification_budgets (scope, minute, used)
        values ('price-cycle', date_trunc('minute', now()), 1) on conflict do nothing returning minute`);
      if (!cycle) return;

      while (Date.now() < deadline) {
        const batch = await tx.execute<{ mint: string }>(sql`
          select a.mint from price_alerts a left join price_poll_cursor p on p.mint = a.mint
          where a.state = 'active' and a.user_id in (${users}) and a.mint in (${eligibleMints})
            and (p.polled_at is null or p.polled_at < ${startedAt.toISOString()})
          group by a.mint, p.polled_at order by p.polled_at nulls first, a.mint limit 250`);
        if (
          !batch.length ||
          !(await this.jobs.budget('tokens-snapshots', config.tokensPerMinute))
        )
          return;
        const mints = new Set(batch.map(({ mint }) => mint));
        const raw = await this.tokens
          .getMarketSnapshots([...mints])
          .catch(() => {
            this.logger.warn(
              'Tokens.xyz snapshot request failed; remaining alert mints are deferred',
            );
            return null;
          });
        if (!raw) return;
        const now = new Date();
        const quotes = new Map<string, Quote>();
        for (const row of raw) {
          const quote = providerQuote(row, now);
          if (
            quote &&
            mints.has(quote.mint) &&
            (!quotes.has(quote.mint) || quotes.get(quote.mint)!.at < quote.at)
          )
            quotes.set(quote.mint, quote);
        }
        for (const mint of mints) {
          await tx.execute(sql`insert into price_poll_cursor values (${mint}, ${startedAt.toISOString()})
            on conflict (mint) do update set polled_at = excluded.polled_at`);
          const current = quotes.get(mint);
          if (!current) continue;
          const rules =
            await tx.execute<Alert>(sql`select * from price_alerts where mint = ${mint}
            and state = 'active' and user_id in (${users}) order by id for update`);
          for (const rule of rules) {
            if (
              current.at < new Date(rule.created_at) ||
              (rule.quote_at && current.at <= new Date(rule.quote_at))
            )
              continue;
            const previous =
              rule.quote_at && rule.quote_price
                ? {
                    at: new Date(rule.quote_at),
                    price: Number(rule.quote_price),
                  }
                : null;
            const fire = crossed(
              rule.direction,
              Number(rule.target),
              previous,
              current,
            );
            await tx.execute(sql`update price_alerts set quote_at = ${current.at.toISOString()},
              quote_price = ${current.price}, state = ${fire ? 'triggered' : 'active'},
              triggered_at = ${fire ? now.toISOString() : null} where id = ${rule.id}`);
            if (fire)
              await tx.execute(
                insertJob(rule.user_id, 'alert-email', `alert-${rule.id}`, {
                  alertId: rule.id,
                  ticker: rule.ticker,
                  variant: rule.variant,
                  mint,
                  assetId: rule.asset_id,
                  price: current.price,
                  quoteAt: current.at.toISOString(),
                  direction: rule.direction,
                  target: rule.target,
                }),
              );
          }
        }
      }
    });
  }
}
