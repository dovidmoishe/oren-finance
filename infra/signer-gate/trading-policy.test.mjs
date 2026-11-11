import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTradingPolicy, samePolicySemantics, tradingPolicyIdl } from './trading-policy.mjs';
import { readFileSync } from 'node:fs';
const stock = 'TSLAqBbv4CNCnzWFeB7LmydAyEiNMJtve7DYKLpdK4S';
const usdc = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const jupiter = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';
const idl = { address: jupiter, metadata: { name: 'jupiter', version: '0.1.0', spec: '0.1.0' }, instructions: [{ name: 'shared_accounts_route', discriminator: [193,32,155,51,65,214,156,129], accounts: ['user_transfer_authority','source_mint','destination_mint','source_token_account','destination_token_account'].map(name => ({ name })), args: ['in_amount','quoted_out_amount','slippage_bps','platform_fee_bps'].map(name => ({name,type:'u64'})) }], types: [] };
const input = { idl, stockMints: [stock], ownerId: 'separate-policy-owner', nowUnix: 100000, expiresAtUnix: 200000 };

test('until-revoked candidates omit only the time cutoff and require explicit opt-in', () => {
  const timed = buildTradingPolicy(input);
  const durable = buildTradingPolicy({ ...input, expiresAtUnix: null, untilRevoked: true });
  assert.deepEqual(durable.rules, timed.rules.slice(1));
  assert.throws(() => buildTradingPolicy({ ...input, expiresAtUnix: null }));
  assert.throws(() => buildTradingPolicy({ ...input, untilRevoked: true }));
});
const policy = buildTradingPolicy(input);
// Privy's documented semantics: all conditions in a rule, deny precedence,
// and an allow for every top-level instruction. This exercises the boundary.
function allowed(instructions, method = 'signTransaction', now = 150000) {
  return instructions.every(instruction => {
    const matching = policy.rules.filter(rule => rule.method === method && rule.conditions.every(c => {
      const actual = c.field_source === 'system' ? now : c.field === 'programId' ? instruction.programId : instruction[c.field];
      if (actual == null) return false;
      if (c.operator === 'eq') return String(actual) === c.value;
      if (c.operator === 'in') return c.value.includes(actual);
      if (c.operator === 'lte') return BigInt(actual) <= BigInt(c.value);
      if (c.operator === 'gt') return BigInt(actual) > BigInt(c.value);
      if (c.operator === 'gte') return BigInt(actual) >= BigInt(c.value);
      return false;
    }));
    return matching.some(rule => rule.action === 'ALLOW') && !matching.some(rule => rule.action === 'DENY');
  });
}
const route = (sell = false) => ({ programId: jupiter, 'shared_accounts_route.args.in_amount': sell ? '123456789' : '25000000', 'shared_accounts_route.args.quoted_out_amount': sell ? '25000000' : '123456789', 'shared_accounts_route.args.slippage_bps': '50', 'shared_accounts_route.args.platform_fee_bps': '0', 'shared_accounts_route.accounts.source_mint': sell ? stock : usdc, 'shared_accounts_route.accounts.destination_mint': sell ? usdc : stock });
test('supports stock buys and sells with bounded USDC legs and sign-only methods', () => {
  assert.equal(allowed([route()]), true);
  assert.equal(allowed([route(true)]), true);
  assert.equal(allowed([route(true)], 'signAndSendTransaction'), false);
  assert.equal(allowed([route(true)], 'exportPrivateKey'), false);
  assert.equal(allowed([route(true)], 'signMessage'), false);
});
test('rejects excess dollars, price tolerance, fees, unlisted mints and extra transfer instructions', () => {
  for (const sell of [false,true]) {
    const base = route(sell);
    for (const [key,value] of [
      [`shared_accounts_route.args.${sell ? 'quoted_out_amount' : 'in_amount'}`, '25000001'],
      ['shared_accounts_route.args.slippage_bps','51'],
      ['shared_accounts_route.args.platform_fee_bps','1'],
      [`shared_accounts_route.accounts.${sell ? 'source_mint' : 'destination_mint'}`,'not-an-allowlisted-stock'],
      [`shared_accounts_route.accounts.${sell ? 'destination_mint' : 'source_mint'}`,stock],
    ]) assert.equal(allowed([{...base,[key]:value}]),false, `${sell}:${key}`);
    assert.equal(allowed([base, {programId:'11111111111111111111111111111111'}]),false);
    assert.equal(allowed([base], 'signTransaction', 200000),false);
  }
});
test('retains account order and argument decoder while fitting aggregate IDL limits', () => {
  const large = structuredClone(idl);
  large.metadata.description = 'x'.repeat(16000);
  const p = buildTradingPolicy({...input,idl:large});
  const conditions = p.rules.flatMap(rule=>rule.conditions).filter(c=>c.idl);
  assert.ok(conditions.reduce((sum,c)=>sum+Buffer.byteLength(JSON.stringify(c.idl)),0)<=131072);
  for(const c of conditions) {
    assert.deepEqual(c.idl.instructions[0].accounts,idl.instructions[0].accounts);
    assert.deepEqual(c.idl.instructions[0].args,idl.instructions[0].args);
  }
});
test('fails closed on invalid route identity, empty mints and excessive policy lifetime', () => {
  for(const changed of [{stockMints:[]},{stockMints:[usdc]},{stockMints:['*']},{expiresAtUnix:100000+8*86400},{expiresAtUnix:100001},{idl:{...idl,address:usdc}}])
    assert.throws(()=>buildTradingPolicy({...input,...changed}));
});

