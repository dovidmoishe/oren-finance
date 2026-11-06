import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { PrivyClient } from '@privy-io/node';
import tokensClient from '/app/dist/src/tokens/tokens.client.js';
import tokensService from '/app/dist/src/tokens/tokens.service.js';
import gate from '/app/dist/src/signer-gate/signer-gate.service.js';
import { buildTradingPolicy, samePolicySemantics } from './trading-policy.mjs';
import { preparePolicyOwner } from './policy-owner.mjs';

const required = key => { if (!process.env[key]) throw new Error(`Missing ${key}`); return process.env[key]; };
const privy = new PrivyClient({ appId: required('PRIVY_APP_ID'), appSecret: required('PRIVY_APP_SECRET') });
const prior = await privy.policies().get(required('SIGNER_GATE_POLICY_ID'));
if (prior.owner_id !== required('SIGNER_GATE_POLICY_OWNER_ID') || gate.gatePolicyFingerprint(prior) !== required('SIGNER_GATE_POLICY_HASH'))
  throw new Error('The live policy no longer matches its reviewed fingerprint');
if (prior.owner_id === required('SIGNER_GATE_QUORUM_ID')) throw new Error('Policy owner must be separate from trade signers');
const idl = prior.rules.flatMap(rule => rule.conditions).find(condition => condition.idl)?.idl;
const tokens = new tokensService.TokensService(new tokensClient.TokensClient({ TOKENS_API_BASE_URL: process.env.TOKENS_API_BASE_URL ?? 'https://api.tokens.xyz', TOKENS_API_KEY: required('TOKENS_API_KEY') }));
let offset = 0;
let hasMore = true;
const stocks = [];
while (hasMore) {
  if (offset >= 10000) throw new Error('Stock catalog exceeds bounded pagination');
  const page = await tokens.getStocksPage(offset, 200);
  if (page.hasMore && page.stocks.length === 0) throw new Error('Incomplete stock catalog');
  stocks.push(...page.stocks);
  offset += 200;
  hasMore = page.hasMore;
}
const stockMints = stocks.flatMap(stock => stock.variants.filter(variant => variant.tradable).map(variant => variant.mint));
const resultPath = '/state/trading-policy.json';
const existing = existsSync(resultPath) ? JSON.parse(readFileSync(resultPath, 'utf8')) : null;
const expiresAtUnix = existing?.expiresAtUnix ?? Math.floor(Date.now() / 1000) + 7 * 86400;
const set = process.argv.includes('--create') ? await preparePolicyOwner(privy) : { ownerId: prior.owner_id };
const candidate = buildTradingPolicy({ idl, stockMints, ownerId: set.ownerId, expiresAtUnix });
const fingerprint = gate.gatePolicyFingerprint(candidate);
if (existing?.policyId && existing.candidateFingerprint !== fingerprint) throw new Error('Saved candidate differs from the catalog or policy; review a new state directory');
const result = { priorPolicyId: prior.id, candidate, fingerprint, candidateFingerprint: fingerprint, expiresAtUnix, stockMintCount: new Set(stockMints).size };
writeFileSync(resultPath, JSON.stringify(result), { mode: 0o600 });
if (process.argv.includes('--create')) {
  const policy = existing?.policyId ? await privy.policies().get(existing.policyId) : await privy.policies().create({ ...candidate, idempotency_key: `oren-trading-${createHash('sha256').update(JSON.stringify(candidate)).digest('hex').slice(0, 40)}` });
  if (!samePolicySemantics(candidate, policy) || policy.owner_id !== set.ownerId) {
    writeFileSync('/state/rejected-stored-policy.json', JSON.stringify({ policyId: policy.id, policy, candidate }), { mode: 0o600 });
    throw new Error('Privy stored a different policy; candidate remains unattached');
  }
  result.policyId = policy.id;
  const readback = await privy.policies().get(policy.id);
  if (!samePolicySemantics(candidate, readback)) throw new Error('Privy policy readback differs from the reviewed candidate');
  result.fingerprint = gate.gatePolicyFingerprint(readback);
}
writeFileSync(resultPath, JSON.stringify(result), { mode: 0o600 });
console.log(JSON.stringify({ created: Boolean(result.policyId), policyId: result.policyId, fingerprint: result.fingerprint, stockMintCount: result.stockMintCount, expiresAtUnix, attachedToWallets: false, productionConfigChanged: false }));
