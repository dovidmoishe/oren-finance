import { Inject, Injectable } from '@nestjs/common';
import {
  Connection,
  PublicKey,
  VersionedTransaction,
  TransactionMessage,
  ComputeBudgetProgram,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  decodeTransferCheckedInstruction,
} from '@solana/spl-token';
import { createHash } from 'node:crypto';
import { APP_ENV } from '../../config/constants';
import type { AppEnv } from '../../config/env.schema';
import { ProviderError } from '../../common/errors/provider.errors';
import type {
  CreationPayload,
  CreationQuote,
  CreationPrepared,
} from '../../../types/prediction-creation';
import type { ProviderBuild } from './creation.provider';

export interface CreationManifest {
  genesisHash: string;
  programId: string;
  programDataAddress: string;
  programDataHash: string;
  usdcMint: string;
  minimumStartDelay: number;
  feeDestinations: string[];
  fundingMode: 'cpi' | 'transfers';
  eventSeeds: (
    | { kind: 'literal'; value: string }
    | { kind: 'wallet' }
    | { kind: 'questionHash' }
  )[];
  discriminatorHex: string;
  fields: {
    name:
      | keyof CreationPayload
      | 'paymentUsdc'
      | 'liquidityInjectionUsdc'
      | 'platformRevenueUsdc';
    type: 'string' | 'strings' | 'u64' | 'u8';
  }[];
  accounts: { address: string; writable: boolean; signer: boolean }[];
  /** Addresses may be audited constants or $wallet/$event/$usdcMint/$walletUsdcAta. */
  missingDataPolicies: string[];
  resolutionContract: string;
  disputeContract: string;
  eligibilityContract: string;
  auditReference: string;
}
export const hashMessage = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');
const invalid = () =>
  new ProviderError(
    'Creation transaction does not match approved terms',
    'PANTA_CREATE_TX_MISMATCH',
    409,
  );
