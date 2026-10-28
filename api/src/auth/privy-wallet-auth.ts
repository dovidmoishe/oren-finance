import {
  ForbiddenException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrivyClient } from '@privy-io/node';

/** Verifies both the session and the wallet's current association with that user. */
export class PrivyWalletAuth {
  private readonly client?: PrivyClient;

  constructor(appId?: string, appSecret?: string) {
    if (appId && appSecret) this.client = new PrivyClient({ appId, appSecret });
  }

  async requireWallet(
    authorization: string | undefined,
    wallet: string,
  ): Promise<string> {
    if (!this.client)
      throw new ServiceUnavailableException('Authentication is not configured');
    const match = /^Bearer\s+(\S+)$/i.exec(authorization ?? '');
    if (!match) throw new UnauthorizedException('Authentication required');

    let userId: string;
    try {
      const claims = await this.client
        .utils()
        .auth()
        .verifyAccessToken(match[1]);
      userId = claims.user_id;
    } catch {
      throw new UnauthorizedException('Invalid or expired session');
    }

    let user: Awaited<ReturnType<ReturnType<PrivyClient['users']>['_get']>>;
    try {
      user = await this.client.users()._get(userId);
    } catch {
      throw new ServiceUnavailableException(
        'Unable to verify wallet ownership',
      );
    }
    if (
      !user.linked_accounts.some(
        (account) =>
          account.type === 'wallet' &&
          account.chain_type === 'solana' &&
          account.address === wallet,
      )
    )
      throw new ForbiddenException('Wallet is not linked to this account');
    return userId;
  }

  async requireSigner(authorization: string | undefined, wallet: string) {
    const userId = await this.requireWallet(authorization, wallet);
    const user = await this.client!.users()
      ._get(userId)
      .catch(() => {
        throw new ServiceUnavailableException(
          'Unable to verify wallet ownership',
        );
      });
    const account = user.linked_accounts.find(
      (item) =>
        item.type === 'wallet' &&
        item.chain_type === 'solana' &&
        item.address === wallet,
    );
    if (
      !account ||
      account.type !== 'wallet' ||
      account.wallet_client_type !== 'privy' ||
      !('id' in account) ||
      !account.id
    ) {
      throw new ForbiddenException(
        'This wallet is not available for server-side signing',
      );
    }
    const owned = await this.client!.wallets()
      .get(account.id)
      .catch(() => {
        throw new ServiceUnavailableException(
          'Unable to verify wallet ownership',
        );
      });
    if (owned.address !== wallet || owned.chain_type !== 'solana')
      throw new ForbiddenException('Wallet ownership could not be verified');
    return {
      userId,
      walletId: account.id,
      token: /^Bearer\s+(\S+)$/i.exec(authorization!)![1],
    };
  }

  async signTransaction(
    walletId: string,
    token: string,
    transaction: string,
    approvalId: string,
    expiresAt: Date,
  ) {
    if (!this.client)
      throw new ServiceUnavailableException('Authentication is not configured');
    try {
      const result = await this.client
        .wallets()
        .solana()
        .signTransaction(walletId, {
          transaction,
          authorization_context: { user_jwts: [token] },
          idempotency_key: approvalId,
          request_expiry: expiresAt.getTime(),
        });
      return result.signed_transaction;
    } catch {
      // SDK errors may contain request data; never propagate user JWTs or credentials.
      throw new ServiceUnavailableException(
        'Privy could not authorize this trade. Sign in again and retry.',
      );
    }
  }
}
