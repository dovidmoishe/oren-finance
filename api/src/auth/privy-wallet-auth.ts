import { assertFinancialExecutionEnabled } from '../config/deployment';
import {
  ForbiddenException,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrivyClient } from '@privy-io/node';
import {
  sponsoredRequestBody,
  SPONSORED_SOLANA_CHAIN,
} from '../execution/gas-sponsorship';
import { assertSignatureFormat } from '../execution/onchain-transaction';

/** Verifies both the session and the wallet's current association with that user. */
export class PrivyWalletAuth {
  private readonly logger = new Logger(PrivyWalletAuth.name);
  private readonly client?: PrivyClient;

  constructor(
    private readonly appId?: string,
    private readonly appSecret?: string,
  ) {
    if (appId && appSecret) this.client = new PrivyClient({ appId, appSecret });
  }

  private async verifiedUser(authorization: string | undefined) {
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
    return { userId, user };
  }

  async requireWallet(
    authorization: string | undefined,
    wallet: string,
  ): Promise<string> {
    const { userId, user } = await this.verifiedUser(authorization);
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

  async requireResearchIdentity(
    authorization: string | undefined,
    wallet: string,
  ) {
    const { userId, user } = await this.verifiedUser(authorization);
    const linked = user.linked_accounts.some(
      (account) =>
        account.type === 'wallet' &&
        account.chain_type === 'solana' &&
        account.address === wallet,
    );
    if (!linked)
      throw new ForbiddenException('Wallet is not linked to this account');
    return { userId, walletAddress: wallet, email: emailFromPrivyUser(user) };
  }

  async requireAccountIdentity(authorization: string | undefined) {
    const { userId, user } = await this.verifiedUser(authorization);
    const email = emailFromPrivyUser(user);
    const emailVerified = Boolean(
      email &&
      user.linked_accounts.some(
        (account) =>
          account.type === 'email' &&
          account.verified_at > 0 &&
          account.address.toLowerCase() === email.toLowerCase(),
      ),
    );
    return { userId, email, emailVerified };
  }

  async getNotificationIdentity(
    userId: string,
    preferredWallet?: string | null,
    includeWallet = true,
  ) {
    if (!this.client)
      throw new ServiceUnavailableException('Authentication is not configured');
    const user = await this.client.users()._get(userId);
    const email = user.linked_accounts.find(
      (account) =>
        account.type === 'email' &&
        account.verified_at > 0 &&
        account.address.includes('@'),
    );
    const wallets = user.linked_accounts
      .flatMap((account) => {
        if (account.type !== 'wallet' || account.chain_type !== 'solana')
          return [];
        return [
          {
            id: 'id' in account ? account.id : undefined,
            embedded: account.wallet_client_type === 'privy',
            address: account.address,
            verified: account.first_verified_at ?? account.verified_at,
          },
        ];
      })
      .sort(
        (a, b) => a.verified - b.verified || a.address.localeCompare(b.address),
      );
    const linked = preferredWallet
      ? wallets.find((wallet) => wallet.address === preferredWallet)
      : wallets[0];
    let wallet: string | undefined;
    if (linked && includeWallet) {
      if (linked.embedded) {
        if (!linked.id)
          throw new ServiceUnavailableException(
            'Unable to verify brief wallet',
          );
        const owned = await this.client.wallets().get(linked.id);
        if (owned.chain_type !== 'solana' || owned.address !== linked.address)
          throw new ServiceUnavailableException(
            'Unable to verify brief wallet',
          );
      }
      wallet = linked.address;
    }
    return {
      email: email?.type === 'email' ? email.address.trim() : undefined,
      wallet,
    };
  }

  async requireMcpUser(authorization: string | undefined): Promise<string> {
    return (await this.verifiedUser(authorization)).userId;
  }

  /**
   * Best-effort session identity for feature allowlists. A missing or invalid
   * token returns undefined so public agent chat keeps working.
   */
  async tryIdentify(
    authorization: string | undefined,
  ): Promise<{ userId: string; email?: string } | undefined> {
    if (!authorization?.trim()) return undefined;
    try {
      const { userId, user } = await this.verifiedUser(authorization);
      const email = emailFromPrivyUser(user);
      return email ? { userId, email } : { userId };
    } catch {
      return undefined;
    }
  }

  /** Browser OTP session identity for OAuth consent; never returns the token. */
  async requireMcpIdentity(authorization: string | undefined) {
    const { userId, user } = await this.verifiedUser(authorization);
    const account = user.linked_accounts.find(
      (item) =>
        item.type === 'wallet' &&
        item.chain_type === 'solana' &&
        item.wallet_client_type === 'privy' &&
        'id' in item &&
        Boolean(item.id),
    );
    if (
      !account ||
      account.type !== 'wallet' ||
      !('id' in account) ||
      !account.id
    )
      throw new ForbiddenException('An embedded Solana wallet is required');
    const wallet = await this.client!.wallets()
      .get(account.id)
      .catch(() => {
        throw new ServiceUnavailableException(
          'Unable to verify wallet ownership',
        );
      });
    if (wallet.chain_type !== 'solana' || wallet.address !== account.address)
      throw new ForbiddenException('Wallet ownership could not be verified');
    return { userId, walletId: account.id, wallet: wallet.address };
  }

  /** Recheck the exact wallet linked at consent on every MCP resource request. */
  async verifyMcpWallet(userId: string, walletId: string, wallet: string) {
    if (!this.client)
      throw new ServiceUnavailableException('Authentication is not configured');
    const user = await this.client
      .users()
      ._get(userId)
      .catch(() => {
        throw new ServiceUnavailableException(
          'Unable to verify wallet ownership',
        );
      });
    const linked = user.linked_accounts.some(
      (account) =>
        account.type === 'wallet' &&
        account.chain_type === 'solana' &&
        account.wallet_client_type === 'privy' &&
        account.address === wallet &&
        'id' in account &&
        account.id === walletId,
    );
    if (!linked) throw new ForbiddenException('Wallet is no longer linked');
    const owned = await this.client
      .wallets()
      .get(walletId)
      .catch(() => {
        throw new ServiceUnavailableException(
          'Unable to verify wallet ownership',
        );
      });
    if (owned.chain_type !== 'solana' || owned.address !== wallet)
      throw new ForbiddenException('Wallet ownership could not be verified');
  }

  /** Identity for reviewed approvals. External keys never enter Privy's signing API. */
  async requireApprovalWallet(
    authorization: string | undefined,
    wallet: string,
  ) {
    const { userId, user } = await this.verifiedUser(authorization);
    const account = user.linked_accounts.find(
      (item) =>
        item.type === 'wallet' &&
        item.chain_type === 'solana' &&
        item.address === wallet,
    );
    if (!account || account.type !== 'wallet')
      throw new ForbiddenException('Wallet is not linked to this account');
    if (account.wallet_client_type !== 'privy') {
      // Namespaced identity fits the existing durable approval schema. It is
      // never a Privy wallet id and cannot be used for delegated signing.
      return {
        userId,
        walletId: `external:${wallet}`,
        signingMode: 'external' as const,
      };
    }
    if (!('id' in account) || !account.id)
      throw new ForbiddenException(
        'This wallet is not available for server-side signing',
      );
    await this.verifyEmbeddedAddress(account.id, wallet);
    return { userId, walletId: account.id, signingMode: 'privy' as const };
  }

  async requireSigner(authorization: string | undefined, wallet: string) {
    const { userId, user } = await this.verifiedUser(authorization);
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
    await this.verifyEmbeddedAddress(account.id, wallet);
    return {
      userId,
      walletId: account.id,
      token: /^Bearer\s+(\S+)$/i.exec(authorization!)![1],
    };
  }

  private async verifyEmbeddedAddress(walletId: string, wallet: string) {
    const owned = await this.client!.wallets()
      .get(walletId)
      .catch(() => {
        throw new ServiceUnavailableException(
          'Unable to verify wallet ownership',
        );
      });
    if (owned.address !== wallet || owned.chain_type !== 'solana')
      throw new ForbiddenException('Wallet ownership could not be verified');
  }

  signingRequest(
    walletId: string,
    transaction: string,
    approvalId: string,
    expiresAt: Date,
    sponsored = false,
  ) {
    if (!this.appId)
      throw new ServiceUnavailableException('Authentication is not configured');
    return {
      version: 1 as const,
      method: 'POST' as const,
      url: `https://api.privy.io/v1/wallets/${encodeURIComponent(walletId)}/rpc`,
      body: sponsored
        ? sponsoredRequestBody(transaction, approvalId)
        : {
            method: 'signTransaction',
            chain_type: 'solana',
            params: { transaction, encoding: 'base64' },
          },
      headers: {
        'privy-app-id': this.appId,
        'privy-idempotency-key': approvalId,
        'privy-request-expiry': String(expiresAt.getTime()),
      },
    };
  }

  /** This call can broadcast. Callers must durably claim the attempt before invoking it. */
  async sendSponsoredTransaction(
    walletId: string,
    signatures: string[],
    transaction: string,
    referenceId: string,
    expiresAt: Date,
  ) {
    assertFinancialExecutionEnabled();
    if (!this.client)
      throw new ServiceUnavailableException('Authentication is not configured');
    const result = await this.client
      .wallets()
      .solana()
      .signAndSendTransaction(walletId, {
        transaction,
        caip2: SPONSORED_SOLANA_CHAIN,
        sponsor: true,
        reference_id: referenceId,
        authorization_context: { signatures },
        idempotency_key: referenceId,
        request_expiry: expiresAt.getTime(),
      });
    if (result.caip2 !== SPONSORED_SOLANA_CHAIN)
      throw new Error('Unexpected sponsored chain');
    return {
      signature: assertSignatureFormat(result.hash),
      signedTransaction: result.signed_transaction,
    };
  }

  /** Read-only recovery. An empty response never proves that a timed-out send failed. */
  async findSponsoredTransaction(walletId: string, referenceId: string) {
    if (!this.client)
      throw new ServiceUnavailableException('Authentication is not configured');
    const response = await fetch(
      `https://api.privy.io/v1/transactions?${new URLSearchParams({ reference_id: referenceId })}`,
      {
        headers: {
          'privy-app-id': this.appId!,
          Authorization: `Basic ${Buffer.from(`${this.appId}:${this.appSecret}`).toString('base64')}`,
        },
        signal: AbortSignal.timeout(5_000),
      },
    );
    if (!response.ok)
      throw new Error('Sponsored transaction lookup unavailable');
    const result = (await response.json()) as {
      transactions: Array<{
        wallet_id: string;
        reference_id?: string | null;
        caip2: string;
        sponsored?: boolean;
        transaction_hash: string | null;
      }>;
    };
    if (!Array.isArray(result.transactions) || result.transactions.length > 1)
      throw new Error('Ambiguous sponsored transaction recovery');
    const match = result.transactions[0];
    if (!match) return undefined;
    if (
      match.wallet_id !== walletId ||
      match.reference_id !== referenceId ||
      match.caip2 !== SPONSORED_SOLANA_CHAIN ||
      match.sponsored !== true
    )
      throw new Error('Sponsored transaction recovery identity mismatch');
    return match.transaction_hash
      ? assertSignatureFormat(match.transaction_hash)
      : undefined;
  }

  async signTransaction(
    walletId: string,
    authorizationSignature: string,
    transaction: string,
    approvalId: string,
    expiresAt: Date,
  ) {
    assertFinancialExecutionEnabled();
    if (!this.client)
      throw new ServiceUnavailableException('Authentication is not configured');
    try {
      const result = await this.client
        .wallets()
        .solana()
        .signTransaction(walletId, {
          transaction,
          authorization_context: { signatures: [authorizationSignature] },
          idempotency_key: approvalId,
          request_expiry: expiresAt.getTime(),
        });
      return result.signed_transaction;
    } catch (error) {
      // SDK errors may contain request data; never propagate user JWTs or credentials.
      const failure = error as {
        name?: unknown;
        status?: unknown;
        headers?: { get?: (name: string) => string | null };
        error?: { code?: unknown };
      };
      const status =
        typeof failure?.status === 'number' ? failure.status : 'unknown';
      const safe = (value: unknown) =>
        typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,100}$/.test(value)
          ? value
          : 'unknown';
      const code = safe(failure?.error?.code);
      const requestId = safe(failure?.headers?.get?.('x-request-id'));
      this.logger.warn(
        `Privy sign-only request failed: approval=${safe(approvalId)} status=${status} code=${code} requestId=${requestId} type=${safe(failure?.name)}`,
      );
      throw new ServiceUnavailableException({
        message:
          'Privy could not authorize this trade. No transaction was submitted. Sign in again and review a fresh quote.',
        code: 'PRIVY_SIGNING_FAILED',
        submissionState: 'not_submitted',
      });
    }
  }
}

function emailFromPrivyUser(user: unknown): string | undefined {
  if (!user || typeof user !== 'object') return undefined;
  const record = user as {
    email?: { address?: unknown };
    linked_accounts?: unknown;
  };
  const direct = record.email?.address;
  if (typeof direct === 'string' && direct.includes('@')) return direct.trim();
  if (!Array.isArray(record.linked_accounts)) return undefined;
  for (const account of record.linked_accounts) {
    if (!account || typeof account !== 'object') continue;
    const linked = account as { type?: unknown; address?: unknown };
    if (
      linked.type === 'email' &&
      typeof linked.address === 'string' &&
      linked.address.includes('@')
    ) {
      return linked.address.trim();
    }
  }
  return undefined;
}
