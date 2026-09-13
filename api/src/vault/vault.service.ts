import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { TokenizedEquity } from '../../types/equity';
import type { TokenAccount } from '../../types/providers/alchemy-provider';
import type {
  ConfirmLockRequest,
  ConfirmUnlockRequest,
  ConfirmVaultResponse,
  LockIntent,
  PreparedVaultTransaction,
  UnlockIntent,
  VaultPosition,
  VaultSummary,
} from '../../types/vault';
import { AlchemyService } from '../alchemy/alchemy.service';
import { InvalidWalletAddressError } from '../common/errors/provider.errors';
import { PortfolioService } from '../portfolio/portfolio.service';
import { TokensService } from '../tokens/tokens.service';
import {
  decimalToRaw,
  VaultTransactionBuilder,
} from './vault-transaction.builder';
import {
  rowToVaultPosition,
  VaultRepository,
  type VaultPositionRow,
} from './vault.repository';
import { PublicKey } from '@solana/web3.js';

@Injectable()
export class VaultService {
  private readonly logger = new Logger(VaultService.name);

  constructor(
    private readonly repository: VaultRepository,
    private readonly builder: VaultTransactionBuilder,
    private readonly alchemy: AlchemyService,
    private readonly portfolio: PortfolioService,
    private readonly tokens: TokensService,
  ) {}

  async listVaults(walletAddress: string): Promise<VaultSummary> {
    const wallet = assertPublicKey(walletAddress, 'wallet');
    const rows = await this.repository.listByOwner(wallet);
    const positions = await this.enrich(rows);
    return {
      walletAddress: wallet,
      totalLockedValueUsd: positions.reduce(
        (sum, position) => sum + (position.valueUsd ?? 0),
        0,
      ),
      positions,
    };
  }

  async prepareLock(input: LockIntent): Promise<PreparedVaultTransaction> {
    const wallet = assertPublicKey(input.wallet, 'wallet');
    const unlockAt = toDate(input.unlockAt);
    if (unlockAt.getTime() <= Date.now()) {
      throw new BadRequestException('unlockAt must be in the future');
    }
    if (!Number.isFinite(input.amount) || input.amount <= 0) {
      throw new BadRequestException('amount must be > 0');
    }

    const selected = await this.selectLockVariant(wallet, input);
    const tokenProgramId =
      selected.account.programId ??
      (await this.builder.getTokenProgramId(selected.mint));
    const amountRaw = decimalToRaw(input.amount, selected.account.decimals);

    const built = await this.builder.buildLock({
      wallet,
      mint: selected.mint,
      userTokenAccount: selected.account.address,
      tokenProgramId,
      amountRaw,
      unlockAt,
    });

    return {
      wallet,
      transaction: built.transaction,
      lockAddress: built.lockAddress,
      tokenVaultAddress: built.tokenVaultAddress,
      unlockAt,
      amount: input.amount,
      mint: selected.mint,
      assetId: selected.assetId,
      ticker: selected.ticker,
    };
  }

  async confirmLock(input: ConfirmLockRequest): Promise<ConfirmVaultResponse> {
    const wallet = assertPublicKey(input.wallet, 'wallet');
    const signature = assertNonEmpty(input.signature, 'signature');
    await this.assertConfirmed(signature);

    await this.repository.upsertLock({
      ...input,
      wallet,
      signature,
      unlockAt: toDate(input.unlockAt),
    });
    await this.repository.recordExecution({
      walletAddress: wallet,
      type: 'lock',
      assetId: input.assetId,
      ticker: input.ticker,
      tokenMint: input.mint,
      amount: input.amount,
      transactionSignature: signature,
    });

    return this.confirmResponse(wallet, input.lockAddress, signature);
  }

  async prepareUnlock(input: UnlockIntent): Promise<PreparedVaultTransaction> {
    const wallet = assertPublicKey(input.wallet, 'wallet');
    const lockAddress = assertPublicKey(input.lockAddress, 'lockAddress');
    const row = await this.getIndexedPosition(wallet, lockAddress);
    if (row.unlockAt.getTime() > Date.now()) {
      throw new BadRequestException('Vault position is still locked');
    }

    const tokenProgramId = await this.builder.getTokenProgramId(row.mint);
    const built = await this.builder.buildUnlock({
      wallet,
      mint: row.mint,
      tokenProgramId,
    });
    if (built.lockAddress !== row.lockAddress) {
      throw new BadRequestException('Indexed lock does not match vault PDA');
    }

    return {
      wallet,
      transaction: built.transaction,
      lockAddress: built.lockAddress,
      tokenVaultAddress: built.tokenVaultAddress,
      unlockAt: row.unlockAt,
      amount: Number(row.amount),
      mint: row.mint,
      assetId: row.assetId ?? undefined,
      ticker: row.ticker ?? undefined,
    };
  }

