import {
  NotFoundException,
  ValidationPipe,
  type INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { IntelligenceService } from '../intelligence/intelligence.service';
import { MarketService } from './market.service';
import { StocksController } from './stocks.controller';

describe('public stock display endpoints', () => {
  let app: INestApplication;
  const candles = [
    { timestamp: '2026-11-27T12:00:00Z', open: 1, high: 2, low: 1, close: 2 },
  ];
  const tokens = {
    getPriceChart: jest.fn(),
    getCandlesForWindow: jest.fn(),
    getStock: jest.fn(),
  };
  const intelligence = { getAnalysis: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    tokens.getPriceChart.mockImplementation((id: string) =>
      id === 'broken'
        ? Promise.reject(new Error('provider unavailable'))
        : Promise.resolve(candles),
    );
    tokens.getCandlesForWindow.mockResolvedValue(candles);
    tokens.getStock.mockImplementation((id: string) =>
      Promise.resolve({ id, ticker: id.toUpperCase() }),
    );
    intelligence.getAnalysis.mockResolvedValue({
      assetId: 'nvidia',
      analyzedAt: '2026-11-27T12:00:00Z',
    });
    const market = new MarketService(
      tokens as never,
      {
        findByAssetIds: jest.fn().mockResolvedValue([]),
      } as never,
    );
    jest.spyOn(market, 'onApplicationBootstrap').mockImplementation(() => {});
    const module = await Test.createTestingModule({
      controllers: [StocksController],
      providers: [
        { provide: MarketService, useValue: market },
        { provide: IntelligenceService, useValue: intelligence },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('accepts at most 20 non-empty ids before dynamic asset routes', async () => {
    const server = app.getHttpServer() as Server;
    const ids = Array.from({ length: 20 }, (_, index) => `stock-${index}`);
    const success = await request(server)
      .get('/stocks/charts')
      .query({ ids: ids.join(','), range: '1D' })
      .expect(200);
    expect(Object.keys(success.body as object)).toHaveLength(20);
    expect(tokens.getPriceChart).toHaveBeenCalledTimes(20);
    for (const query of [
      {},
      { ids: '' },
      { ids: ' , ' },
      { ids: 'nvidia,,tesla' },
      { ids: [...ids, 'extra'].join(',') },
      { ids: ['nvidia', 'tesla'] },
    ]) {
      await request(server).get('/stocks/charts').query(query).expect(400);
    }
    expect(tokens.getPriceChart).toHaveBeenCalledTimes(20);
  });

  it('inherits single-chart range/interval validation and defaults', async () => {
    const server = app.getHttpServer() as Server;
    for (const path of ['/stocks/charts', '/stocks/nvidia/chart']) {
      const ids = path.endsWith('/charts') ? { ids: 'nvidia' } : {};
      await request(server)
        .get(path)
        .query({ ...ids, range: 'invalid' })
        .expect(400);
      await request(server)
        .get(path)
        .query({ ...ids, interval: 'invalid' })
        .expect(400);
      await request(server)
        .get(path)
        .query({ ...ids, range: '1D', interval: '1H' })
        .expect(200);
    }
    expect(tokens.getCandlesForWindow).toHaveBeenCalledTimes(1);
    await request(server)
      .get('/stocks/charts')
      .query({ ids: 'nvidia' })
      .expect(200);
    expect(tokens.getPriceChart).toHaveBeenCalledWith('nvidia', '1M');
  });

  it('omits failed ids while sharing per-id cached/in-flight work with single-chart reads', async () => {
    // Keep the listener open until both requests finish.
    await app.listen(0, '127.0.0.1');
    const server = app.getHttpServer() as Server;
    const [batch, single] = await Promise.all([
      request(server)
        .get('/stocks/charts')
        .query({ ids: 'nvidia,broken,tesla,nvidia', range: '1D' })
        .expect(200),
      request(server)
        .get('/stocks/nvidia/chart')
        .query({ range: '1D' })
        .expect(200),
    ]);
    expect(batch.body).toEqual({
      nvidia: single.body as unknown,
      tesla: { assetId: 'tesla', ticker: 'TESLA', range: '1D', candles },
    });
    expect(tokens.getPriceChart).toHaveBeenCalledTimes(3);
    await request(server)
      .get('/stocks/charts')
      .query({ ids: 'nvidia,tesla', range: '1D' })
      .expect(200);
    expect(tokens.getPriceChart).toHaveBeenCalledTimes(3);
    await request(server)
      .get('/stocks/charts')
      .query({ ids: 'nvidia', range: '1W' })
      .expect(200);
    expect(tokens.getPriceChart).toHaveBeenCalledTimes(4);
  });

  it('sets a short public analysis cache header only after success and supports conditional reads', async () => {
    const server = app.getHttpServer() as Server;
    const response = await request(server)
      .get('/stocks/nvidia/analysis')
      .expect(200);
    expect(response.headers['cache-control']).toBe(
      'public, max-age=30, stale-while-revalidate=120',
    );
    await request(server)
      .get('/stocks/nvidia/analysis')
      .set('If-None-Match', String(response.headers.etag))
      .expect(304);
    intelligence.getAnalysis.mockRejectedValueOnce(
      new NotFoundException('Unknown stock'),
    );
    const error = await request(server)
      .get('/stocks/missing/analysis')
      .expect(404);
    expect(error.headers['cache-control']).toBeUndefined();
    const detail = await request(server).get('/stocks/nvidia').expect(200);
    expect(detail.headers['cache-control']).toBeUndefined();
  });
});
