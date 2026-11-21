import { Logger } from '@nestjs/common';
import { Transaction } from '@solana/web3.js';
import * as spl from '@solana/spl-token';
import { USDC_MINT } from '../config/constants';
import type { AppEnv } from '../config/env.schema';
import { ataRentConfig } from '../config/ata-rent-config';
import { ataRentSwapCompatible } from './ata-rent-sponsor-eligibility';
import type { Quote } from '../../types/quote';
import {
  AtaRentSponsorService,
  type AtaRentReviewContext,
} from './ata-rent-sponsor.service';

jest.mock('@privy-io/node', () => ({ PrivyClient: jest.fn() }));
jest.mock('./ata-rent-sponsor-eligibility', () => ({
  ataRentSwapCompatible: jest.fn(() => true),
}));
jest.mock('@solana/spl-token', () => ({
  ...jest.requireActual<typeof import('../test/solana-spl-token.mock')>(
    '../test/solana-spl-token.mock',
  ),
  ACCOUNT_SIZE: 165,
  ExtensionType: { ImmutableOwner: 7 },
  unpackMint: jest.fn(() => ({
    isInitialized: true,
    tlvData: Buffer.alloc(0),
  })),
  getExtensionTypes: jest.fn(() => []),
  getAccountTypeOfMintType: jest.fn((type: number) => type),
  getAccountLen: jest.fn(() => 170),
  getAssociatedTokenAddressSync: jest.fn(
    (
      mint: { toBase58(): string },
      owner: { toBase58(): string },
      _offCurve: boolean,
      program: { toBase58(): string },
    ) => ({
      toBase58: () =>
        `ata:${owner.toBase58()}:${mint.toBase58()}:${program.toBase58()}`,
    }),
  ),
  createAssociatedTokenAccountIdempotentInstruction: jest.fn(() => ({
    kind: 'create-idempotent',
  })),
}));

const wallet = 'user-wallet-private';
const config = ataRentConfig({
  ATA_RENT_SPONSORSHIP: 'true',
  ATA_RENT_SPONSOR_SIGNER: 'privy',
  ATA_RENT_SPONSOR_PRIVY_WALLET_ID: 'server-wallet',
  ATA_RENT_SPONSOR_ADDRESS: '11111111111111111111111111111111',
  PRIVY_APP_ID: 'test',
  PRIVY_APP_SECRET: 'test-only',
})!;
const context: AtaRentReviewContext = {
  flow: 'user_reviewed',
  userId: 'user-1',
};
function quote(patch: Partial<Quote> = {}): Quote {
  return {
    id: 'quote',
    side: 'buy',
    assetId: 'stock',
    ticker: 'STOCK',
    variant: { mint: 'mint', symbol: 'STOCK', name: 'Stock', tradable: true },
    inputMint: USDC_MINT,
    outputMint: 'mint',
    inputAmount: 10,
    outputAmount: 1,
    inputSymbol: 'USDC',
    outputSymbol: 'STOCK',
    estimatedPriceUsd: 10,
    amountUsd: 10,
    priceImpactPercent: 0,
    slippageBps: 50,
    provider: 'jupiter',
    routePayload: { inAmount: '10000000' },
    quotedAt: new Date(),
    expiresAt: new Date(Date.now() + 30_000),
    ...patch,
  };
}
function fixture(env: Partial<AppEnv> = {}) {
  const attempts = new Set<string>();
  let exists = false;
  const rpc = {
    getAccountInfo: jest.fn((key: { toBase58(): string }) =>
      Promise.resolve(
        key.toBase58() === 'mint'
          ? { owner: spl.TOKEN_PROGRAM_ID }
          : exists
            ? {}
            : null,
      ),
    ),
    getTokenAccountBalance: jest
      .fn()
      .mockResolvedValue({ value: { amount: '10000000' } }),
    getMinimumBalanceForRentExemption: jest.fn().mockResolvedValue(2_039_280),
    getLatestBlockhash: jest
      .fn()
      .mockResolvedValue({ blockhash: 'blockhash', lastValidBlockHeight: 200 }),
    getFeeForMessage: jest.fn().mockResolvedValue({ value: 5000 }),
    getBalance: jest.fn().mockResolvedValue(1_000_000_000),
    sendRawTransaction: jest.fn().mockResolvedValue('signature'),
    getSignatureStatuses: jest.fn().mockResolvedValue({
      value: [{ err: null, confirmationStatus: 'confirmed' }],
    }),
  };
  const repository = {
    reserve: jest.fn((input: { wallet: string; mint: string }) => {
      const key = input.wallet + ':' + input.mint;
      if (attempts.has(key))
        return Promise.resolve({ reason: 'previous_attempt' });
      attempts.add(key);
      return Promise.resolve({ row: { id: 'reservation' } });
    }),
    signature: jest.fn().mockResolvedValue(undefined),
    finish: jest.fn().mockResolvedValue(undefined),
  };
  const signer = { sign: jest.fn().mockResolvedValue('signed') };
  const adapter = { connection: jest.fn().mockReturnValue(rpc) };
  const service = new AtaRentSponsorService(
    {
      ATA_RENT_SPONSORSHIP: true,
      ATA_RENT_CONFIG: { ...config },
      ...env,
    } as AppEnv,
    repository as never,
    signer,
    adapter as never,
  );
  return {
    service,
    repository,
    rpc,
    adapter,
    signer,
    exists: (value: boolean) => {
      exists = value;
    },
  };
}

