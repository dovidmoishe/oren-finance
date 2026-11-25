import { INestApplication, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import request from 'supertest';
import { PrivyWalletAuth } from '../auth/privy-wallet-auth';
import { APP_ENV, DRIZZLE } from '../config/constants';
import * as schema from '../database/schema';
import { TokensService } from '../tokens/tokens.service';
import { PaperController } from './paper.controller';
import { PaperService } from './paper.service';
import { MarketBenchmark } from './market-benchmark';
import { MarketService } from '../market/market.service';
import { PaperResearchAgent } from './paper-research';
import { PreviewBenchmark } from './preview-benchmark';
import type { AppEnv } from '../config/env.schema';
import { PAPER_QUOTES } from './quotes';
import { DAY, HOUR, decide, settle } from './strategy';

// HTTP tests inject two test identities. Keep the external identity SDK out of Jest.
jest.mock('@privy-io/node', () => ({ PrivyClient: jest.fn() }));

jest.setTimeout(30000);
const url = process.env.PAPER_TEST_DATABASE_URL;
(url ? describe : describe.skip)(
  'paper HTTP workflow on isolated PostgreSQL',
  () => {
    let app: INestApplication<Server>,
      client: ReturnType<typeof postgres>,
      admin: ReturnType<typeof postgres>;
    let service: PaperService;
    const namespace = 'paper_test_' + randomUUID().replaceAll('-', '');
    const getQuote = jest.fn();
    const auth = {
      requireAccountIdentity: (header: string) => {
        if (!['Bearer alice', 'Bearer bob'].includes(header))
          throw new UnauthorizedException();
        return { userId: header.slice(7) };
      },
    };
    const today = Math.floor(Date.now() / DAY) * DAY;
    let closes = [...Array<number>(20).fill(100), 110];
    let hourlyEnd = Math.floor(Date.now() / HOUR) * HOUR - HOUR;
    const tokens = {
      getStock: (id: string) => ({
        id,
        variants: [{ mint: 'stock', tradable: true }],
      }),
      getOHLCV: (_asset: string, params?: { timeframe?: string }) =>
        closes.map((close, i) => ({
          timestamp: new Date(
            params?.timeframe === '1H'
              ? hourlyEnd + (i - 20) * HOUR
              : today + (i - 22) * DAY,
          ),
          open: close,
          high: close,
          low: close,
          close,
        })),
    };
    const makeDue = (id: string) =>
      client`update paper_runs set next_at = now() - interval '1 minute' where id=${id}`;
    beforeAll(async () => {
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url!).hostname))
        throw new Error('Use a disposable local database');
      admin = postgres(url!);
      await admin.unsafe('create schema ' + namespace);
      client = postgres(url!, { connection: { search_path: namespace } });
      await client.unsafe(
        readFileSync(
          resolve(__dirname, '../../lib/db/migrations/0025_paper_trading.sql'),
          'utf8',
        ),
      );
      await client.unsafe(
        readFileSync(
          resolve(
            __dirname,
            '../../lib/db/migrations/0026_paper_market_benchmark.sql',
          ),
          'utf8',
        ),
      );
      await client.unsafe(
        readFileSync(
          resolve(
            __dirname,
            '../../lib/db/migrations/0027_paper_ai_accounts.sql',
          ),
          'utf8',
        ),
      );
      await client`insert into paper_ai_accounts (account_id,state,epoch,next_at,rounds) values ('old','{"cash":"999","positions":{}}',1,now()+interval '48 hours','[{"epoch":0},{"epoch":1}]')`;
      await client.unsafe(
        readFileSync(
          resolve(
            __dirname,
            '../../lib/db/migrations/0028_paper_hourly_reviews.sql',
          ),
          'utf8',
        ),
      );
      const [migrated] =
        await client`select epoch, state, rounds, extract(epoch from next_at - started_at)/3600 as due_hour from paper_ai_accounts where account_id='old'`;
      expect(migrated).toMatchObject({
        epoch: 24,
        state: { cash: '999' },
        rounds: [
          { epoch: 0, method: 'daily-v1' },
          { epoch: 24, method: 'daily-v1' },
        ],
      });
      expect(Number(migrated.due_hour)).toBe(25);
      await client`delete from paper_ai_accounts where account_id='old'`;
      const module = await Test.createTestingModule({
        controllers: [PaperController],
        providers: [
          PaperService,
          MarketBenchmark,
          {
            provide: MarketService,
            useValue: {
              listStocks: (page: number) => ({
                items: [
                  {
                    id: 'asset-' + page,
                    ticker: 'A' + page,
                    liquidity: 3 - page,
                    volume24h: page,
                    priceChange24h: page,
                  },
                ],
                pagination: { total: 2, hasMore: page < 2 },
              }),
            },
          },
          {
            provide: PaperResearchAgent,
            useValue: {
              shortlist: jest.fn(() => ['asset-1', 'asset-2']),
              investigate: jest.fn(() => ({
                signal: 'buy',
                research: { tools: ['inspectSignals'] },
              })),
            },
          },
          { provide: PrivyWalletAuth, useValue: auth },
          { provide: APP_ENV, useValue: { PAPER_TRADING_ENABLED: true } },
          { provide: DRIZZLE, useValue: drizzle(client, { schema }) },
          { provide: TokensService, useValue: tokens },
          { provide: PAPER_QUOTES, useValue: { getQuote } },
        ],
      }).compile();
      app = module.createNestApplication();
      app.setGlobalPrefix('api');
      await app.init();
      service = app.get(PaperService);
    });
    it('runs independent AI calls for all five funded accounts and preserves earlier studies', async () => {
      const markets = app.get(MarketBenchmark);
      const env = {
        DEPLOYMENT_ENV: 'preview',
        PREVIEW_PR_NUMBER: 142,
      } as AppEnv;
      const fixture = new PreviewBenchmark(env, service, markets);
      const disabled = new PreviewBenchmark(
        { ...env, DEPLOYMENT_ENV: 'production' },
        service,
        markets,
      );
      await disabled.poll();
      await expect(disabled.report()).rejects.toThrow();
      const original = await service.start(
        'fixture:paper:pr-142',
        'nvidia',
        'buy-hold-v1',
      );
      await client`insert into paper_market_accounts(policy,state) values ('breakout', '{"cash":"777","positions":{}}'::jsonb)`;
      await client`insert into paper_market_screens(epoch,universe) values (0,'[]'::jsonb)`;
      const agent = jest.mocked(app.get(PaperResearchAgent));
      agent.shortlist
        .mockRejectedValueOnce(new Error('provider timeout'))
        .mockResolvedValueOnce([]);
      getQuote.mockImplementation(
        (p: {
          inputMint: string;
          outputMint: string;
          amount: string;
          slippageBps: number;
        }) => ({
          ...p,
          swapMode: 'ExactIn',
          inAmount: p.amount,
          outAmount: p.amount,
          otherAmountThreshold: String((BigInt(p.amount) * 995n) / 1000n),
          routePlan: [{}],
        }),
      );
      await Promise.all([fixture.poll(), fixture.poll()]);
      const report = await fixture.report();
      expect(report.totalStartingUsdc).toBe(50000);
      expect(report.accounts).toHaveLength(5);
      expect(report.coverage[0].count).toBe(2);
      expect(
        (await service.activity('fixture:paper:pr-142', original.id)).run
          .active,
      ).toBe(false);
      expect(report.experiment).toBe('five-ai-v1');
      expect(report.accounts.map((a) => a.accountId)).toEqual([
        'trader-1',
        'trader-2',
        'trader-3',
        'trader-4',
        'trader-5',
      ]);
      expect(report.archivedMixed).toMatchObject([
        { policy: 'breakout', book: { cash: '777' } },
      ]);
      expect(agent.shortlist.mock.calls).toHaveLength(5);
      expect(agent.investigate.mock.calls).toHaveLength(6);
      for (const [universe, book] of agent.shortlist.mock.calls) {
        expect(universe.map((r) => r.id)).toEqual(['asset-1', 'asset-2']);
        expect(book).toHaveProperty('positions');
      }
      expect(
        report.accounts.every(
          (a) => a.policy === 'guided' && a.rounds.length === 1,
        ),
      ).toBe(true);
      const invested = report.accounts.filter(
        (a) => Object.keys(a.book.positions).length === 2,
      );
      expect(invested).toHaveLength(3);
      for (const a of invested) {
        expect(a.book.cash).toBe('8099981000');
        expect(
          a.rounds[0].observations.every((o) =>
            o.research?.tools.includes('inspectSignals'),
          ),
        ).toBe(true);
      }
      const flat = report.accounts.filter(
        (a) => Object.keys(a.book.positions).length === 0,
      );
      expect(flat).toHaveLength(2);
      expect(flat.every((a) => a.book.cash === '10000000000')).toBe(true);
      expect(
        flat.filter((a) => a.rounds[0].screenError === 'shortlist_unavailable'),
      ).toHaveLength(1);
      await new PreviewBenchmark(env, service, markets).poll();
      expect((await fixture.report()).accounts).toEqual(report.accounts);
      const advance = async (hour: number) => {
        await client`update paper_ai_accounts set started_at=now()-make_interval(hours => ${hour}::int), next_at=now()`;
        await fixture.poll();
      };
      await advance(1);
      expect(agent.shortlist.mock.calls).toHaveLength(6); // Only the failed shortlist retries.
      expect(agent.investigate.mock.calls).toHaveLength(8); // Only that account has new evidence.
      const repeated = (await fixture.report()).accounts.find(
        (a) => a.accountId === invested[0].accountId,
      )!;
      expect(repeated.book).toEqual(invested[0].book);
      expect(
        repeated.rounds
          .at(-1)
          ?.observations.every((o) => o.repeatedBar && !o.filled),
      ).toBe(true);
      hourlyEnd -= 4 * HOUR;
      await advance(2);
      const stale = (await fixture.report()).accounts.find(
        (a) => a.accountId === invested[0].accountId,
      )!;
      expect(
        stale.rounds
          .at(-1)
          ?.observations.every(
            (o) => o.error === 'insufficient_recent_hourly_bars' && !o.filled,
          ),
      ).toBe(true);
      expect(stale.rounds.at(-1)?.equityRaw).not.toBeNull();
      await advance(4);
      expect(agent.shortlist.mock.calls).toHaveLength(11);
      await client`update paper_ai_accounts set started_at=started_at-interval '3 days',next_at=now()`;
      await fixture.poll();
      expect(
        (await fixture.report()).accounts.every(
          (a) =>
            a.status === 'ended' &&
            a.rounds.at(-1)?.observations.every((o) => !o.filled),
        ),
      ).toBe(true);
      expect(agent.shortlist.mock.calls).toHaveLength(11);
      expect(agent.investigate.mock.calls).toHaveLength(8);
    });
    afterAll(async () => {
      await app?.close();
      await client?.end();
      if (admin) {
        await admin.unsafe('drop schema if exists ' + namespace + ' cascade');
        await admin.end();
      }
    });
    it('owns each book, serializes duplicate starts and polls, replays both legs, and fences paused claims', async () => {
      const api = request(app.getHttpServer());
      const path = '/api/me/paper-runs';
      const body = { assetId: 'nvidia', strategy: 'breakout-v1' };
      await api.post(path).send(body).expect(401);
      await api
        .post(path)
        .set('Authorization', 'Bearer alice')
        .send({ ...body, ownerId: 'bob' })
        .expect(400);
      const runs = await Promise.all(
        [1, 2].map(() =>
          api
            .post(path)
            .set('Authorization', 'Bearer alice')
            .send(body)
            .expect(201),
        ),
      );
      const [first, repeated] = runs.map(
        (response) => response.body as { id: string },
      );
      expect(first.id).toBe(repeated.id);
      const id = first.id;
      const detail = path + '/' + id;
      const read = async () => {
        const response = await api
          .get(detail)
          .set('Authorization', 'Bearer alice')
          .expect(200);
        return response.body as Awaited<ReturnType<PaperService['activity']>>;
      };
      await api.get(detail).set('Authorization', 'Bearer bob').expect(404);
      await api
        .put(detail + '/active')
        .set('Authorization', 'Bearer bob')
        .send({ active: false })
        .expect(404);
      const quote = (p: {
        inputMint: string;
        outputMint: string;
        amount: string;
        slippageBps: number;
      }) => ({
        ...p,
        swapMode: 'ExactIn',
        inAmount: p.amount,
        outAmount: p.inputMint === 'stock' ? '1100000000' : '1000000',
        otherAmountThreshold: p.inputMint === 'stock' ? '1094500000' : '995000',
        routePlan: [{}],
      });
      getQuote.mockImplementation(quote);
      await makeDue(id);
      await Promise.all([service.tick(), service.tick()]);
      const bought = await read();
      expect(bought.events).toHaveLength(1);
      expect(bought.run.book).toEqual({
        cash: '8999990000',
        position: '993010',
      });
      const evidence = bought.events[0].evidence;
      expect(decide(evidence.strategy, evidence.rows, evidence.before)).toBe(
        'buy',
      );
      const boughtBook = settle(
        evidence.before,
        evidence.signal,
        evidence.terms,
      ).book;
      expect(settle(boughtBook, 'hold', evidence.exitMark)).toEqual(
        evidence.result,
      );
      closes.push(80);
      await makeDue(id);
      let started!: () => void, release!: () => void;
      const waiting = new Promise<void>((resolve) => {
        started = resolve;
      });
      const paused = new Promise<void>((resolve) => {
        release = resolve;
      });
      getQuote.mockImplementationOnce(
        async (p: Parameters<typeof quote>[0]) => {
          started();
          await paused;
          return quote(p);
        },
      );
      const inFlight = service.tick();
      await Promise.race([
        waiting,
        inFlight.then(() => {
          throw new Error('Due run finished before requesting its exit quote');
        }),
      ]);
      await api
        .put(detail + '/active')
        .set('Authorization', 'Bearer alice')
        .send({ active: false })
        .expect(200);
      release();
      await inFlight;
      expect((await read()).run.book).toEqual(bought.run.book);
      await api
        .put(detail + '/active')
        .set('Authorization', 'Bearer alice')
        .send({ active: true })
        .expect(200);
      await service.tick();
      const sold = await read();
      expect(sold.events.map((e) => e.evidence.signal)).toEqual([
        'sell',
        'buy',
      ]);
      expect(sold.run.book).toEqual({ cash: '10092291000', position: '0' });
      expect(sold.performance.netPnlUsdcRaw).toBe('92291000');
      await makeDue(id);
      await service.tick();
      expect((await read()).events).toHaveLength(2);
    });
    it('shares the active-run quota across starts and resumes while keeping paused history', async () => {
      const owner = 'quota-test';
      const starts = await Promise.allSettled(
        Array.from({ length: 13 }, (_, i) =>
          service.start(owner, 'stock-' + i, 'breakout-v1'),
        ),
      );
      expect(starts.filter((r) => r.status === 'rejected')).toHaveLength(1);
      const [first] = await service.list(owner);
      await service.setActive(owner, first.id, false);
      await service.start(owner, 'replacement', 'breakout-v1');
      await expect(service.setActive(owner, first.id, true)).rejects.toThrow(
        '12 active runs',
      );
      const runs = await service.list(owner);
      expect(runs.filter((run) => run.active)).toHaveLength(12);
      expect(runs.find((run) => run.id === first.id)?.active).toBe(false);
      await client`update paper_runs set active=false where owner_id=${owner}`;
    });
    it('records a missing exit route and preserves the original cash', async () => {
      closes = [...Array<number>(20).fill(100), 110];
      getQuote
        .mockImplementationOnce(
          (p: {
            inputMint: string;
            outputMint: string;
            amount: string;
            slippageBps: number;
          }) => ({
            ...p,
            swapMode: 'ExactIn',
            inAmount: p.amount,
            outAmount: '1000000',
            otherAmountThreshold: '995000',
            routePlan: [{}],
          }),
        )
        .mockRejectedValueOnce(new Error('unavailable'));
      const run = await service.start('bob', 'nvidia', 'breakout-v1');
      await makeDue(run.id);
      await service.tick();
      const result = await service.activity('bob', run.id);
      expect(result.run.lastError).toBe('route_or_fill_unavailable');
      expect(result.run.book).toEqual({ cash: '10000000000', position: '0' });
      expect(result.events).toHaveLength(1);
    });
  },
);
