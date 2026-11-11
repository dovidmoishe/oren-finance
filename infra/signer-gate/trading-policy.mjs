import { buildLaunchPolicy } from './build-launch-policy.mjs';
import { isDeepStrictEqual } from 'node:util';
const JUPITER = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const COMPUTE = 'ComputeBudget111111111111111111111111111111';
const mintPattern = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const requiredArgs = ['in_amount', 'quoted_out_amount', 'slippage_bps', 'platform_fee_bps'];

export function tradingPolicyIdl(policy) {
  const idl = policy.rules?.flatMap(rule => rule.conditions ?? []).map(c => c.idl).find(candidate =>
    candidate?.instructions?.length === 1 &&
    candidate.instructions[0].name === 'shared_accounts_route' &&
    requiredArgs.every(name => candidate.instructions[0].args?.some(arg => arg.name === name)));
  if (!idl) throw new Error('Reviewed policy has no complete Jupiter argument IDL');
  return idl;
}

export function samePolicySemantics(a, b) {
  const normalize = policy => ({ owner_id: policy.owner_id, chain_type: policy.chain_type, version: policy.version,
    rules: policy.rules?.map(rule => ({ name: rule.name, method: rule.method, action: rule.action,
      conditions: rule.conditions?.map(c => ({ field_source: c.field_source, field: c.field, operator: c.operator, value: c.value, idl: c.idl ?? null })) })) });
  return isDeepStrictEqual(normalize(a), normalize(b));
}

/** A new policy; never expands an enrolled wallet's policy in place. */
export function buildTradingPolicy({ idl, stockMints, ownerId, expiresAtUnix, nowUnix = Math.floor(Date.now() / 1000), allowDestinationAccountCreation = false, untilRevoked = false }) {
  const route = idl?.instructions?.[0];
  if (!ownerId || idl?.address !== JUPITER || idl.instructions.length !== 1 ||
      route?.name !== 'shared_accounts_route' ||
      JSON.stringify(route.discriminator) !== '[193,32,155,51,65,214,156,129]' ||
      !requiredArgs.every(name => route.args?.some(arg => arg.name === name)) ||
      !['source_mint', 'destination_mint', 'user_transfer_authority', 'source_token_account', 'destination_token_account'].every(name => route.accounts?.some(account => account.name === name)))
    throw new Error('Expected the reviewed Jupiter shared-route IDL and separate policy owner');
  if (untilRevoked ? expiresAtUnix !== null :
      !Number.isSafeInteger(expiresAtUnix) || expiresAtUnix <= nowUnix + 3600 || expiresAtUnix > nowUnix + 7 * 86400)
    throw new Error('Policy expiry must be between one hour and seven days');
  const mints = [...new Set(stockMints)].sort();
  if (!mints.length || mints.length > 100 || mints.some(mint => !mintPattern.test(mint) || mint === USDC))
    throw new Error('Expected an explicit stock mint allowlist of at most 100 mints');
  return buildLaunchPolicy({ name:'oren bounded stock trading',version:'1.0',chain_type:'solana',owner_id:ownerId,rules:[
    ...(untilRevoked ? [] : [{name:'deny after policy expiry',method:'signTransaction',action:'DENY',conditions:[{field_source:'system',field:'current_unix_timestamp',operator:'gte',value:String(expiresAtUnix)}]}]),
    {name:'allow compute budget',method:'signTransaction',action:'ALLOW',conditions:[{field_source:'solana_program_instruction',field:'programId',operator:'eq',value:COMPUTE}]},
    {name:'reviewed argument decoder',conditions:[{idl}]},
  ]},mints,{allowDestinationAccountCreation, untilRevoked});
}