describe('ATA rent sponsorship', () => {
  let warnSpy: jest.SpyInstance;
  let debugSpy: jest.SpyInstance;
  beforeEach(() => {
    jest.clearAllMocks();
    debugSpy = jest
      .spyOn(Logger.prototype, 'debug')
      .mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    // Signature validation is separately exercised with real web3 in the crypto test.
    jest.spyOn(Transaction, 'from').mockReturnValue({
      serializeMessage: () => Buffer.from('message'),
      verifySignatures: () => true,
      signatures: [{}],
      signature: Buffer.alloc(64, 1),
      serialize: () => Buffer.from('signed'),
    } as never);
    jest
      .spyOn(Transaction.prototype, 'serializeMessage')
      .mockReturnValue(Buffer.from('message'));
    jest
      .spyOn(Transaction.prototype, 'compileMessage')
      .mockReturnValue({} as never);
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('does no RPC, DB or signing work when off', async () => {
    const f = fixture({ ATA_RENT_SPONSORSHIP: false });
    expect(await f.service.cover(quote(), wallet, context, 'swap')).toBe(false);
    expect(f.adapter.connection).not.toHaveBeenCalled();
    expect(f.repository.reserve).not.toHaveBeenCalled();
  });
  it('logs unavailable config once per service and falls back without startup failure', async () => {
    const f = fixture({ ATA_RENT_CONFIG: undefined });
    await f.service.cover(quote(), wallet, context, 'swap');
    await f.service.cover(quote(), wallet, context, 'swap');
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(f.adapter.connection).not.toHaveBeenCalled();
  });
  it.each(['agent', 'mcp', 'delegated', 'limit_order'] as const)(
    'rejects %s flows explicitly',
    async (flow) => {
      const f = fixture();
      expect(await f.service.cover(quote(), wallet, { ...context, flow })).toBe(
        false,
      );
      expect(f.adapter.connection).not.toHaveBeenCalled();
    },
  );
  it('rejects a missing user review context', async () => {
    const f = fixture();
    expect(await f.service.cover(quote(), wallet)).toBe(false);
    expect(f.adapter.connection).not.toHaveBeenCalled();
  });
  it('rejects sells', async () => {
    const f = fixture();
    expect(
      await f.service.cover(quote({ side: 'sell' }), wallet, context, 'swap'),
    ).toBe(false);
    expect(f.signer.sign).not.toHaveBeenCalled();
    expect(
      spl.createAssociatedTokenAccountIdempotentInstruction,
    ).not.toHaveBeenCalled();
  });
  it.each([
    { inputMint: 'other' },
    { assetId: 'unknown' },
    { outputMint: 'other' },
  ])('rejects non-stock or non-USDC routes: %j', async (patch) => {
    const f = fixture();
    expect(await f.service.cover(quote(patch), wallet, context, 'swap')).toBe(
      false,
    );
    expect(f.adapter.connection).not.toHaveBeenCalled();
  });
  it('uses exact routed USDC input, not a client amountUsd, for the minimum', async () => {
    const f = fixture();
    expect(
      await f.service.cover(
        quote({ amountUsd: 1000, routePayload: { inAmount: '4999999' } }),
        wallet,
        context,
      ),
    ).toBe(false);
    expect(f.adapter.connection).not.toHaveBeenCalled();
  });
  it('skips incompatible provider ATA setup without spending or altering the swap', async () => {
    const f = fixture();
    jest.mocked(ataRentSwapCompatible).mockReturnValueOnce(false);
    expect(
      await f.service.cover(quote(), wallet, context, 'non-idempotent-swap'),
    ).toBe(false);
    expect(f.adapter.connection).not.toHaveBeenCalled();
    expect(f.signer.sign).not.toHaveBeenCalled();
    expect(debugSpy).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'incompatible_swap' }),
    );
  });
  it('requires enough USDC for the whole trade', async () => {
    const f = fixture();
    f.rpc.getTokenAccountBalance.mockResolvedValue({
      value: { amount: '9999999' },
    });
    expect(await f.service.cover(quote(), wallet, context, 'swap')).toBe(false);
    expect(f.repository.reserve).not.toHaveBeenCalled();
  });
  it('skips an existing ATA without reserving or spending', async () => {
    const f = fixture();
    f.exists(true);
    expect(await f.service.cover(quote(), wallet, context, 'swap')).toBe(false);
    expect(f.repository.reserve).not.toHaveBeenCalled();
    expect(f.signer.sign).not.toHaveBeenCalled();
    expect(debugSpy).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'already_exists' }),
    );
  });
  it.each(['per_user_cap', 'daily_budget', 'previous_attempt'])(
    'falls back on %s',
    async (reason) => {
      const f = fixture();
      f.repository.reserve.mockResolvedValueOnce({ reason });
      expect(await f.service.cover(quote(), wallet, context, 'swap')).toBe(
        false,
      );
      expect(f.signer.sign).not.toHaveBeenCalled();
    },
  );
  it('preserves a balance floor including rent and fees, warning at most once a minute', async () => {
    const f = fixture();
    f.rpc.getBalance.mockResolvedValue(Number(config.minBalanceLamports) + 100);
    await f.service.cover(quote(), wallet, context, 'swap');
    await f.service.cover(quote(), wallet, context, 'swap');
    expect(f.signer.sign).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith({
      event: 'ata_rent_low_balance',
      reason: 'low_balance',
    });
  });
  it.each([spl.TOKEN_PROGRAM_ID, spl.TOKEN_2022_PROGRAM_ID])(
    'derives and creates with mint owner %s',
    async (program) => {
      const f = fixture();
      f.rpc.getAccountInfo.mockImplementation((key) =>
        Promise.resolve(key.toBase58() === 'mint' ? { owner: program } : null),
      );
      expect(await f.service.cover(quote(), wallet, context, 'swap')).toBe(
        true,
      );
      expect(spl.getAssociatedTokenAddressSync).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        false,
        program,
      );
      expect(
        spl.createAssociatedTokenAccountIdempotentInstruction,
      ).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        program,
      );
      expect(f.rpc.getMinimumBalanceForRentExemption).toHaveBeenCalledWith(
        program === spl.TOKEN_PROGRAM_ID ? 165 : 170,
        'confirmed',
      );
      expect(f.repository.reserve).toHaveBeenCalledWith(
        expect.objectContaining({ lamports: 2044280n }),
      );
      expect(f.repository.signature.mock.invocationCallOrder[0]).toBeLessThan(
        f.rpc.sendRawTransaction.mock.invocationCallOrder[0],
      );
    },
  );
  it('rejects an unsupported mint owner', async () => {
    const f = fixture();
    f.rpc.getAccountInfo.mockResolvedValue({
      owner: { toBase58: () => 'other' },
    } as never);
    expect(await f.service.cover(quote(), wallet, context, 'swap')).toBe(false);
    expect(f.signer.sign).not.toHaveBeenCalled();
  });
  it('never retries the pair even if its account has since been closed', async () => {
    const f = fixture();
    expect(await f.service.cover(quote(), wallet, context, 'swap')).toBe(true);
    f.exists(false);
    expect(await f.service.cover(quote(), wallet, context, 'swap')).toBe(false);
    expect(f.signer.sign).toHaveBeenCalledTimes(1);
  });
  it('parallel prepares produce exactly one sponsor submission', async () => {
    const f = fixture();
    const result = await Promise.all(
      Array.from({ length: 8 }, () =>
        f.service.cover(quote(), wallet, context, 'swap'),
      ),
    );
    expect(result.filter(Boolean)).toHaveLength(1);
    expect(f.signer.sign).toHaveBeenCalledTimes(1);
    expect(f.rpc.sendRawTransaction).toHaveBeenCalledTimes(1);
  });
  it('records signer failure and never retries the pair', async () => {
    const f = fixture();
    f.signer.sign.mockRejectedValueOnce(new Error('private-provider-data'));
    expect(await f.service.cover(quote(), wallet, context, 'swap')).toBe(false);
    expect(f.repository.finish).toHaveBeenCalledWith(
      'reservation',
      'failed',
      'sponsor_failure',
    );
    expect(await f.service.cover(quote(), wallet, context, 'swap')).toBe(false);
    expect(f.signer.sign).toHaveBeenCalledTimes(1);
  });
  it('returns on timeout and never broadcasts a late signature', async () => {
    jest.useFakeTimers();
    const f = fixture({ ATA_RENT_CONFIG: { ...config, timeoutMs: 100 } });
    let resolve!: (value: string) => void;
    f.signer.sign.mockReturnValueOnce(
      new Promise<string>((yes) => {
        resolve = yes;
      }),
    );
    const pending = f.service.cover(quote(), wallet, context, 'swap');
    await jest.advanceTimersByTimeAsync(100);
    expect(await pending).toBe(false);
    resolve('signed');
    await jest.advanceTimersByTimeAsync(1);
    expect(f.rpc.sendRawTransaction).not.toHaveBeenCalled();
    expect(f.repository.finish).toHaveBeenCalledWith(
      'reservation',
      'failed',
      'timeout',
    );
  });
  it('times out confirmation, retaining the signature and rejecting retries', async () => {
    jest.useFakeTimers();
    const f = fixture({ ATA_RENT_CONFIG: { ...config, timeoutMs: 100 } });
    f.rpc.getSignatureStatuses.mockResolvedValue({ value: [null] });
    const pending = f.service.cover(quote(), wallet, context, 'swap');
    await jest.advanceTimersByTimeAsync(100);
    expect(await pending).toBe(false);
    expect(f.repository.signature).toHaveBeenCalledTimes(1);
    expect(f.rpc.sendRawTransaction).toHaveBeenCalledTimes(1);
    expect(await f.service.cover(quote(), wallet, context, 'swap')).toBe(false);
    expect(f.rpc.sendRawTransaction).toHaveBeenCalledTimes(1);
  });
  it('accepts a confirmed ATA even if signature indexing lags', async () => {
    const f = fixture();
    f.rpc.sendRawTransaction.mockImplementation(() => {
      f.exists(true);
      return Promise.resolve('signature');
    });
    f.rpc.getSignatureStatuses.mockResolvedValue({ value: [null] });
    expect(await f.service.cover(quote(), wallet, context, 'swap')).toBe(true);
  });
  it('logs structured outcomes without wallet, mint, sponsor or provider error contents', async () => {
    const f = fixture();
    f.signer.sign.mockRejectedValueOnce(new Error(config.address));
    await f.service.cover(quote(), wallet, context, 'swap');
    const logs = JSON.stringify([warnSpy.mock.calls, debugSpy.mock.calls]);
    expect(logs).not.toContain(wallet);
    expect(logs).not.toContain(config.address);
    expect(logs).not.toContain('private-provider-data');
  });
});
