import { generateAuthorizationSignature } from '@privy-io/node';
import { SignerGateRejection } from './signer-gate.errors';

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

  async execute(intentId: string, idempotencyKey: string): Promise<GateResult> {
    if (!this.apiPrivateKey) throw new SignerGateRejection('disabled');
    const challenge = await this.post<
      GateResult & { canonicalRequestBase64?: string }
    >('/challenge', { intentId, idempotencyKey });
    if (challenge.state !== 'challenged') return challenge;
    if (!challenge.canonicalRequestBase64)
      throw new SignerGateRejection('pending');
    const signature = generateAuthorizationSignature({
      authorizationPrivateKey: this.apiPrivateKey,
      input: Buffer.from(challenge.canonicalRequestBase64, 'base64'),
    });
    return this.post<GateResult>('/complete', {
      executionId: challenge.executionId,
      apiSignatureBase64: signature,
    });
  }

  prepareGrant(
    userToken: string,
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
    }>('/grant/prepare', { userToken, ...settings });
  }

  activateGrant(userToken: string, delegationId: string) {
    return this.post<{
      active: boolean;
      delegationId: string;
      expiresAt: string;
    }>('/grant/activate', { userToken, delegationId });
  }

  revokeGrant(userToken: string, delegationId: string) {
    return this.post<{
      revoked: boolean;
      removeAllWalletSignersInBrowser: boolean;
    }>('/grant/revoke', { userToken, delegationId });
  }
}