export function parseManifest(value?: string): CreationManifest | null {
  if (!value) return null;
  try {
    const raw: unknown = JSON.parse(value);
    if (!raw || typeof raw !== 'object') return null;
    const m = raw as CreationManifest;
    for (const name of ['programId', 'programDataAddress', 'usdcMint'] as const)
      new PublicKey(m[name]);
    if (
      !m.genesisHash ||
      !/^[a-f0-9]{64}$/.test(m.programDataHash) ||
      !/^[a-f0-9]{16}$/.test(m.discriminatorHex) ||
      !Number.isSafeInteger(m.minimumStartDelay) ||
      m.minimumStartDelay < 3600 ||
      !['cpi', 'transfers'].includes(m.fundingMode) ||
      !m.resolutionContract ||
      !m.disputeContract ||
      !m.eligibilityContract ||
      !m.auditReference
    )
      return null;
    if (
      !Array.isArray(m.accounts) ||
      !m.accounts.length ||
      !Array.isArray(m.fields) ||
      !m.fields.length ||
      !Array.isArray(m.feeDestinations) ||
      !m.feeDestinations.length ||
      !Array.isArray(m.eventSeeds) ||
      !m.eventSeeds.length ||
      !Array.isArray(m.missingDataPolicies) ||
      !m.missingDataPolicies.length
    )
      return null;
    for (const fee of m.feeDestinations) new PublicKey(fee);
    if (
      !m.accounts.every(
        (a) =>
          typeof a.address === 'string' &&
          typeof a.signer === 'boolean' &&
          typeof a.writable === 'boolean',
      )
    )
      return null;
    if (
      m.accounts.length > 64 ||
      m.fields.length > 32 ||
      m.eventSeeds.length > 16 ||
      !m.eventSeeds.every(
        (s) =>
          s.kind === 'wallet' ||
          s.kind === 'questionHash' ||
          (s.kind === 'literal' &&
            typeof s.value === 'string' &&
            Buffer.byteLength(s.value) <= 32),
      )
    )
      return null;
    if (
      !m.missingDataPolicies.every(
        (s) => typeof s === 'string' && s.trim().length > 0,
      ) ||
      ![
        'resolutionContract',
        'disputeContract',
        'eligibilityContract',
        'auditReference',
      ].every((k) => typeof m[k as keyof CreationManifest] === 'string')
    )
      return null;
    for (const a of m.accounts)
      if (
        !['$wallet', '$event', '$usdcMint', '$walletUsdcAta'].includes(
          a.address,
        )
      )
        new PublicKey(a.address);
    if (
      !m.fields.every((f) =>
        ['string', 'strings', 'u64', 'u8'].includes(f.type),
      )
    )
      return null;
    const names = new Set(m.fields.map((f) => f.name));
    for (const field of [
      'question',
      'resolutionRule',
      'sourcesOfTruth',
      'startTime',
      'endTime',
      'resolutionTime',
      'paymentUsdc',
      'liquidityInjectionUsdc',
      'platformRevenueUsdc',
    ] as const)
      if (!names.has(field)) return null;
    if (
      !m.accounts.some((a) => a.address === '$wallet' && a.signer) ||
      !m.accounts.some((a) => a.address === '$event' && a.writable) ||
      !m.accounts.some((a) => a.address === '$usdcMint') ||
      !m.feeDestinations.every((f) => m.accounts.some((a) => a.address === f))
    )
      return null;
    return m;
  } catch {
    return null;
  }
}
function encodeField(
  value: unknown,
  type: CreationManifest['fields'][number]['type'],
): Buffer {
  if (type === 'u8') {
    if (value !== 'standard') throw invalid();
    return Buffer.from([0]);
  }
  if (type === 'u64') {
    if (!/^\d+$/.test(String(value))) throw invalid();
    const bytes = Buffer.alloc(8);
    bytes.writeBigUInt64LE(BigInt(String(value)));
    return bytes;
  }
  if (type === 'string') {
    if (typeof value !== 'string') throw invalid();
    const bytes = Buffer.from(value),
      len = Buffer.alloc(4);
    len.writeUInt32LE(bytes.length);
    return Buffer.concat([len, bytes]);
  }
  if (!Array.isArray(value) || !value.every((v) => typeof v === 'string'))
    throw invalid();
  const len = Buffer.alloc(4);
  len.writeUInt32LE(value.length);
  return Buffer.concat([len, ...value.map((v) => encodeField(v, 'string'))]);
}
export function verifyInstructions(
  tx: VersionedTransaction,
  message: TransactionMessage,
  manifest: CreationManifest,
  payload: CreationPayload,
  quote: CreationQuote,
) {
  if (
    tx.message.header.numRequiredSignatures !== 1 ||
    message.payerKey.toBase58() !== payload.wallet
  )
    throw invalid();
  const wallet = new PublicKey(payload.wallet),
    mint = new PublicKey(manifest.usdcMint),
    event = new PublicKey(quote.expectedEventPda);
  const seeds = manifest.eventSeeds.map((seed) =>
    seed.kind === 'wallet'
      ? wallet.toBuffer()
      : seed.kind === 'questionHash'
        ? createHash('sha256').update(payload.question).digest()
        : Buffer.from(seed.value),
  );
  const expected = PublicKey.findProgramAddressSync(
    seeds,
    new PublicKey(manifest.programId),
  )[0];
  if (!expected.equals(event)) throw invalid();
  const roles: Record<string, string> = {
    $wallet: payload.wallet,
    $event: event.toBase58(),
    $usdcMint: mint.toBase58(),
    $walletUsdcAta: getAssociatedTokenAddressSync(mint, wallet).toBase58(),
  };
  const data = Buffer.concat([
    Buffer.from(manifest.discriminatorHex, 'hex'),
    ...manifest.fields.map((f) =>
      encodeField(
        f.name in quote
          ? quote[f.name as keyof CreationQuote]
          : payload[f.name as keyof CreationPayload],
        f.type,
      ),
    ),
  ]);
  let creates = 0,
    transfers = 0n;
  const destinations = new Map<string, bigint>();
  let computeLimit = 0,
    computePrice = 0;
  for (const ix of message.instructions) {
    if (ix.programId.equals(ComputeBudgetProgram.programId)) {
      if (creates || ix.keys.length) throw invalid();
      if (
        ix.data[0] === 2 &&
        ix.data.length === 5 &&
        !computeLimit &&
        ix.data.readUInt32LE(1) <= 400_000
      ) {
        computeLimit++;
        continue;
      }
      if (
        ix.data[0] === 3 &&
        ix.data.length === 9 &&
        !computePrice &&
        ix.data.readBigUInt64LE(1) <= 1_000_000n
      ) {
        computePrice++;
        continue;
      }
      throw invalid();
    }
    if (
      ix.programId.equals(TOKEN_PROGRAM_ID) &&
      manifest.fundingMode === 'transfers'
    ) {
      let transfer: ReturnType<typeof decodeTransferCheckedInstruction>;
      try {
        transfer = decodeTransferCheckedInstruction(ix);
      } catch {
        throw invalid();
      }
      const destination = transfer.keys.destination.pubkey.toBase58();
      if (
        ix.keys.length !== 4 ||
        transfer.keys.source.pubkey.toBase58() !== roles.$walletUsdcAta ||
        !transfer.keys.owner.pubkey.equals(wallet) ||
        !transfer.keys.mint.pubkey.equals(mint) ||
        transfer.data.decimals !== 6 ||
        !manifest.feeDestinations.includes(destination)
      )
        throw invalid();
      transfers += transfer.data.amount;
      destinations.set(
        destination,
        (destinations.get(destination) ?? 0n) + transfer.data.amount,
      );
      continue;
    }
    if (
      ix.programId.toBase58() !== manifest.programId ||
      ++creates !== 1 ||
      !ix.data.equals(data) ||
      ix.keys.length !== manifest.accounts.length
    )
      throw invalid();
    for (let i = 0; i < ix.keys.length; i++) {
      const spec = manifest.accounts[i],
        key = ix.keys[i];
      if (
        key.pubkey.toBase58() !== (roles[spec.address] ?? spec.address) ||
        key.isSigner !== spec.signer ||
        key.isWritable !== spec.writable
      )
        throw invalid();
    }
  }
  if (
    creates !== 1 ||
    (manifest.fundingMode === 'transfers' &&
      transfers !== BigInt(quote.paymentUsdc))
  )
    throw invalid();
  // The audited destinations are ordered liquidity, platform; no extra debit is accepted.
  if (
    manifest.fundingMode === 'transfers' &&
    (manifest.feeDestinations.length !== 2 ||
      (destinations.get(manifest.feeDestinations[0]) ?? 0n) !==
        BigInt(quote.liquidityInjectionUsdc) ||
      (destinations.get(manifest.feeDestinations[1]) ?? 0n) !==
        BigInt(quote.platformRevenueUsdc))
  )
    throw invalid();
}
@Injectable()
export class CreationTransactionService {
  constructor(@Inject(APP_ENV) private readonly env: AppEnv) {}
  manifest() {
    return parseManifest(this.env.PANTA_CREATION_MANIFEST_JSON);
  }
  blockers() {
    const reasons: string[] = [];
    if (!this.env.PANTA_CREATION_ENABLED)
      reasons.push('Panta publication is disabled.');
    if (!this.env.PANTA_CREATION_RPC_URL)
      reasons.push('Verified creation RPC is not configured.');
    if (!this.manifest())
      reasons.push(
        'Audited network/program, fee, instruction, resolution, dispute and eligibility contract is not configured.',
      );
    return reasons;
  }
  private connection() {
    if (this.blockers().length)
      throw new ProviderError(
        'Publication verification is incomplete',
        'PANTA_CREATE_BLOCKED',
        503,
      );
    return new Connection(this.env.PANTA_CREATION_RPC_URL!, {
      commitment: 'confirmed',
      disableRetryOnRateLimit: true,
      confirmTransactionInitialTimeout: 15_000,
      fetch: async (url: string | URL | Request, init?: RequestInit) => {
        try {
          return await fetch(url, {
            ...init,
            signal: AbortSignal.timeout(8000),
            redirect: 'error',
          });
        } catch {
          throw new ProviderError(
            'Creation RPC unavailable',
            'PANTA_CREATE_RPC_UNAVAILABLE',
            503,
          );
        }
      },
    });
  }
  private async sanitized<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError(
        'Creation network verification unavailable',
        'PANTA_CREATE_RPC_UNAVAILABLE',
        503,
      );
    }
  }
  network() {
    return this.sanitized(() => this.networkInternal());
  }
  private async networkInternal() {
    const connection = this.connection(),
      m = this.manifest()!;
    if ((await connection.getGenesisHash()) !== m.genesisHash)
      throw new ProviderError(
        'Creation RPC network mismatch',
        'PANTA_CREATE_NETWORK_MISMATCH',
        409,
      );
    const [program, programData, mint] = await Promise.all([
      connection.getAccountInfo(new PublicKey(m.programId)),
      connection.getAccountInfo(new PublicKey(m.programDataAddress)),
      connection.getParsedAccountInfo(new PublicKey(m.usdcMint)),
    ]);
    if (
      !program?.executable ||
      program.owner.toBase58() !==
        'BPFLoaderUpgradeab1e11111111111111111111111' ||
      program.data.length !== 36 ||
      program.data.readUInt32LE(0) !== 2 ||
      new PublicKey(program.data.subarray(4, 36)).toBase58() !==
        m.programDataAddress ||
      !programData ||
      programData.data.length < 45 ||
      programData.data.readUInt32LE(0) !== 3 ||
      !programData.owner.equals(program.owner) ||
      hashMessage(programData.data) !== m.programDataHash
    )
      throw new ProviderError(
        'Program deployment changed or is unverified',
        'PANTA_CREATE_DEPLOYMENT_MISMATCH',
        409,
      );
    const mintData = mint.value?.data;
    if (
      !mint.value?.owner.equals(TOKEN_PROGRAM_ID) ||
      !mintData ||
      !('parsed' in mintData) ||
      (mintData.parsed as { type?: string; info?: { decimals?: number } })
        .type !== 'mint' ||
      (mintData.parsed as { info?: { decimals?: number } }).info?.decimals !== 6
    )
      throw invalid();
    return { connection, manifest: m };
  }
  verify(build: ProviderBuild, payload: CreationPayload, quote: CreationQuote) {
    return this.sanitized(() => this.verifyInternal(build, payload, quote));
  }
  private async verifyInternal(
    build: ProviderBuild,
    payload: CreationPayload,
    quote: CreationQuote,
  ): Promise<Omit<CreationPrepared, 'attemptId'>> {
    if (
      build.createId !== quote.createId ||
      build.expectedEventPda !== quote.expectedEventPda ||
      build.derived.event !== quote.expectedEventPda ||
      build.paymentUsdc !== quote.paymentUsdc ||
      build.liquidityInjectionUsdc !== quote.liquidityInjectionUsdc ||
      build.platformRevenueUsdc !== quote.platformRevenueUsdc ||
      !(Date.parse(build.expiresAt) > Date.now()) ||
      Date.parse(build.expiresAt) > Date.parse(quote.expiresAt)
    )
      throw invalid();
    const { connection, manifest } = await this.network();
    let tx: VersionedTransaction;
    try {
      tx = VersionedTransaction.deserialize(
        Buffer.from(build.transaction, 'base64'),
      );
    } catch {
      throw invalid();
    }
    if (
      tx.signatures.some((s) => s.some((byte) => byte !== 0)) ||
      tx.message.recentBlockhash !== build.recentBlockhash
    )
      throw invalid();
    const tables = await Promise.all(
      tx.message.addressTableLookups.map(async (lookup) => {
        const table = await connection.getAddressLookupTable(lookup.accountKey);
        if (!table.value) throw invalid();
        return table.value;
      }),
    );
    const message = TransactionMessage.decompile(tx.message, {
      addressLookupTableAccounts: tables,
    });
    verifyInstructions(tx, message, manifest, payload, quote);
    if ((await connection.getBlockHeight()) > build.lastValidBlockHeight)
      throw new ProviderError(
        'Creation transaction expired',
        'PANTA_CREATE_EXPIRED',
        409,
      );
    const simulation = await connection.simulateTransaction(tx, {
      sigVerify: false,
      replaceRecentBlockhash: false,
    });
    if (simulation.value.err)
      throw new ProviderError(
        'Creation simulation failed',
        'PANTA_CREATE_SIMULATION_FAILED',
        409,
      );
    const fee = await connection.getFeeForMessage(tx.message);
    if (fee.value === null) throw invalid();
    return {
      transaction: build.transaction,
      recentBlockhash: build.recentBlockhash,
      lastValidBlockHeight: build.lastValidBlockHeight,
      buildFingerprint: build.buildFingerprint,
      messageHash: hashMessage(tx.message.serialize()),
      genesisHash: manifest.genesisHash,
      networkFeeLamports: String(fee.value),
      expiresAt: build.expiresAt,
    };
  }
  confirmed(signature: string, prepared: CreationPrepared, event: string) {
    return this.sanitized(() =>
      this.confirmedInternal(signature, prepared, event),
    );
  }
  private async confirmedInternal(
    signature: string,
    prepared: CreationPrepared,
    event: string,
  ) {
    const { connection, manifest } = await this.network();
    const tx = await connection.getTransaction(signature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    });
    if (!tx) return 'pending' as const;
    if (tx.meta?.err) return 'failed' as const;
    if (
      !tx.meta ||
      hashMessage(tx.transaction.message.serialize()) !==
        prepared.messageHash ||
      tx.transaction.signatures[0] !== signature
    )
      throw invalid();
    const account = await connection.getAccountInfo(new PublicKey(event));
    if (!account || account.owner.toBase58() !== manifest.programId)
      throw invalid();
    return 'confirmed' as const;
  }
  expiredUnsigned(prepared: CreationPrepared, event: string) {
    return this.sanitized(() => this.expiredUnsignedInternal(prepared, event));
  }
  private async expiredUnsignedInternal(
    prepared: CreationPrepared,
    event: string,
  ) {
    const { connection } = await this.network();
    // Finalized expiry prevents replay even if the wallet signed and the browser lost its signature.
    if (
      (await connection.getBlockHeight('finalized')) <=
      prepared.lastValidBlockHeight
    )
      return false;
    return !(await connection.getAccountInfo(
      new PublicKey(event),
      'finalized',
    ));
  }
}
