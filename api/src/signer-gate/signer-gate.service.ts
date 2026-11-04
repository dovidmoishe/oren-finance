import { createHash, createPublicKey, randomUUID, verify } from 'node:crypto';
import {
  formatRequestForAuthorizationSignature,
  generateAuthorizationSignature,
  PrivyClient,
  type WalletApiRequestSignatureInput,
} from '@privy-io/node';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { Database } from '../database/database.provider';
import {
  mcpConnections,
  mcpBudgetReservations,
  mcpDelegatedExecutions,
  mcpTradeDelegations,
  mcpTradeIntents,
  mcpAuditEvents,
} from '../database/schema';
import { PrivyWalletAuth } from '../auth/privy-wallet-auth';
import {
  reserveTradeBudget,
  settleTradeBudget,
  usdMicros,
} from '../mcp-auth/trade-budget';
import type { JupiterClient } from '../execution/jupiter/jupiter.client';
import type { TokensService } from '../tokens/tokens.service';
import type { ApprovalRpc } from '../execution/approval-rpc.service';
import type { Connection } from '@solana/web3.js';
import { buildGateJupiterRoute } from './gate-jupiter';
import {
  verifyOwnerProof,
  sameGrantTerms,
  type OwnerProof,
  type OwnerMessage,
} from '../mcp-auth/grant-owner-proof';

type Delegation = typeof mcpTradeDelegations.$inferSelect;
type Execution = typeof mcpDelegatedExecutions.$inferSelect;
type PrivyPolicy = Awaited<
  ReturnType<ReturnType<PrivyClient['policies']>['get']>
>;

export interface SignerGateConfig {
  enabled: boolean;
  appId: string;
  appSecret: string;
  apiPublicKeyDerBase64: string;
  gatePrivateKeyDerBase64: string;
  signerQuorumId: string;
  policyId: string;
  policyOwnerId: string;
  policyHash: string;
  allowedUsers: Set<string>;
  buysEnabled: boolean;
  sellsEnabled: boolean;
}

export interface SignerGateDependencies {
  db: Database;
  jupiter: JupiterClient;
  tokens: TokensService;
  rpc: ApprovalRpc;
  connection: Connection;
  privy: PrivyClient;
  auth: PrivyWalletAuth;
}

