import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import { sql } from 'drizzle-orm';
import { PricePolling } from './alerts';
import { MorningBrief } from './brief';
import { NotificationDelivery } from './delivery';
import { NotificationJobs, type Kind } from './jobs';
import { MINUTE_MS } from './schedule';
import { notificationSettings } from './settings';

const lanes = {
  brief: 2,
  'brief-email': 2,
  'alert-email': 2,
  'price-scan': 1,
} as const;

type Lane = keyof typeof lanes;
const outboxLanes: Kind[] = ['alert-email', 'brief-email', 'brief'];

/** Idle when both features are off. Pilot accounts are required for briefs and for private alerts. */
export function notificationWorkerStartup(
  config: ReturnType<typeof notificationSettings>,
): 'idle' | 'ready' {
  if (!config.briefs && !config.alerts) return 'idle';
  const needsPilot = config.briefs || (config.alerts && !config.alertsPublic);
  if (
    !config.redisUrl ||
    !config.tokensPerMinute ||
    !config.emailPerMinute ||
    (needsPilot && !config.pilotUsers.size)
  ) {
    throw new Error(
      needsPilot
        ? 'Notification Redis, provider budgets and pilot accounts are required'
        : 'Notification Redis and provider budgets are required',
    );
  }
  return 'ready';
}

@Injectable()
export class NotificationWorker
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(NotificationWorker.name);
  private readonly queues = new Map<Lane, Queue<Record<string, never>>>();
  private readonly workers: Worker[] = [];
  private connections: Redis[] = [];
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;
  private lastMinute = -1;

  constructor(
    private readonly jobs: NotificationJobs,
    private readonly brief: MorningBrief,
    private readonly delivery: NotificationDelivery,
    private readonly polling: PricePolling,
  ) {}

  onApplicationBootstrap() {
    const config = notificationSettings();
    if (notificationWorkerStartup(config) === 'idle') {
      this.logger.log('Notification features are disabled');
      // A disabled process should not enter a restart loop under Compose.
      // `restart: unless-stopped` would restart a clean exit, so stay up.
      this.timer = setInterval(() => {}, 60_000);
      return;
    }
    if (!config.redisUrl) {
      throw new Error('Notification Redis and provider budgets are required');
    }
    const producer = new Redis(config.redisUrl, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      commandTimeout: 5000,
    });
    const consumer = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
    this.connections = [producer, consumer];
    for (const connection of this.connections) {
      connection.on('error', () =>
        this.logger.warn('Notification Redis connection unavailable'),
      );
    }
    for (const lane of Object.keys(lanes) as Lane[]) {
      if (!laneEnabled(lane, config)) continue;
      const name = `oren-notification-${lane}`;
      const queue = new Queue<Record<string, never>>(name, {
        connection: producer,
      });
      queue.on('error', () => this.logger.warn(`Queue unavailable: ${lane}`));
      const worker = new Worker(
        name,
        async (item) => {
          if (lane === 'price-scan') {
            const minute = Number(item.id?.replace(/^scan-/, ''));
            if (
              Number.isSafeInteger(minute) &&
              Math.floor(Date.now() / MINUTE_MS) === minute
            ) {
              await this.polling.scan();
            }
            return;
          }
          if (!item.id) return;
          const job = await this.jobs.claim(item.id, lane);
          if (!job) return;
          try {
            if (lane === 'brief') await this.brief.build(job);
            else await this.delivery.send(job);
          } catch {
            // A failure after handoff leaves state "sending". This retry only
            // touches running jobs; the sweeper handles uncertain sends.
            await this.jobs.retry(job);
            this.logger.warn(
              `Notification job failed before completion: ${lane}`,
            );
          }
        },
        { connection: consumer, concurrency: lanes[lane] },
      );
      worker.on('error', () =>
        this.logger.warn(`Worker connection unavailable: ${lane}`),
      );
      worker.on('failed', () => this.logger.warn(`Worker job failed: ${lane}`));
      this.queues.set(lane, queue);
      this.workers.push(worker);
    }
    const tick = () => {
      if (this.running) return;
      this.running = this.dispatch()
        .catch(() => this.logger.warn('Notification dispatch will retry'))
        .finally(() => {
          this.running = undefined;
        });
    };
    this.timer = setInterval(tick, 5000);
    tick();
  }

  private async dispatch() {
    const config = notificationSettings();
    const now = new Date();
    const minute = Math.floor(now.getTime() / MINUTE_MS);
    if (minute !== this.lastMinute) {
      const missed = config.briefs
        ? await this.jobs.schedule(now, config.pilotUsers)
        : 0;
      const uncertain = await this.jobs.sweep();
      const [stats] = await this.jobs.db.execute<{
        pending: number;
        lag: number;
      }>(sql`
        select count(*)::int as pending,
        coalesce(greatest(0, extract(epoch from (now() - min(run_after)))), 0)::int as lag
        from notification_jobs where state = 'pending' and run_after <= now()`);
      this.logger.log(
        `notification queue pending=${stats.pending} lag_seconds=${stats.lag} newly_uncertain=${uncertain} missed_schedules=${missed}`,
      );
      if (minute % 60 === 0) {
        await this.jobs.db.execute(
          sql`delete from notification_budgets where minute < now() - interval '2 days'`,
        );
      }
      this.lastMinute = minute;
    }
    const scan = this.queues.get('price-scan');
    if (scan)
      await scan.add(
        'scan',
        {},
        {
          jobId: `scan-${minute}`,
          removeOnComplete: { age: 300, count: 10 },
          removeOnFail: { age: 300, count: 10 },
        },
      );
    for (const lane of outboxLanes) {
      const queue = this.queues.get(lane);
      if (!queue) continue;
      for (const job of await this.jobs.pending(lane)) {
        await queue.add(
          lane,
          {},
          { jobId: job.id, removeOnComplete: true, removeOnFail: true },
        );
      }
    }
  }

  async onModuleDestroy() {
    clearInterval(this.timer);
    await this.running;
    await Promise.allSettled(this.workers.map((worker) => worker.close()));
    await Promise.allSettled(
      [...this.queues.values()].map((queue) => queue.close()),
    );
    for (const connection of this.connections) connection.disconnect();
  }
}

function laneEnabled(
  lane: Lane,
  config: ReturnType<typeof notificationSettings>,
) {
  return lane === 'brief' || lane === 'brief-email'
    ? config.briefs
    : config.alerts;
}
