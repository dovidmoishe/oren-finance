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
import { PAPER_QUOTES } from './quotes';
import { DAY, decide, settle } from './strategy';

// HTTP tests inject two test identities. Keep the external identity SDK out of Jest.
jest.mock('@privy-io/node', () => ({ PrivyClient: jest.fn() }));

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
    const tokens = {
      getStock: (id: string) => ({
        id,
        variants: [{ mint: 'stock', tradable: true }],
      }),
      getOHLCV: () =>
        closes.map((close, i) => ({
          timestamp: new Date(today + (i - 22) * DAY),
          open: close,
          high: close,
          low: close,
          close,
        })),
    };
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
      const module = await Test.createTestingModule({
        controllers: [PaperController],
        providers: [
          PaperService,
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
      const due = () =>
        client`update paper_runs set next_at=now() where id=${id}`;
      await due();
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
      await waiting;
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
      await due();
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
      await service.tick();
      const result = await service.activity('bob', run.id);
      expect(result.run.lastError).toBe('route_or_fill_unavailable');
      expect(result.run.book).toEqual({ cash: '10000000000', position: '0' });
      expect(result.events).toHaveLength(1);
    });
  },
);
