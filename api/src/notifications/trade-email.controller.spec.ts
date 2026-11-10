import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrivyWalletAuth } from '../auth/privy-wallet-auth';
import { SenviokEmailService } from '../senviok/senviok.service';
import { TradeEmailController } from './trade-email.controller';
import { TradeEmailRepository } from './trade-email.repository';

jest.mock('@privy-io/node', () => ({ PrivyClient: jest.fn() }));

describe('TradeEmailController', () => {
  const auth = {
    requireResearchIdentity: jest.fn(),
  } as unknown as PrivyWalletAuth;
  let senderReady = true;
  const emails = {
    get isConfigured() {
      return senderReady;
    },
  } as SenviokEmailService;
  const repository = {
    enabled: jest.fn(),
    setEnabled: jest.fn(),
  } as unknown as TradeEmailRepository;

  let controller: TradeEmailController;

  beforeEach(() => {
    jest.clearAllMocks();
    senderReady = true;
    auth.requireResearchIdentity = jest.fn().mockResolvedValue({
      userId: 'user-1',
      walletAddress: 'wallet-1',
      email: 'user@example.com',
    }) as never;
    repository.enabled = jest.fn().mockResolvedValue(false) as never;
    repository.setEnabled = jest.fn().mockResolvedValue(undefined) as never;
    controller = new TradeEmailController(auth, emails, repository);
  });

  it('returns the user preference and readiness without exposing auth details', async () => {
    await expect(
      controller.getPreference('wallet-1', 'Bearer token'),
    ).resolves.toEqual({ enabled: false, emailAvailable: true, ready: true });
    expect(auth.requireResearchIdentity).toHaveBeenCalledWith(
      'Bearer token',
      'wallet-1',
    );
  });

  it('persists only a boolean preference for the authenticated user', async () => {
    await expect(
      controller.setPreference('wallet-1', { enabled: true }, 'Bearer token'),
    ).resolves.toEqual({ enabled: true, emailAvailable: true, ready: true });
    expect(repository.setEnabled).toHaveBeenCalledWith('user-1', true);
  });

  it('does not enable receipts without a linked email or configured sender', async () => {
    auth.requireResearchIdentity = jest.fn().mockResolvedValue({
      userId: 'user-1',
      walletAddress: 'wallet-1',
    }) as never;
    await expect(
      controller.setPreference('wallet-1', { enabled: true }),
    ).rejects.toBeInstanceOf(BadRequestException);

    auth.requireResearchIdentity = jest.fn().mockResolvedValue({
      userId: 'user-1',
      walletAddress: 'wallet-1',
      email: 'user@example.com',
    }) as never;
    senderReady = false;
    await expect(
      controller.setPreference('wallet-1', { enabled: true }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(repository.setEnabled).not.toHaveBeenCalled();
  });

  it('rejects malformed preference updates', async () => {
    await expect(
      controller.setPreference('wallet-1', { enabled: 'yes' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
