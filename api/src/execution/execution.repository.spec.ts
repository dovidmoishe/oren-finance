import { ExecutionRepository } from './execution.repository';
import { executions } from '../database/schema';
import { USDC_MINT } from '../config/constants';

describe('execution platform fee persistence', () => {
  it.each([true, false])(
    'stores nullable fee columns (fee=%s)',
    async (enabled) => {
      const returning = jest.fn().mockResolvedValue([{ id: 'execution' }]);
      const values = jest.fn().mockReturnValue({ returning });
      const insert = jest.fn().mockReturnValue({ values });
      const repository = new ExecutionRepository({ insert } as never);
      const fee = { bps: 50, amountRaw: '50000', mint: USDC_MINT };
      await repository.insert({
        walletAddress: 'test-wallet',
        type: 'stock_purchase',
        status: 'awaiting_signature',
        ...(enabled ? { platformFee: fee } : {}),
      });
      expect(insert).toHaveBeenCalledWith(executions);
      expect(values).toHaveBeenCalledWith(
        expect.objectContaining({
          platformFeeBps: enabled ? 50 : undefined,
          platformFeeAmountRaw: enabled ? '50000' : undefined,
          platformFeeMint: enabled ? USDC_MINT : undefined,
        }),
      );
    },
  );
});