/** Hash only the owner-reviewed policy semantics, excluding Privy metadata. */
export function gatePolicyFingerprint(policy: PrivyPolicy) {
  const normalized = {
    owner_id: policy.owner_id,
    chain_type: policy.chain_type,
    version: policy.version,
    rules: policy.rules?.map((rule) => ({
      name: rule.name,
      method: rule.method,
      action: rule.action,
      conditions: rule.conditions?.map((item) => ({
        field_source: item.field_source,
        field: item.field,
        operator: item.operator,
        value: item.value,
        idl: 'idl' in item ? (item.idl ?? null) : null,
      })),
    })),
  };
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

function canonical(execution: Execution) {
  return Buffer.from(
    formatRequestForAuthorizationSignature(
      execution.privyRequest as unknown as WalletApiRequestSignatureInput,
    ),
  );
}

/** The gate never accepts an API-supplied transaction, route, wallet, or digest. */
export class SignerGateService {
  constructor(
    private readonly config: SignerGateConfig,
    private readonly deps: SignerGateDependencies,
  ) {}

  private assertEnabled() {
    if (!this.config.enabled) throw new Error('Delegated signing is disabled');
  }

  private async browserOwner(
    proof: OwnerProof,
    action: OwnerMessage['action'],
    requireAllowlist = true,
  ) {
    const owner = verifyOwnerProof(proof, this.config.appId, action);
    await this.deps.auth.verifyMcpWallet(
      owner.userId,
      owner.walletId,
      owner.wallet,
    );
    if (requireAllowlist && !this.config.allowedUsers.has(owner.userId))
      throw new Error('User is not allowlisted for delegated trading');
    return owner;
  }

  private async verifyPolicy() {
    const policy = await this.deps.privy.policies().get(this.config.policyId);
    if (
      policy.owner_id !== this.config.policyOwnerId ||
      policy.chain_type !== 'solana' ||
      policy.rules?.length !== (this.config.sellsEnabled ? 4 : 3) ||
      (this.config.sellsEnabled &&
        !policy.rules.some(
          (rule) => rule.name === 'allow bounded jupiter sell',
        )) ||
      policy.rules.some((rule) => rule.method !== 'signTransaction') ||
      gatePolicyFingerprint(policy) !== this.config.policyHash
    )
      throw new Error('Privy policy differs from owner-reviewed terms');
  }

  async prepareGrant(
    proof: OwnerProof,
    settings: {
      allowSell: boolean;
      perTradeUsd: number;
      dailyUsd: number;
      maxSlippageBps: number;
      durationHours: number;
    },
  ) {
    this.assertEnabled();
    const owner = await this.browserOwner(proof, 'prepare');
    if (
      !owner.terms ||
      owner.signerId !== this.config.signerQuorumId ||
      owner.policyId !== this.config.policyId ||
      owner.terms.perTradeUsd !== settings.perTradeUsd.toFixed(6) ||
      owner.terms.dailyUsd !== settings.dailyUsd.toFixed(6) ||
      owner.terms.maxSlippageBps !== settings.maxSlippageBps ||
      owner.terms.allowSell !== settings.allowSell ||
      new Date(owner.terms.expiresAt).getTime() >
        owner.issuedAt + settings.durationHours * 3_600_000
    )
      throw new Error('Grant differs from wallet-authorized terms');
    if (
      !this.config.buysEnabled ||
      (settings.allowSell && !this.config.sellsEnabled) ||
      !Number.isFinite(settings.perTradeUsd) ||
      settings.perTradeUsd < 0.01 ||
      settings.perTradeUsd > 25 ||
      !Number.isFinite(settings.dailyUsd) ||
      settings.dailyUsd < settings.perTradeUsd ||
      settings.dailyUsd > 50 ||
      !Number.isInteger(settings.maxSlippageBps) ||
      settings.maxSlippageBps < 1 ||
      settings.maxSlippageBps > 50 ||
      !Number.isInteger(settings.durationHours) ||
      settings.durationHours < 1 ||
      settings.durationHours > 24
    )
      throw new Error('Grant terms exceed the owner-only limits');
    const [open] = await this.deps.db
      .select()
      .from(mcpTradeDelegations)
      .where(
        and(
          eq(mcpTradeDelegations.walletId, owner.walletId),
          eq(mcpTradeDelegations.userId, owner.userId),
          eq(mcpTradeDelegations.wallet, owner.wallet),
          inArray(mcpTradeDelegations.status, ['pending_signer', 'active']),
        ),
      )
      .limit(1);
    if (open?.status === 'active' && open.expiresAt > new Date())
      throw new Error('Wallet already has an active delegation');
    if (open?.status === 'pending_signer' && open.expiresAt > new Date()) {
      if (
        open.id !== owner.delegationId ||
        open.perTradeLimitUsd !== owner.terms.perTradeUsd ||
        open.dailyLimitUsd !== owner.terms.dailyUsd ||
        open.maxSlippageBps !== owner.terms.maxSlippageBps ||
        open.allowSell !== owner.terms.allowSell ||
        open.expiresAt.toISOString() !== owner.terms.expiresAt
      )
        throw new Error('Pending grant has different signed terms');
      return {
        delegationId: open.id,
        wallet: open.wallet,
        signerId: open.signerId,
        policyId: open.policyId,
        perTradeUsd: open.perTradeLimitUsd,
        dailyUsd: open.dailyLimitUsd,
        maxSlippageBps: open.maxSlippageBps,
        allowSell: open.allowSell,
        expiresAt: open.expiresAt.toISOString(),
      };
    }
    if (open && open.expiresAt <= new Date())
      await this.deps.db
        .update(mcpTradeDelegations)
        .set({ status: 'expired' })
        .where(eq(mcpTradeDelegations.id, open.id));
    const wallet = await this.deps.privy.wallets().get(owner.walletId);
    if (
      wallet.address !== owner.wallet ||
      wallet.chain_type !== 'solana' ||
      !Array.isArray(wallet.additional_signers) ||
      wallet.additional_signers.length !== 0
    )
      throw new Error('Wallet has other signers; enrollment is unavailable');
    await this.verifyPolicy();
    const expiresAt = new Date(owner.terms.expiresAt);
    const delegation = await this.deps.db.transaction(async (tx) => {
      const [saved] = await tx
        .insert(mcpTradeDelegations)
        .values({
          id: owner.delegationId,
          userId: owner.userId,
          walletId: owner.walletId,
          wallet: owner.wallet,
          signerId: this.config.signerQuorumId,
          policyId: this.config.policyId,
          policyHash: this.config.policyHash,
          policyTier: settings.allowSell ? 2 : 1,
          allowSell: settings.allowSell,
          perTradeLimitUsd: settings.perTradeUsd.toFixed(6),
          dailyLimitUsd: settings.dailyUsd.toFixed(6),
          maxSlippageBps: settings.maxSlippageBps,
          expiresAt,
        })
        .returning();
      await tx.insert(mcpAuditEvents).values({
        userId: owner.userId,
        walletId: owner.walletId,
        delegationId: saved.id,
        eventType: 'delegation_prepared',
        details: { allowSell: settings.allowSell },
      });
      return saved;
    });
    return {
      delegationId: delegation.id,
      wallet: owner.wallet,
      signerId: delegation.signerId,
      policyId: delegation.policyId,
      perTradeUsd: delegation.perTradeLimitUsd,
      dailyUsd: delegation.dailyLimitUsd,
      maxSlippageBps: delegation.maxSlippageBps,
      allowSell: delegation.allowSell,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async activateGrant(proof: OwnerProof, delegationId: string) {
    this.assertEnabled();
    const owner = await this.browserOwner(proof, 'activate');
    const [delegation] = await this.deps.db
      .select()
      .from(mcpTradeDelegations)
      .where(
        and(
          eq(mcpTradeDelegations.id, delegationId),
          eq(mcpTradeDelegations.userId, owner.userId),
          eq(mcpTradeDelegations.walletId, owner.walletId),
          eq(mcpTradeDelegations.wallet, owner.wallet),
        ),
      )
      .limit(1);
    if (
      delegation?.status === 'active' &&
      delegation.expiresAt > new Date() &&
      sameGrantTerms(owner, delegation)
    ) {
      await this.verifyPrivySigner(delegation);
      return {
        active: true,
        delegationId,
        expiresAt: delegation.expiresAt.toISOString(),
      };
    }
    if (
      !delegation ||
      delegation.status !== 'pending_signer' ||
      delegation.expiresAt <= new Date() ||
      !sameGrantTerms(owner, delegation)
    )
      throw new Error('Pending delegation unavailable');
    await this.verifyPrivySigner(delegation);
    const updated = await this.deps.db.transaction(async (tx) => {
      const [active] = await tx
        .update(mcpTradeDelegations)
        .set({ status: 'active', activatedAt: new Date() })
        .where(
          and(
            eq(mcpTradeDelegations.id, delegation.id),
            eq(mcpTradeDelegations.status, 'pending_signer'),
          ),
        )
        .returning();
      if (!active) throw new Error('Delegation activation changed');
      await tx.insert(mcpAuditEvents).values({
        userId: owner.userId,
        walletId: owner.walletId,
        delegationId,
        eventType: 'delegation_activated',
        details: {},
      });
      return active;
    });
    return {
      active: true,
      delegationId,
      expiresAt: updated.expiresAt.toISOString(),
    };
  }

  async revokeGrant(proof: OwnerProof, delegationId: string) {
    const owner = await this.browserOwner(proof, 'revoke', false);
    if (owner.delegationId !== delegationId)
      throw new Error('Revocation targets a different grant');
    await this.deps.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(mcpTradeDelegations)
        .set({
          status: 'revoked',
          revokedAt: new Date(),
          revokeReason: 'browser_owner',
        })
        .where(
          and(
            eq(mcpTradeDelegations.id, delegationId),
            eq(mcpTradeDelegations.userId, owner.userId),
            eq(mcpTradeDelegations.walletId, owner.walletId),
            eq(mcpTradeDelegations.wallet, owner.wallet),
            inArray(mcpTradeDelegations.status, ['pending_signer', 'active']),
          ),
        )
        .returning({ id: mcpTradeDelegations.id });
      if (!updated) throw new Error('Delegation unavailable');
      await tx.insert(mcpAuditEvents).values({
        userId: owner.userId,
        walletId: owner.walletId,
        delegationId,
        eventType: 'delegation_revoked',
        details: {},
      });
    });
    return { revoked: true, removeAllWalletSignersInBrowser: true };
  }

  private async ownedState(intentId: string) {
    const [intent] = await this.deps.db
      .select()
      .from(mcpTradeIntents)
      .where(eq(mcpTradeIntents.id, intentId))
      .limit(1);
    if (!intent || !intent.delegationId || intent.mode !== 'delegated')
      throw new Error('Delegated intent unavailable');
    const [delegation] = await this.deps.db
      .select()
      .from(mcpTradeDelegations)
      .where(
        and(
          eq(mcpTradeDelegations.id, intent.delegationId),
          eq(mcpTradeDelegations.userId, intent.userId),
          eq(mcpTradeDelegations.wallet, intent.wallet),
        ),
      )
      .limit(1);
    if (
      !delegation ||
      delegation.status !== 'active' ||
      delegation.expiresAt <= new Date() ||
      !this.config.allowedUsers.has(intent.userId) ||
      (intent.side === 'buy' && !this.config.buysEnabled) ||
      (intent.side === 'sell' &&
        (!this.config.sellsEnabled || !delegation.allowSell)) ||
      usdMicros(delegation.perTradeLimitUsd) > 25_000_000n ||
      usdMicros(delegation.dailyLimitUsd) > 50_000_000n ||
      delegation.expiresAt.getTime() - delegation.createdAt.getTime() >
        86_400_000
    )
      throw new Error('Delegation is inactive or exceeds owner-only limits');
    const [connection] = await this.deps.db
      .select()
      .from(mcpConnections)
      .where(
        and(
          eq(mcpConnections.grantId, intent.grantId),
          eq(mcpConnections.clientId, intent.clientId),
          eq(mcpConnections.userId, intent.userId),
          eq(mcpConnections.walletId, delegation.walletId),
          eq(mcpConnections.wallet, intent.wallet),
          isNull(mcpConnections.revokedAt),
        ),
      )
      .limit(1);
    if (
      !connection ||
      !connection.scopes.split(/\s+/).includes('oren.trade.execute') ||
      !delegation.activatedAt ||
      connection.createdAt <= delegation.activatedAt
    )
      throw new Error('A newly consented execute connection is required');
    await this.deps.auth.verifyMcpWallet(
      intent.userId,
      delegation.walletId,
      intent.wallet,
    );
    await this.verifyPrivySigner(delegation);
    return { intent, delegation };
  }

  private async verifyPrivySigner(delegation: Delegation) {
    if (
      delegation.signerId !== this.config.signerQuorumId ||
      delegation.policyId !== this.config.policyId ||
      delegation.policyHash !== this.config.policyHash
    )
      throw new Error(
        'Delegated signer or policy differs from the gate configuration',
      );
    const wallet = await this.deps.privy.wallets().get(delegation.walletId);
    if (
      wallet.address !== delegation.wallet ||
      wallet.chain_type !== 'solana' ||
      wallet.additional_signers?.length !== 1 ||
      wallet.additional_signers[0].signer_id !== delegation.signerId ||
      wallet.additional_signers[0].override_policy_ids?.length !== 1 ||
      wallet.additional_signers[0].override_policy_ids[0] !==
        delegation.policyId
    )
      throw new Error('Privy wallet signer state changed');
    const policy = await this.deps.privy.policies().get(delegation.policyId);
    if (
      policy.owner_id !== this.config.policyOwnerId ||
      policy.chain_type !== 'solana' ||
      gatePolicyFingerprint(policy) !== this.config.policyHash ||
      policy.rules?.length !== (this.config.sellsEnabled ? 4 : 3) ||
      (this.config.sellsEnabled &&
        !policy.rules.some(
          (rule) => rule.name === 'allow bounded jupiter sell',
        )) ||
      policy.rules.some((rule) => rule.method !== 'signTransaction')
    )
      throw new Error('Privy signer policy changed');
  }

  private response(execution: Execution) {
    return {
      executionId: execution.id,
      state: execution.state,
      ...(execution.state === 'challenged' &&
      execution.requestExpiresAt > new Date()
        ? { canonicalRequestBase64: canonical(execution).toString('base64') }
        : {}),
      chainSignature: execution.chainSignature ?? undefined,
    };
  }

  async challenge(intentId: string, idempotencyKey: string) {
    this.assertEnabled();
    if (
      !/^[a-f\d-]{36}$/i.test(intentId) ||
      !/^[A-Za-z0-9_-]{16,64}$/.test(idempotencyKey)
    )
      throw new Error('Invalid intent or idempotency key');
    const { intent, delegation } = await this.ownedState(intentId);
    const [existing] = await this.deps.db
      .select()
      .from(mcpDelegatedExecutions)
      .where(eq(mcpDelegatedExecutions.intentId, intentId))
      .limit(1);
    if (existing) {
      if (existing.idempotencyKey !== idempotencyKey)
        throw new Error('Intent was already claimed with another key');
      return this.response(existing);
    }
    const fresh = await buildGateJupiterRoute(intent, this.deps);
    const requestExpiresAt = new Date(Date.now() + 30_000);
    const executionId = randomUUID();
    const request = this.deps.auth.signingRequest(
      delegation.walletId,
      fresh.transaction,
      executionId,
      requestExpiresAt,
    );
    const reserved = await reserveTradeBudget(this.deps.db, {
      delegationId: delegation.id,
      intentId: intent.id,
      grantId: intent.grantId,
      clientId: intent.clientId,
      userId: intent.userId,
      walletId: delegation.walletId,
      wallet: intent.wallet,
      idempotencyKey,
      rawInput: fresh.rawInput,
      referenceValueUsd: fresh.referenceValueUsd,
      quotedProceedsUsd: fresh.quotedProceedsUsd,
      execution: {
        id: executionId,
        intentId,
        idempotencyKey,
        unsignedTransaction: fresh.transaction,
        privyRequest: request,
        requestExpiresAt,
        lastValidBlockHeight: fresh.lastValidBlockHeight,
      },
    });
    if (reserved.status !== 'reserved') {
      if (reserved.status === 'existing') {
        const [existingAfterRace] = await this.deps.db
          .select()
          .from(mcpDelegatedExecutions)
          .where(eq(mcpDelegatedExecutions.intentId, intentId))
          .limit(1);
        if (
          existingAfterRace &&
          existingAfterRace.idempotencyKey === idempotencyKey
        )
          return this.response(existingAfterRace);
        throw new Error('Claim exists without a matching execution');
      }
      throw new Error(`Delegated trade ${reserved.status}`);
    }
    const [execution] = await this.deps.db
      .select()
      .from(mcpDelegatedExecutions)
      .where(eq(mcpDelegatedExecutions.id, executionId));
    if (!execution) throw new Error('Execution storage unavailable');
    return this.response(execution);
  }

  async complete(executionId: string, apiSignatureBase64: string) {
    this.assertEnabled();
    const [execution] = await this.deps.db
      .select()
      .from(mcpDelegatedExecutions)
      .where(eq(mcpDelegatedExecutions.id, executionId))
      .limit(1);
    if (!execution) throw new Error('Execution unavailable');
    if (execution.state !== 'challenged') return this.response(execution);
    if (execution.requestExpiresAt <= new Date())
      throw new Error('Challenge expired; reconcile the reservation');
    const key = createPublicKey({
      key: Buffer.from(this.config.apiPublicKeyDerBase64, 'base64'),
      format: 'der',
      type: 'spki',
    });
    if (
      key.asymmetricKeyType !== 'ec' ||
      key.asymmetricKeyDetails?.namedCurve !== 'prime256v1' ||
      !verify(
        'sha256',
        canonical(execution),
        key,
        Buffer.from(apiSignatureBase64, 'base64'),
      )
    )
      throw new Error('API authorization signature is invalid');
    const { delegation } = await this.ownedState(execution.intentId);
    const requestUrl = execution.privyRequest.url;
    if (
      typeof requestUrl !== 'string' ||
      requestUrl !==
        `https://api.privy.io/v1/wallets/${encodeURIComponent(delegation.walletId)}/rpc`
    )
      throw new Error('Privy request wallet changed');
    const [claimed] = await this.deps.db
      .update(mcpDelegatedExecutions)
      .set({ state: 'signing', updatedAt: new Date() })
      .where(
        and(
          eq(mcpDelegatedExecutions.id, executionId),
          eq(mcpDelegatedExecutions.state, 'challenged'),
        ),
      )
      .returning();
    if (!claimed) return { executionId, state: 'pending' as const };
    const gateSignature = generateAuthorizationSignature({
      authorizationPrivateKey: this.config.gatePrivateKeyDerBase64,
      input: canonical(claimed),
    });
    let signed: string;
    try {
      const result = await this.deps.privy
        .wallets()
        .solana()
        .signTransaction(delegation.walletId, {
          transaction: execution.unsignedTransaction,
          authorization_context: {
            signatures: [apiSignatureBase64, gateSignature],
          },
          idempotency_key: execution.id,
          request_expiry: execution.requestExpiresAt.getTime(),
        });
      signed = result.signed_transaction;
    } catch {
      await this.deps.db
        .update(mcpDelegatedExecutions)
        .set({
          state: 'pending',
          errorCode: 'privy_uncertain',
          updatedAt: new Date(),
        })
        .where(eq(mcpDelegatedExecutions.id, execution.id));
      return { executionId, state: 'pending' as const };
    }
    const chainSignature = this.deps.rpc.validateSigned(
      execution.unsignedTransaction,
      signed,
      delegation.wallet,
    );
    await this.deps.db
      .update(mcpDelegatedExecutions)
      .set({
        state: 'signed',
        signedTransaction: signed,
        chainSignature,
        updatedAt: new Date(),
      })
      .where(eq(mcpDelegatedExecutions.id, execution.id));
    return this.broadcast(execution.id);
  }

  private async broadcast(executionId: string) {
    const [execution] = await this.deps.db
      .select()
      .from(mcpDelegatedExecutions)
      .where(eq(mcpDelegatedExecutions.id, executionId))
      .limit(1);
    if (!execution?.signedTransaction || !execution.chainSignature)
      throw new Error('Signed bytes have not been persisted');
    try {
      await this.deps.rpc.broadcast(execution.signedTransaction);
      await this.deps.db
        .update(mcpDelegatedExecutions)
        .set({ state: 'broadcast', updatedAt: new Date() })
        .where(eq(mcpDelegatedExecutions.id, executionId));
      await this.deps.db
        .update(mcpTradeIntents)
        .set({ status: 'submitted' })
        .where(eq(mcpTradeIntents.id, execution.intentId));
      return {
        executionId,
        state: 'broadcast' as const,
        chainSignature: execution.chainSignature,
      };
    } catch {
      await this.deps.db
        .update(mcpDelegatedExecutions)
        .set({
          state: 'pending',
          errorCode: 'broadcast_uncertain',
          updatedAt: new Date(),
        })
        .where(eq(mcpDelegatedExecutions.id, executionId));
      return {
        executionId,
        state: 'pending' as const,
        chainSignature: execution.chainSignature,
      };
    }
  }

  async reconcile(executionId: string) {
    const [execution] = await this.deps.db
      .select()
      .from(mcpDelegatedExecutions)
      .where(eq(mcpDelegatedExecutions.id, executionId))
      .limit(1);
    if (!execution) throw new Error('Execution unavailable');
    if (
      execution.state === 'challenged' &&
      execution.requestExpiresAt <= new Date()
    ) {
      const expired = await this.deps.db.transaction(async (tx) => {
        const [claimed] = await tx
          .update(mcpDelegatedExecutions)
          .set({
            state: 'failed',
            errorCode: 'unused_challenge_expired',
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(mcpDelegatedExecutions.id, executionId),
              eq(mcpDelegatedExecutions.state, 'challenged'),
            ),
          )
          .returning({ id: mcpDelegatedExecutions.id });
        if (!claimed) return false;
        await tx
          .update(mcpBudgetReservations)
          .set({ status: 'released', settledAt: new Date() })
          .where(
            and(
              eq(mcpBudgetReservations.intentId, execution.intentId),
              eq(mcpBudgetReservations.status, 'reserved'),
            ),
          );
        await tx
          .update(mcpTradeIntents)
          .set({ status: 'failed' })
          .where(eq(mcpTradeIntents.id, execution.intentId));
        return true;
      });
      if (expired) return { executionId, state: 'failed' as const };
      return { executionId, state: 'pending' as const };
    }
    if (!execution.chainSignature) return this.response(execution);
    const status = await this.deps.rpc.status(execution.chainSignature);
    if (
      status?.confirmationStatus === 'confirmed' ||
      status?.confirmationStatus === 'finalized'
    ) {
      if (status.err) {
        await settleTradeBudget(
          this.deps.db,
          execution.intentId,
          'definite_failure',
        );
        await this.deps.db
          .update(mcpDelegatedExecutions)
          .set({
            state: 'failed',
            errorCode: 'chain_failure',
            updatedAt: new Date(),
          })
          .where(eq(mcpDelegatedExecutions.id, executionId));
        return { executionId, state: 'failed' as const };
      }
      await settleTradeBudget(this.deps.db, execution.intentId, 'confirmed');
      await this.deps.db
        .update(mcpDelegatedExecutions)
        .set({ state: 'confirmed', updatedAt: new Date() })
        .where(eq(mcpDelegatedExecutions.id, executionId));
      return {
        executionId,
        state: 'confirmed' as const,
        chainSignature: execution.chainSignature,
      };
    }
    const [intent] = await this.deps.db
      .select({ wallet: mcpTradeIntents.wallet })
      .from(mcpTradeIntents)
      .where(eq(mcpTradeIntents.id, execution.intentId));
    if (
      execution.signedTransaction &&
      execution.lastValidBlockHeight &&
      intent &&
      (await this.deps.rpc.blockhashValid(
        execution.signedTransaction,
        intent.wallet,
        execution.lastValidBlockHeight,
      ))
    )
      return this.broadcast(executionId);
    return {
      executionId,
      state: 'pending' as const,
      chainSignature: execution.chainSignature,
    };
  }
}
