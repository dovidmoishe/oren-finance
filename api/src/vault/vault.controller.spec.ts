import { VaultController } from './vault.controller';

describe('VaultController', () => {
  it('delegates prepare-lock to VaultService', async () => {
    const vault = {
      prepareLock: jest.fn().mockResolvedValue({
        wallet: 'wallet',
        transaction: 'base64',
      }),
    };
    const controller = new VaultController(vault as never);

    await expect(
      controller.prepareLock({
        action: 'lock',
        wallet: 'wallet',
        asset: 'NVDA',
        amount: 1,
        unlockAt: new Date('2027-01-01T00:00:00Z'),
      }),
    ).resolves.toEqual({
      wallet: 'wallet',
      transaction: 'base64',
    });
  });

  it('delegates confirm-unlock to VaultService', async () => {
    const vault = {
      confirmUnlock: jest.fn().mockResolvedValue({
        wallet: 'wallet',
        lockAddress: 'lockbox',
        signature: 'sig',
        status: 'confirmed',
        portfolioRefreshed: true,
      }),
    };
    const controller = new VaultController(vault as never);

    await expect(
      controller.confirmUnlock({
        wallet: 'wallet',
        lockAddress: 'lockbox',
        signature: 'sig',
      }),
    ).resolves.toEqual({
      wallet: 'wallet',
      lockAddress: 'lockbox',
      signature: 'sig',
      status: 'confirmed',
      portfolioRefreshed: true,
    });
  });
});
