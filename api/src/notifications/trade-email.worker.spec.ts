import { tradeReceiptEmail } from './trade-email.worker';

jest.mock('@privy-io/node', () => ({ PrivyClient: jest.fn() }));

describe('tradeReceiptEmail', () => {
  it('formats a confirmed receipt and points to the transaction network', () => {
    const email = tradeReceiptEmail({
      email: 'user@example.com',
      ticker: 'AAPL',
      side: 'buy',
      stockAmount: '1.25',
      usdNotional: '250.50000000',
      blockTime: new Date('2026-11-10T12:00:00.000Z'),
      transactionSignature: 'signature/with?unsafe',
      network: 'devnet',
    });

    expect(email.to).toBe('user@example.com');
    expect(email.subject).toBe('Trade confirmed: buy AAPL');
    expect(email.text).toContain('Amount: 1.25 AAPL');
    expect(email.text).toContain('Trade value: $250.5 USD');
    expect(email.text).toContain('cluster=devnet');
    expect(email.html).toContain('Oren trade receipt');
    expect(email.html).toContain('View transaction');
  });

  it('escapes user-visible fields in the HTML receipt', () => {
    const email = tradeReceiptEmail({
      email: 'user@example.com',
      ticker: '<script>alert(1)</script>',
      side: 'sell',
      stockAmount: '2',
      usdNotional: '10',
      blockTime: new Date('2026-11-10T12:00:00.000Z'),
      transactionSignature: 'signature',
      network: 'mainnet',
    });

    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;');
  });
});
