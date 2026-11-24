import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {compactRouteIdl,buildLaunchPolicy,selectLaunchMints,verifyLaunchMints} from './build-launch-policy.mjs';
const full=JSON.parse(readFileSync(new URL('../../api/src/mcp-auth/jupiter-shared-route.idl.json',import.meta.url)));
function layout(idl){const defs=new Map(idl.types.map(d=>[d.name,d.type]));function T(t){if(typeof t==='string')return t;if(t.defined){const d=defs.get(typeof t.defined==='string'?t.defined:t.defined.name);if(d.kind==='struct')return{struct:d.fields.map(f=>T(f.type))};return{enum:d.variants.map(v=>(v.fields??[]).map(f=>T(f.type??f)))}}if(t.vec)return{vec:T(t.vec)};if(t.option)return{option:T(t.option)};if(t.array)return{array:[T(t.array[0]),t.array[1]]};throw Error('Unknown layout')}return idl.instructions.map(i=>({name:i.name,discriminator:i.discriminator,accounts:i.accounts.map(a=>a.name),args:i.args.map(a=>({name:a.name,type:T(a.type)}))}))}
test('compact IDL preserves every binary variant, field order, width, discriminator and public path',()=>{const compact=compactRouteIdl(full);assert.deepEqual(layout(compact),layout(full));assert.ok(JSON.stringify(compact).length<8400)});
test('bounded buy and sell rules retain expiry, caps, exact route and mint membership',()=>{
  const stock='SPCXxcqXj6e5dJDVNovHN8744zkbhM2bYudU45BimGb';
  const template={rules:[{name:'deny after expiry',method:'signTransaction',action:'DENY',conditions:[{field_source:'system',field:'current_unix_timestamp',operator:'gte',value:'1794532352'}]},{name:'allow compute budget',method:'signTransaction',action:'ALLOW',conditions:[{field_source:'solana_program_instruction',field:'programId',operator:'eq',value:'ComputeBudget111111111111111111111111111111'}]},{name:'template',conditions:[{idl:full}]}]};
  const fixed=buildLaunchPolicy(template,[stock]);assert.equal(fixed.rules.length,4);assert.deepEqual(fixed.rules[0],template.rules[0]);
  for(const [n,side]of ['buy','sell'].entries()){
    const r=fixed.rules[n+2];assert.equal(r.name,'allow bounded jupiter '+side);
    assert.ok(r.conditions.some(c=>c.field.endsWith(side==='buy'?'args.in_amount':'args.quoted_out_amount')&&c.operator==='lte'&&c.value==='25000000'));
    assert.ok(r.conditions.some(c=>c.field.endsWith('args.slippage_bps')&&c.value==='50'));
    assert.ok(r.conditions.some(c=>c.field.endsWith('args.platform_fee_bps')&&c.operator==='eq'&&c.value==='0'));
    for(const c of r.conditions.filter(c=>c.idl))assert.deepEqual(layout(c.idl),layout(full));
    assert.ok(r.conditions.some(c=>c.operator==='in'&&c.value[0]===stock));
  }
  assert.throws(()=>buildLaunchPolicy(template,[]),/mint list/);
  assert.throws(()=>buildLaunchPolicy(template,['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v']),/mint list/);
});
test('provisioning uses only the reviewed subset and rejects missing, broad, duplicate or stale selections',()=>{
  const a='SPCXxcqXj6e5dJDVNovHN8744zkbhM2bYudU45BimGb',b='TSLAqBbv4CNCnzWFeB7LmydAyEiNMJtve7DYKLpdK4S';
  assert.deepEqual(selectLaunchMints([a,b],[a]),[a]);
  for(const selected of [undefined,[],[a,a],[b],Array(101).fill(a)])assert.throws(()=>selectLaunchMints([a],selected));
});
test('verifies an omitted reviewed mint by exact address without substituting another variant', async () => {
  const listed = 'SPCXxcqXj6e5dJDVNovHN8744zkbhM2bYudU45BimGb';
  const omitted = 'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh';
  const variant = { mint: omitted, tradable: true };
  const calls = [];
  const tokens = {
    async resolveMint(mint) {
      calls.push(mint);
      assert.equal(mint, omitted);
      return { id: 'nvidia' };
    },
    async getRawVariants(assetId) {
      assert.equal(assetId, 'nvidia');
      return [{ mint: listed, tradable: true }, variant];
    },
  };
  assert.deepEqual(await verifyLaunchMints([listed], [listed, omitted], tokens), [listed, omitted].sort());
  assert.deepEqual(calls, [omitted]);
  variant.tradable = false;
  await assert.rejects(verifyLaunchMints([listed], [listed, omitted], tokens), /nontradable/);
  await assert.rejects(verifyLaunchMints([], ['invalid-mint'], tokens), /explicitly reviewed/);
  assert.deepEqual(calls, [omitted, omitted]);
  delete variant.tradable;
  await assert.rejects(verifyLaunchMints([listed], [listed, omitted], tokens), /nontradable/);
  await assert.rejects(verifyLaunchMints([listed], [listed, omitted], {
    resolveMint: async () => null,
    getRawVariants: async () => assert.fail('An unresolved mint must never supply variants'),
  }), /nontradable/);
});
