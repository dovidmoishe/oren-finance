import { generateAuthorizationSignature } from '@privy-io/node';
import { SignerGateRejection } from './signer-gate.errors';
import type { ApiTradeAuthorizer, TradeActor } from './api-trade-authorization';
import type { OwnerProof } from './grant-owner-proof';

export type GateResult = {
  executionId: string;
  state: string;
  chainSignature?: string;
};

/** MCP API holds only one Privy quorum key; the gate holds the other. */
export class SignerGateClient {
  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly apiPrivateKey: string,
    private readonly authorizer?: ApiTradeAuthorizer,
  ) {
    if (!/^http:\/\/signer-gate:3001$/.test(url))
      throw new Error(
        'Signer gate must use the private production container address',
      );
  }

  private async post<T>(
    path: string,
    body: Record<string, unknown>,
  ): Promise<T> {
    const response = await fetch(`${this.url}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45_000),
    });
    const result = (await response.json()) as T & { error?: string };
    if (!response.ok)
      throw new SignerGateRejection(result.error ?? 'unavailable');
    return result;
  }

  async execute(
    intentId: string,
    idempotencyKey: string,
    actor?: TradeActor,
  ): Promise<GateResult> {
    if (!this.apiPrivateKey || !this.authorizer || !actor)
      throw new SignerGateRejection('disabled');
    const challenge = await this.post<
      GateResult & { canonicalRequestBase64?: string }
    >('/challenge', { intentId, idempotencyKey });
    if (challenge.state !== 'challenged') return challenge;
    if (!challenge.canonicalRequestBase64)
      throw new SignerGateRejection('pending');
    const independentlyAuthorized = await this.authorizer.authorize(
      intentId,
      idempotencyKey,
      actor,
      challenge,
    );
    const signature = generateAuthorizationSignature({
      authorizationPrivateKey: this.apiPrivateKey,
      input: independentlyAuthorized,
    });
    return this.post<GateResult>('/complete', {
      executionId: challenge.executionId,
      apiSignatureBase64: signature,
    });
  }

  prepareGrant(
    authorization: OwnerProof,
    settings: {
      allowSell: boolean;
      perTradeUsd: number;
      dailyUsd: number;
      maxSlippageBps: number;
      durationHours: number;
    },
  ) {
    return this.post<{
      delegationId: string;
      wallet: string;
      signerId: string;
      policyId: string;
      perTradeUsd: string;
      dailyUsd: string;
      maxSlippageBps: number;
      allowSell: boolean;
      expiresAt: string;
    }>('/grant/prepare', { authorization, ...settings });
  }

  activateGrant(authorization: OwnerProof, delegationId: string) {
    return this.post<{
      active: boolean;
      delegationId: string;
      expiresAt: string;
    }>('/grant/activate', { authorization, delegationId });
  }

  revokeGrant(authorization: OwnerProof, delegationId: string) {
    return this.post<{
      revoked: boolean;
      removeAllWalletSignersInBrowser: boolean;
    }>('/grant/revoke', { authorization, delegationId });
  }
}