test('complete instruction decoders fit a verified 100-mint list; broader lists fail closed', () => {
  const productionIdl = JSON.parse(readFileSync(new URL('../../api/src/mcp-auth/jupiter-shared-route.idl.json', import.meta.url)));
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const mints = Array.from({length:403},(_,i)=>stock.slice(0,-3)+alphabet[Math.floor(i/3364)]+alphabet[Math.floor(i/58)%58]+alphabet[i%58]);
  const p = buildTradingPolicy({...input,idl:productionIdl,stockMints:mints.slice(0,100)});
  assert.equal(p.rules.length,4);
  const withCreation = buildTradingPolicy({...input,idl:productionIdl,stockMints:mints.slice(0,100),allowDestinationAccountCreation:true});
  assert.equal(withCreation.rules.length,6);
  assert.ok(withCreation.rules.flatMap(r=>r.conditions).reduce((n,c)=>n+(c.idl?Buffer.byteLength(JSON.stringify(c.idl)):0),0)<=131072);
  assert.ok(withCreation.rules.flatMap(r=>r.conditions).filter(c=>c.operator==='in').every(c=>c.value.length<=100));
  assert.throws(()=>buildTradingPolicy({...input,idl:productionIdl,stockMints:mints}),/at most 100/);
  assert.ok(p.rules.flatMap(r=>r.conditions).filter(c=>c.operator==='in').every(c=>c.value.length<=100));
  assert.equal(p.rules.filter(r=>r.name.startsWith('allow bounded jupiter sell')).length,1);
  assert.deepEqual(tradingPolicyIdl(p).instructions[0].args.map(a=>a.name),productionIdl.instructions[0].args.map(a=>a.name));
  assert.doesNotThrow(()=>buildTradingPolicy({...input,idl:tradingPolicyIdl(p),stockMints:mints.slice(0,100)}));
  const accountOnly = {rules:[{conditions:[{idl:{...productionIdl,instructions:productionIdl.instructions.map(i=>({...i,args:[]}))}}]}]};
  assert.throws(()=>tradingPolicyIdl(accountOnly),/complete Jupiter/);
});

test('readback ignores object-key order and provider IDs but rejects changed policy semantics', () => {
  const stored = structuredClone(policy);
  stored.id = 'provider-id';
  stored.rules[0].id = 'rule-id';
  assert.equal(samePolicySemantics(policy,stored),true);
  stored.rules[0].conditions[0].value = '999999';
  assert.equal(samePolicySemantics(policy,stored),false);
});

test('account creation is opt-in, restricted to reviewed mints/programs, and keeps all swap guards', () => {
  const p = buildTradingPolicy({...input, allowDestinationAccountCreation: true});
  assert.deepEqual(p.rules.slice(0,4), policy.rules);
  assert.equal(p.rules.length,6);
  const ataRules = p.rules.slice(4);
  for (const rule of ataRules) {
    assert.equal(rule.method, 'signTransaction');
    assert.equal(rule.action, 'ALLOW');
    const decoders = rule.conditions.filter(c=>c.idl);
    assert.equal(decoders.length,3);
    for (const c of decoders) {
      assert.deepEqual(c.idl.instructions[0].discriminator,[1]);
      assert.deepEqual(c.idl.instructions[0].args,[]);
      assert.deepEqual(c.idl.instructions[0].accounts.map(a=>a.name),['payer','associated_token','owner','mint','system_program','token_program']);
    }
    assert.equal(rule.conditions[0].value,'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
    assert.ok(rule.conditions.some(c=>c.field==='create_idempotent.accounts.system_program' && c.value==='11111111111111111111111111111111'));
  }
  assert.deepEqual(ataRules[0].conditions.find(c=>c.field==='create_idempotent.accounts.mint').value,[stock]);
  assert.equal(ataRules[1].conditions.find(c=>c.field==='create_idempotent.accounts.mint').value,usdc);
  assert.ok(p.rules.flatMap(r=>r.conditions).reduce((n,c)=>n+(c.idl?Buffer.byteLength(JSON.stringify(c.idl)):0),0)<128*1024);
});
