import {
  reservationNotionalUsd,
  sellNotionalUsd,
  usdMicros,
} from './trade-budget';

describe('MCP trade budget amounts', () => {
  it('compares six-decimal amounts exactly', () => {
    expect(usdMicros('25')).toBe(25_000_000n);
    expect(usdMicros('0.000001')).toBe(1n);
    expect(usdMicros('50.123456')).toBe(50_123_456n);
    expect(() => usdMicros('1.0000001')).toThrow();
    expect(() => usdMicros('-1')).toThrow();
  });

  it('charges the greater of independent sell valuation and swap proceeds', () => {
    expect(sellNotionalUsd('25.100000', '24.900000')).toBe('25.100000');
    expect(sellNotionalUsd('24.900000', '25.100000')).toBe('25.100000');
    expect(() => sellNotionalUsd('0', '0')).toThrow();
  });

  it('caps sell share input and charges the greater saved or current value', () => {
    const intent = {
      side: 'sell' as const,
      maxInRaw: '1000000',
      amountUsd: null,
      referenceValueUsd: '20.000000',
      quotedProceedsUsd: '19.000000',
    };
    expect(
      reservationNotionalUsd(intent, {
        rawInput: '1000001',
        referenceValueUsd: '21',
        quotedProceedsUsd: '20',
      }),
    ).toBeUndefined();
    expect(
      reservationNotionalUsd(intent, {
        rawInput: '1000000',
        referenceValueUsd: '18',
        quotedProceedsUsd: '19',
      }),
    ).toBe('20.000000');
    expect(
      reservationNotionalUsd(intent, {
        rawInput: '1000000',
        referenceValueUsd: '18',
        quotedProceedsUsd: '22',
      }),
    ).toBe('22.000000');
    expect(
      reservationNotionalUsd(intent, {
        rawInput: '1000000',
        quotedProceedsUsd: '22',
      }),
    ).toBeUndefined();
  });
});
