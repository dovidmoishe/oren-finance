import { BadRequestException, Injectable } from '@nestjs/common';
import {
  AddressLookupTableAccount,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import type { Quote } from '../../types/quote';
import { AlchemyClient } from '../alchemy/alchemy.client';
import { quoteFeeConfig } from './platform-fee';
import { isTitanPayload } from './titan/titan.mapper';
import idl from '../mcp-auth/jupiter-shared-route.idl.json';

const JUPITER = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';
// Jupiter v6 IDL: https://solscan.io/account/JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4#programIdl
// V2 puts the fee account FIRST in remaining_accounts, after 10 ordinary or
// 12 shared accounts (including event_authority/program). V1 has a named slot.
const ROUTES: Record<
  string,
  { shared: boolean; v2: boolean; feeIndex: number }
> = {
  e517cb977ae3ad2a: { shared: false, v2: false, feeIndex: 6 },
  c1209b3341d69c81: { shared: true, v2: false, feeIndex: 9 },
  bb64facc31c4af14: { shared: false, v2: true, feeIndex: 10 }, // route_v2
  d19853937cfed8e9: { shared: true, v2: true, feeIndex: 12 }, // shared_accounts_route_v2
  '9d8ab85215f4f324': { shared: false, v2: true, feeIndex: 10 }, // exact_out_route_v2
  '3560e5cad8bbfa18': { shared: true, v2: true, feeIndex: 12 }, // shared_accounts_exact_out_route_v2
};

type IdlType =
  | string
  | { defined: { name: string } }
  | { vec: IdlType }
  | { option: IdlType }
  | { array: [IdlType, number] };
interface IdlField {
  type: IdlType;
}
interface IdlDefinition {
  kind: 'struct' | 'enum';
  fields?: IdlField[];
  variants?: { fields?: (IdlField | IdlType)[] }[];
}
const definitions = new Map<string, IdlDefinition>(
  idl.types.map((item) => [item.name, item.type as unknown as IdlDefinition]),
);

// RoutePlanStepV2 uses the same Swap enum as V1, with u16 bps replacing u8 percent.
definitions.set('RoutePlanStepV2', {
  kind: 'struct',
  fields: [
    { type: { defined: { name: 'Swap' } } },
    { type: 'u16' },
    { type: 'u8' },
    { type: 'u8' },
  ],
});

/** Walk the canonical route plan so trailing bytes cannot disguise another rate. */
function routeFeeBps(
  data: Buffer,
  { shared, v2 }: { shared: boolean; v2: boolean },
): number {
  let offset = shared ? 9 : 8;
  const take = (size: number) => {
    if (size < 0 || offset + size > data.length)
      throw new Error('Truncated route');
    const start = offset;
    offset += size;
    return start;
  };
  const byte = () => data.readUInt8(take(1));
  const read = (type: IdlType): void => {
    if (typeof type === 'string') {
      const size = {
        u8: 1,
        bool: 1,
        u16: 2,
        u32: 4,
        u64: 8,
        u128: 16,
        pubkey: 32,
      }[type];
      if (type === 'bytes') {
        take(data.readUInt32LE(take(4)));
        return;
      }
      if (!size) throw new Error('Unknown IDL primitive');
      take(size);
      return;
    }
    if ('defined' in type) {
      const def = definitions.get(type.defined.name);
      if (!def) throw new Error('Unknown route type');
      if (def.kind === 'struct') {
        for (const field of def.fields ?? []) read(field.type);
      } else {
        const variant = def.variants?.[byte()];
        if (!variant) throw new Error('Unknown route variant');
        for (const field of variant.fields ?? [])
          read(
            typeof field === 'object' && 'type' in field ? field.type : field,
          );
      }
    } else if ('option' in type) {
      const present = byte();
      if (present > 1) throw new Error('Invalid option');
      if (present) read(type.option);
    } else {
      const count = 'vec' in type ? data.readUInt32LE(take(4)) : type.array[1];
      if (count > 128) throw new Error('Oversized route');
      const member = 'vec' in type ? type.vec : type.array[0];
      for (let i = 0; i < count; i++) read(member);
    }
  };
  if (v2) {
    // ExactIn: in_amount, quoted_out_amount; ExactOut: out_amount, quoted_in_amount.
    // Both then have u16 slippage_bps, platform_fee_bps, positive_slippage_bps,
    // followed by Vec<RoutePlanStepV2>. The shared variants prepend a u8 id.
    take(18);
    const fee = data.readUInt16LE(take(2));
    take(2);
    read({ vec: { defined: { name: 'RoutePlanStepV2' } } });
    if (offset !== data.length) throw new Error('Invalid V2 route arguments');
    return fee;
  }
  read({ vec: { defined: { name: 'RoutePlanStep' } } });
  if (offset + 19 !== data.length)
    throw new Error('Invalid ExactIn route arguments');
  return data[offset + 18];
}

/** Applies only to fee-bearing browser-reviewed swaps, never delegated signing. */
@Injectable()
export class ReviewedPlatformFeeGuard {
  constructor(private readonly rpc: AlchemyClient) {}

  async inspect(transaction: string, quote: Quote): Promise<void> {
    const fee = quoteFeeConfig(quote);
    if (!fee) return;
    const reject = (): never => {
      throw new BadRequestException(
        'Prepared platform fee differs from the reviewed trade',
      );
    };
    const tx = VersionedTransaction.deserialize(
      Buffer.from(transaction, 'base64'),
    );
    const tables = await Promise.all(
      tx.message.addressTableLookups.map(async (lookup) => {
        const result = await this.rpc.call<{
          value: { data: [string, string] } | null;
        }>('getAccountInfo', [
          lookup.accountKey.toBase58(),
          { encoding: 'base64', commitment: 'confirmed' },
        ]);
        if (!result.value) return reject();
        return new AddressLookupTableAccount({
          key: lookup.accountKey,
          state: AddressLookupTableAccount.deserialize(
            Buffer.from(result.value.data[0], 'base64'),
          ),
        });
      }),
    );
    const instructions = TransactionMessage.decompile(tx.message, {
      addressLookupTableAccounts: tables,
    }).instructions;
    if (isTitanPayload(quote.routePayload)) {
      // Titan's opaque instructions are preserved, including its fee transfer.
      // The approval simulation independently checks net user balances.
      if (
        !instructions.some((ix) =>
          ix.keys.some(
            (key) =>
              key.pubkey.toBase58() === fee.account &&
              key.isWritable &&
              !key.isSigner,
          ),
        )
      )
        reject();
      return;
    }
    const swaps = instructions.filter(
      (ix) => ix.programId.toBase58() === JUPITER,
    );
    if (swaps.length !== 1) return reject();
    const ix = swaps[0];
    const tag = ix.data.subarray(0, 8).toString('hex');
    const route = ROUTES[tag];
    if (!route) return reject();
    const account = ix.keys[route.feeIndex];
    let bps: number;
    try {
      bps = routeFeeBps(Buffer.from(ix.data), route);
    } catch {
      return reject();
    }
    if (
      bps !== fee.bps ||
      account?.pubkey.toBase58() !== fee.account ||
      !account.isWritable ||
      account.isSigner
    )
      reject();
  }
}