  async confirmUnlock(
    input: ConfirmUnlockRequest,
  ): Promise<ConfirmVaultResponse> {
    const wallet = assertPublicKey(input.wallet, 'wallet');
    const lockAddress = assertPublicKey(input.lockAddress, 'lockAddress');
    const signature = assertNonEmpty(input.signature, 'signature');
    await this.assertConfirmed(signature);

    const row = await this.getIndexedPosition(wallet, lockAddress);
    await this.repository.removeLock(wallet, lockAddress);
    await this.repository.recordExecution({
      walletAddress: wallet,
      type: 'unlock',
      assetId: row.assetId ?? undefined,
      ticker: row.ticker ?? undefined,
      tokenMint: row.mint,
      amount: Number(row.amount),
      transactionSignature: signature,
    });

    return this.confirmResponse(wallet, lockAddress, signature);
  }

  private async selectLockVariant(wallet: string, input: LockIntent): Promise<{
    mint: string;
    account: TokenAccount;
    assetId?: string;
    ticker?: string;
  }> {
    const [portfolio, accounts] = await Promise.all([
      this.portfolio.getPortfolio(wallet),
      this.alchemy.getTokenAccounts(wallet),
    ]);
    const requested = (input.assetId ?? input.asset).trim().toLowerCase();
    const requestedMint = input.mint?.trim();
    const position = portfolio.positions.find((p) => {
      if (requestedMint && p.variants?.some((v) => v.variant.mint === requestedMint)) {
        return true;
      }
      return (
        p.assetId.toLowerCase() === requested ||
        p.ticker.toLowerCase() === requested ||
        p.name.toLowerCase() === requested
      );
    });

    if (!position) {
      throw new BadRequestException('No matching portfolio position to lock');
    }

    const variant = position.variants?.find((entry) => {
      if (requestedMint && entry.variant.mint !== requestedMint) return false;
      return entry.availableAmount >= input.amount;
    });
    if (!variant) {
      throw new BadRequestException('Insufficient available amount to lock');
    }

    const account = accounts.find(
      (acct) =>
        acct.mint === variant.variant.mint &&
        acct.uiAmount >= input.amount,
    );
    if (!account) {
      throw new BadRequestException('No wallet token account found for lock');
    }

    return {
      mint: variant.variant.mint,
      account,
      assetId: position.assetId,
      ticker: position.ticker,
    };
  }

  private async enrich(rows: VaultPositionRow[]): Promise<VaultPosition[]> {
    const mints = [...new Set(rows.map((row) => row.mint))];
    const snapshots = await this.tokens.getMarketSnapshots(mints).catch((err) => {
      this.logger.warn(
        `vault market snapshots failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return [];
    });
    const priceByMint = new Map<string, number | undefined>();
    for (const snapshot of snapshots) {
      if (snapshot.mint) priceByMint.set(snapshot.mint, snapshot.price);
    }

    const positions = await Promise.all(
      rows.map(async (row) => {
        const position = rowToVaultPosition(row);
        let variant: TokenizedEquity | undefined;
        let name: string | undefined;
        try {
          const equity = await this.tokens.resolveMint(row.mint);
          variant = equity?.variants.find((v) => v.mint === row.mint);
          name = equity?.name;
          position.assetId = position.assetId ?? equity?.id;
          position.ticker = position.ticker ?? equity?.ticker;
        } catch {
          // enrichment is optional; indexed lock remains useful
        }
        const price = priceByMint.get(row.mint);
        return {
          ...position,
          variant,
          name,
          valueUsd:
            typeof price === 'number' ? Number(row.amount) * price : undefined,
          daysRemaining: Math.max(
            0,
            Math.ceil((row.unlockAt.getTime() - Date.now()) / 86_400_000),
          ),
        };
      }),
    );

    return positions.sort((a, b) => a.unlockAt.getTime() - b.unlockAt.getTime());
  }

  private async getIndexedPosition(
    wallet: string,
    lockAddress: string,
  ): Promise<VaultPositionRow> {
    const row = await this.repository.findByOwnerAndLockAddress(
      wallet,
      lockAddress,
    );
    if (!row) throw new BadRequestException('Vault position not found');
    return row;
  }

  private async assertConfirmed(signature: string): Promise<void> {
    const status = await this.alchemy.getTransactionStatus(signature);
    if (status !== 'confirmed' && status !== 'finalized') {
      throw new BadRequestException(`Transaction is not confirmed: ${status}`);
    }
  }

  private async confirmResponse(
    wallet: string,
    lockAddress: string,
    signature: string,
  ): Promise<ConfirmVaultResponse> {
    let portfolioRefreshed = false;
    try {
      await this.portfolio.getPortfolio(wallet);
      portfolioRefreshed = true;
    } catch (err) {
      this.logger.warn(
        `Post-vault portfolio refresh failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    return {
      wallet,
      lockAddress,
      signature,
      status: 'confirmed',
      portfolioRefreshed,
    };
  }
}

function assertPublicKey(value: string, field: string): string {
  const trimmed = assertNonEmpty(value, field);
  try {
    return new PublicKey(trimmed).toBase58();
  } catch {
    throw new InvalidWalletAddressError(`${field} must be a valid public key`);
  }
}

function assertNonEmpty(value: string, field: string): string {
  if (!value?.trim()) throw new BadRequestException(`${field} is required`);
  return value.trim();
}

function toDate(value: Date | string): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException('Invalid date');
  }
  return date;
}
