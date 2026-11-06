import { isDeepStrictEqual } from 'node:util';
const JUPITER = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const COMPUTE = 'ComputeBudget111111111111111111111111111111';
const mintPattern = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function samePolicySemantics(a, b) {
  const normalize = policy => ({ owner_id: policy.owner_id, chain_type: policy.chain_type, version: policy.version,
    rules: policy.rules?.map(rule => ({ name: rule.name, method: rule.method, action: rule.action,
      conditions: rule.conditions?.map(c => ({ field_source: c.field_source, field: c.field, operator: c.operator, value: c.value, idl: c.idl ?? null })) })) });
  return isDeepStrictEqual(normalize(a), normalize(b));
}

/** A new policy; never expands an enrolled wallet's policy in place. */
export function buildTradingPolicy({ idl, stockMints, ownerId, expiresAtUnix, nowUnix = Math.floor(Date.now() / 1000) }) {
  const route = idl?.instructions?.[0];
  if (!ownerId || idl?.address !== JUPITER || idl.instructions.length !== 1 ||
      route?.name !== 'shared_accounts_route' ||
      JSON.stringify(route.discriminator) !== '[193,32,155,51,65,214,156,129]' ||
      !['in_amount', 'quoted_out_amount', 'slippage_bps', 'platform_fee_bps'].every(name => route.args?.some(arg => arg.name === name)) ||
      !['source_mint', 'destination_mint', 'user_transfer_authority', 'source_token_account', 'destination_token_account'].every(name => route.accounts?.some(account => account.name === name)))
    throw new Error('Expected the reviewed Jupiter shared-route IDL and separate policy owner');
  if (!Number.isSafeInteger(expiresAtUnix) || expiresAtUnix <= nowUnix + 3600 || expiresAtUnix > nowUnix + 7 * 86400)
    throw new Error('Policy expiry must be between one hour and seven days');
  const mints = [...new Set(stockMints)].sort();
  if (!mints.length || mints.length > 2000 || mints.some(mint => !mintPattern.test(mint) || mint === USDC))
    throw new Error('Expected an explicit nonempty stock mint allowlist');
  const accountIdl = {
    address: idl.address,
    metadata: { name: idl.metadata?.name ?? 'jupiter', version: idl.metadata?.version ?? '0.1.0', spec: idl.metadata?.spec ?? '0.1.0' },
    instructions: [{ name: route.name, discriminator: route.discriminator, accounts: route.accounts, args: [] }], types: [],
  };
  const condition = (field, operator, value) => ({ field_source: 'solana_instruction_data', idl: field.startsWith('accounts.') ? accountIdl : idl, field: `shared_accounts_route.${field}`, operator, value });
  const program = { field_source: 'solana_program_instruction', field: 'programId', operator: 'eq', value: JUPITER };
  // Shared DENY rules avoid duplicating the large argument decoder in each
  // 100-mint allowlist chunk. DENY takes precedence across the entire policy.
  const deny = (name, conditions) => ({ name, method: 'signTransaction', action: 'DENY', conditions: [program, ...conditions] });
  const rules = [
    { name: 'deny after policy expiry', method: 'signTransaction', action: 'DENY', conditions: [{ field_source: 'system', field: 'current_unix_timestamp', operator: 'gte', value: String(expiresAtUnix) }] },
    deny('deny excessive buy input', [condition('accounts.source_mint', 'eq', USDC), condition('args.in_amount', 'gt', '25000000')]),
    deny('deny excessive sell proceeds', [condition('accounts.destination_mint', 'eq', USDC), condition('args.quoted_out_amount', 'gt', '25000000')]),
    deny('deny excessive slippage', [condition('args.slippage_bps', 'gt', '50')]),
    deny('deny platform fees', [condition('args.platform_fee_bps', 'gt', '0')]),
    { name: 'allow compute budget', method: 'signTransaction', action: 'ALLOW', conditions: [{ field_source: 'solana_program_instruction', field: 'programId', operator: 'eq', value: COMPUTE }] },
  ];
  for (let offset = 0; offset < mints.length; offset += 100) {
    for (const side of ['buy', 'sell']) rules.push({
      name: `allow bounded jupiter ${side}${offset ? ` ${offset / 100 + 1}` : ''}`, method: 'signTransaction', action: 'ALLOW',
      conditions: [program,
        condition('accounts.source_mint', side === 'buy' ? 'eq' : 'in', side === 'buy' ? USDC : mints.slice(offset, offset + 100)),
        condition('accounts.destination_mint', side === 'buy' ? 'in' : 'eq', side === 'buy' ? mints.slice(offset, offset + 100) : USDC),
      ],
    });
  }
  const idls = rules.flatMap(rule => rule.conditions).filter(c => c.idl).map(c => Buffer.byteLength(JSON.stringify(c.idl)));
  if (idls.some(bytes => bytes > 32768) || idls.reduce((a, b) => a + b, 0) > 131072)
    throw new Error('Policy exceeds Privy IDL size limits');
  return { name: 'oren bounded stock trading', version: '1.0', chain_type: 'solana', owner_id: ownerId, rules };
}
