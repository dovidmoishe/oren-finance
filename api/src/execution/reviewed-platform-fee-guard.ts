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
// Swap v1 ExactIn route and shared_accounts_route; final argument is a u8 fee.
const ROUTE = 'e517cb977ae3ad2a';
const SHARED_ROUTE = 'c1209b3341d69c81';

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

/** Walk the canonical route plan so trailing bytes cannot disguise another rate. */
function routeFeeBps(data: Buffer, shared: boolean): number {
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
    const index = tag === ROUTE ? 6 : tag === SHARED_ROUTE ? 9 : -1;
    const account = ix.keys[index];
    let bps: number;
    try {
      bps = routeFeeBps(Buffer.from(ix.data), tag === SHARED_ROUTE);
    } catch {
      return reject();
    }
    if (
      index < 0 ||
      bps !== fee.bps ||
      account?.pubkey.toBase58() !== fee.account ||
      !account.isWritable ||
      account.isSigner
    )
      reject();
  }
}
