export function compactRouteIdl(idl) {
  const result = structuredClone(idl), letters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const label = n => n < 52 ? letters[n] : letters[Math.floor(n / 52) - 1] + letters[n % 52];
  if (result.types.length > 2704) throw new Error('Too many IDL types');
  result.metadata = {name:result.metadata?.name??'jupiter',version:result.metadata?.version??'0.1.0',spec:result.metadata?.spec??'0.1.0'};
  const names = new Map(result.types.map((d, n) => [d.name, label(n)]));
  const type = t => {
    if (typeof t === 'string') return t;
    if (t.defined) { const name = names.get(typeof t.defined === 'string' ? t.defined : t.defined.name); if (!name) throw new Error('Missing IDL type'); return { defined: { name } }; }
    if (t.vec) return { vec: type(t.vec) };
    if (t.option) return { option: type(t.option) };
    if (t.array) return { array: [type(t.array[0]), t.array[1]] };
    throw new Error('Unsupported IDL type');
  };
  for (const d of result.types) {
    d.name = names.get(d.name);
    if (d.type.kind === 'struct') d.type.fields = d.type.fields.map((f,n)=>({name:label(n),type:type(f.type)}));
    else if (d.type.kind === 'enum') d.type.variants = d.type.variants.map((v,n)=>({name:label(n),...(v.fields?.length?{fields:v.fields.map(f=>type(f.type??f))}:{})}));
    else throw new Error('Unsupported IDL definition');
  }
  for (const i of result.instructions) {
    i.accounts = i.accounts.map(a=>({name:a.name,...(a.address?{address:a.address}:{})}));
    for (const a of i.args) a.type=type(a.type);
  }
  return result;
}

function validateReviewedMints(reviewedMints) {
  if (!Array.isArray(reviewedMints) || !reviewedMints.length || reviewedMints.length > 100 || new Set(reviewedMints).size !== reviewedMints.length ||
      reviewedMints.some(m => typeof m !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(m) || m === 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'))
    throw Error('Provide an explicitly reviewed list of 1..100 unique stock mints');
}

/** Provisioning never silently chooses a subset or expands an approved list. */
export function selectLaunchMints(catalogMints, reviewedMints) {
  validateReviewedMints(reviewedMints);
  const tradable = new Set(catalogMints);
  if (reviewedMints.some(m => !tradable.has(m)))
    throw Error('Reviewed launch list contains a nontradable or invalid stock mint');
  return [...reviewedMints].sort();
}

/** The curated catalog can omit variants that are still individually tradable. */
export async function verifyLaunchMints(catalogMints, reviewedMints, tokens) {
  validateReviewedMints(reviewedMints);
  const tradable = new Set(catalogMints);
  for (const mint of reviewedMints) {
    if (tradable.has(mint)) continue;
    const stock = await tokens.resolveMint(mint);
    if (!stock) continue;
    const variants = await tokens.getVariants(stock.id);
    if (variants.some(variant => variant.mint === mint && variant.tradable))
      tradable.add(mint);
  }
  return selectLaunchMints(tradable, reviewedMints);
}
/** Build a bounded launch policy within Privy's 128 KiB aggregate IDL limit. */
export function buildLaunchPolicy(template, selectedMints, { allowDestinationAccountCreation = false, untilRevoked = false } = {}) {
  const mints=[...new Set(selectedMints)];
  const usdc='EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
  if(!mints.length||mints.length>100||mints.includes(usdc)||mints.some(m=>typeof m!=='string'||!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(m)))throw Error('Invalid launch mint list');
  const full=template.rules.flatMap(r=>r.conditions??[]).find(c=>c.idl?.instructions?.length===1&&c.idl.instructions[0].name==='shared_accounts_route'&&Array.isArray(c.idl.types)&&c.idl.instructions[0].args?.length)?.idl;
  if(!full||full.address!=='JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4')throw Error('Missing canonical Jupiter IDL');
  const idl=compactRouteIdl(full),clean=r=>({name:r.name,method:r.method,action:r.action,conditions:structuredClone(r.conditions)});
  const expiry=template.rules.find(r=>r.action==='DENY'&&r.conditions?.some(c=>c.field_source==='system'&&c.field==='current_unix_timestamp'&&c.operator==='gte'));
  const compute=template.rules.find(r=>r.name==='allow compute budget');
  if(Boolean(expiry)===untilRevoked||!compute||compute.conditions?.length!==1||compute.conditions[0].value!=='ComputeBudget111111111111111111111111111111')throw Error('Policy expiry or compute guard differs from the requested terms');
  const C=(field,operator,value)=>({field_source:'solana_instruction_data',field:'shared_accounts_route.'+field,operator,value,idl});
  const rule=side=>({name:'allow bounded jupiter '+side,method:'signTransaction',action:'ALLOW',conditions:[
    {field_source:'solana_program_instruction',field:'programId',operator:'eq',value:full.address},
    C(side==='buy'?'args.in_amount':'args.quoted_out_amount','lte','25000000'),
    C('args.slippage_bps','lte','50'),C('args.platform_fee_bps','eq','0'),
    C('accounts.source_mint',side==='buy'?'eq':'in',side==='buy'?usdc:mints),
    C('accounts.destination_mint',side==='buy'?'in':'eq',side==='buy'?mints:usdc),
  ]});
  const rules=[...(expiry?[clean(expiry)]:[]),clean(compute),rule('buy'),rule('sell')];
  if (allowDestinationAccountCreation) {
    // ATA CreateIdempotent is a one-byte discriminator with no arguments.
    // The two independent transaction validators additionally bind payer,
    // owner, mint and derived destination to the authenticated wallet/intent.
    const ata = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
    const ataIdl = {
      address: ata,
      metadata: { name: 'associated_token', version: '1.0.0', spec: '0.1.0' },
      instructions: [{ name: 'create_idempotent', discriminator: [1],
        accounts: ['payer', 'associated_token', 'owner', 'mint', 'system_program', 'token_program'].map(name => ({ name })), args: [] }],
      types: [],
    };
    const A = (field, operator, value) => ({ field_source: 'solana_instruction_data', field: 'create_idempotent.accounts.' + field, operator, value, idl: ataIdl });
    for (const [name, operator, value] of [['stock', 'in', mints], ['usdc', 'eq', usdc]]) {
      rules.push({ name: 'allow idempotent ' + name + ' account', method: 'signTransaction', action: 'ALLOW', conditions: [
        { field_source: 'solana_program_instruction', field: 'programId', operator: 'eq', value: ata },
        A('mint', operator, value),
        A('system_program', 'eq', '11111111111111111111111111111111'),
        A('token_program', 'in', ['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb']),
      ] });
    }
  }
  if(rules.flatMap(r=>r.conditions).reduce((n,c)=>n+(c.idl?Buffer.byteLength(JSON.stringify(c.idl)):0),0)>128*1024)throw Error('Policy exceeds aggregate IDL limit');
  return {...structuredClone(template),rules};
}
