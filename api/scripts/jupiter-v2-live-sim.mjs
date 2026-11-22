// Manual, read-only mainnet check (no signing/sending): Jupiter /swap/v1 quote+swap with platformFeeBps=50, then simulateTransaction(sigVerify:false).
// Usage: USER_PK=<public wallet holding USDC or the stock> SELL_RAW=<raw stock amount> node scripts/jupiter-v2-live-sim.mjs
import { VersionedTransaction } from '@solana/web3.js';
const RPC='https://api.mainnet-beta.solana.com';
const rpc = async (method, params) => { for (let i=0;i<6;i++){ const r = await fetch(RPC,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})}); if (r.status===429){await new Promise(x=>setTimeout(x,2000));continue;} const j=await r.json(); if (j.error) throw new Error(JSON.stringify(j.error)); return j.result; } };
const USDC='EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const STOCK = process.env.STOCK || 'XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB';
const FEE_ACCOUNT='9mmkvFYJbWDojpp8xoZM4Cy6ufDo6j8bFabtgM5izdGH';
const USER = process.env.USER_PK;
const J='https://lite-api.jup.ag/swap/v1';
const amt = (b64) => { const d = Buffer.from(b64,'base64'); return d.readBigUInt64LE(64).toString(); };
const toks = await rpc('getTokenAccountsByOwner',[USER,{mint:USDC},{encoding:'jsonParsed'}]);
const usdcRaw = toks.value.reduce((s,a)=>s+Number(a.account.data.parsed.info.tokenAmount.amount),0);
console.log('user', USER, 'usdcRaw', usdcRaw);
const pre = amt((await rpc('getAccountInfo',[FEE_ACCOUNT,{encoding:'base64'}])).value.data[0]);
async function run(label, inputMint, outputMint, amount, version) {
  const q = new URLSearchParams({ inputMint, outputMint, amount: String(amount), slippageBps: '100', platformFeeBps: '50' });
  if (version) q.set('instructionVersion', version);
  const quote = await (await fetch(`${J}/quote?${q}`)).json();
  if (!quote.outAmount) return console.log(label, 'quote error', JSON.stringify(quote).slice(0, 300));
  const swap = await (await fetch(`${J}/swap`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ quoteResponse: quote, userPublicKey: USER, feeAccount: FEE_ACCOUNT, dynamicComputeUnitLimit: true }) })).json();
  if (!swap.swapTransaction) return console.log(label, 'swap error', JSON.stringify(swap).slice(0, 300));
  const tx = VersionedTransaction.deserialize(Buffer.from(swap.swapTransaction, 'base64'));
  const keys = tx.message.staticAccountKeys;
  const jupIx = tx.message.compiledInstructions.find(ix => keys[ix.programIdIndex]?.toBase58() === 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4');
  const disc = jupIx ? Buffer.from(jupIx.data.slice(0, 8)).toString('hex') : 'none';
  const sim = await rpc('simulateTransaction',[swap.swapTransaction,{encoding:'base64',sigVerify:false,replaceRecentBlockhash:true,commitment:'confirmed',accounts:{encoding:'base64',addresses:[FEE_ACCOUNT]}}]);
  const post = sim.value.accounts?.[0] ? amt(sim.value.accounts[0].data[0]) : null;
  const ixLog = sim.value.logs?.find(l => l.startsWith('Program log: Instruction:') && sim.value.logs.indexOf(l) > 0);
  console.log(JSON.stringify({ label, instructionVersion: version || 'unset(V1)', inAmount: quote.inAmount, outAmount: quote.outAmount, quotePlatformFee: quote.platformFee, jupiterInstruction: ixLog, discriminator: disc, simErr: sim.value.err, unitsConsumed: sim.value.unitsConsumed, feeAccountPre: pre, feeAccountPost: post, feeReceivedRaw: post ? (BigInt(post)-BigInt(pre)).toString() : null }));
}
for (const v of [undefined, 'V2']) {
  if (usdcRaw >= 5_000_000) await run('BUY 5 USDC -> stock', USDC, STOCK, 5_000_000, v);
  await run('SELL stock -> USDC', STOCK, USDC, Number(process.env.SELL_RAW || 2000000), v);
}
