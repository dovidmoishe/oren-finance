import { validate } from 'class-validator';
import { ChartQueryDto } from './stocks.controller';
import { MarketService } from './market.service';

describe('technical chart intervals', () => {
  it('validates interval query values', async () => {
    const query = new ChartQueryDto();
    query.interval = '1H';
    expect(await validate(query)).toEqual([]);
    query.interval = 'invalid' as never;
    expect(await validate(query)).toHaveLength(1);
  });

  it('separates interval cache entries and reuses matching requests', async () => {
    const tokens = {
      getCandlesForWindow: jest.fn().mockResolvedValue([]),
      getPriceChart: jest.fn().mockResolvedValue([]),
    };
    const catalog = {
      findByAssetIds: jest
        .fn()
        .mockResolvedValue([{ id: 'nvidia', ticker: 'NVDA' }]),
    };
    const service = new MarketService(tokens as never, catalog as never);
    await Promise.all([
      service.getChart('nvidia', '1W', '1H'),
      service.getChart('nvidia', '1W', '1H'),
    ]);
    expect(tokens.getCandlesForWindow).toHaveBeenCalledTimes(1);
    await service.getChart('nvidia', '1W', '5m');
    expect(tokens.getCandlesForWindow).toHaveBeenCalledTimes(2);
    await service.getChart('nvidia', '1W');
    expect(tokens.getPriceChart).toHaveBeenCalledWith('nvidia', '1W');
  });
});
