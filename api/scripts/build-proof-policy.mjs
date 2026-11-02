import { config } from 'dotenv';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Connection, PublicKey } from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';

config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });

const JUPITER = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const side = process.env.PROOF_SIDE;
const stockMint = process.env.PROOF_STOCK_MINT;
const walletAddress = process.env.PROOF_WALLET_ADDRESS;
const maxInputRaw = process.env.PROOF_MAX_INPUT_RAW;
const slippageBps = Number(process.env.PROOF_MAX_SLIPPAGE_BPS ?? '50');
const expiresInHours = Number(process.env.PROOF_EXPIRES_IN_HOURS ?? '24');
if (
  !['buy', 'sell'].includes(side) ||
  !stockMint ||
  !walletAddress ||
  !/^[1-9]\d*$/.test(maxInputRaw ?? '') ||
  !Number.isInteger(slippageBps) ||
  slippageBps < 1 ||
  slippageBps > 50 ||
  !Number.isInteger(expiresInHours) ||
  expiresInHours < 1 ||
  expiresInHours > 168
) throw new Error('Set PROOF_SIDE, PROOF_STOCK_MINT, PROOF_WALLET_ADDRESS, positive PROOF_MAX_INPUT_RAW, slippage 1..50 bps and expiry 1..168 hours');
if (!process.env.ALCHEMY_API_KEY)
  throw new Error('ALCHEMY_API_KEY is required for read-only mint and ATA checks');
const wallet = new PublicKey(walletAddress);
const stock = new PublicKey(stockMint);
const inputMint = side === 'buy' ? USDC : stock.toBase58();
const outputMint = side === 'buy' ? stock.toBase58() : USDC;
const idlPath = fileURLToPath(new URL('../.proof/jupiter-shared-route.idl.json', import.meta.url));
if (!existsSync(idlPath))
  throw new Error('First run inspect-onchain-idl.mjs with PROOF_WRITE_CANDIDATE=true');
const idl = JSON.parse(readFileSync(idlPath, 'utf8'));
const route = idl.instructions?.[0];
if (
  idl.address !== JUPITER ||
  idl.instructions?.length !== 1 ||
  route?.name !== 'shared_accounts_route' ||
  Buffer.from(route.discriminator).toString('hex') !== 'c1209b3341d69c81'
) throw new Error('Jupiter policy IDL candidate does not match the verified route');
const idlBytes = Buffer.byteLength(JSON.stringify(idl));
if (idlBytes > 32 * 1024)
  throw new Error('Jupiter policy IDL exceeds Privy per-IDL limit');

const rpc = new Connection(
  `https://solana-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
  'confirmed',
);
const [inputAccount, outputAccount] = await Promise.all([
  rpc.getAccountInfo(new PublicKey(inputMint)),
  rpc.getAccountInfo(new PublicKey(outputMint)),
]);
if (!inputAccount || !outputAccount)
  throw new Error('A route mint account is missing');
for (const account of [inputAccount, outputAccount]) {
  if (!account.owner.equals(TOKEN_PROGRAM_ID) && !account.owner.equals(TOKEN_2022_PROGRAM_ID))
    throw new Error('A route mint is not owned by a supported token program');
}
const sourceAta = getAssociatedTokenAddressSync(
  new PublicKey(inputMint), wallet, false, inputAccount.owner,
).toBase58();
const destinationAta = getAssociatedTokenAddressSync(
  new PublicKey(outputMint), wallet, false, outputAccount.owner,
).toBase58();
const [sourceAccount, destinationAccount] = await Promise.all([
  rpc.getAccountInfo(new PublicKey(sourceAta)),
  rpc.getAccountInfo(new PublicKey(destinationAta)),
]);
const expiresAtUnix = Math.floor(Date.now() / 1000) + expiresInHours * 3600;
const idlCondition = (field, operator, value) => ({
  field_source: 'solana_instruction_data',
  idl,
  field: `shared_accounts_route.${field}`,
  operator,
  value,
});
const policy = {
  name: `oren disposable proof: jupiter ${side}`,
  version: '1.0',
  chain_type: 'solana',
  ...(process.env.PROOF_POLICY_ADMIN_QUORUM_ID
    ? { owner_id: process.env.PROOF_POLICY_ADMIN_QUORUM_ID }
    : {}),
  rules: [
    {
      name: 'deny after proof expiry',
      method: 'signTransaction',
      conditions: [{
        field_source: 'system',
        field: 'current_unix_timestamp',
        operator: 'gte',
        value: String(expiresAtUnix),
      }],
      action: 'DENY',
    },
    {
      name: 'allow compute budget',
      method: 'signTransaction',
      conditions: [{
        field_source: 'solana_program_instruction',
        field: 'programId',
        operator: 'eq',
        value: 'ComputeBudget111111111111111111111111111111',
      }],
      action: 'ALLOW',
    },
    {
      name: `allow bounded jupiter ${side}`,
      method: 'signTransaction',
      conditions: [
        {
          field_source: 'solana_program_instruction',
          field: 'programId',
          operator: 'eq',
          value: JUPITER,
        },
        idlCondition('args.in_amount', 'lte', maxInputRaw),
        idlCondition('args.slippage_bps', 'lte', String(slippageBps)),
        idlCondition('accounts.source_mint', 'eq', inputMint),
        idlCondition('accounts.destination_mint', 'eq', outputMint),
        idlCondition('accounts.source_token_account', 'eq', sourceAta),
        idlCondition('accounts.destination_token_account', 'eq', destinationAta),
      ],
      action: 'ALLOW',
    },
  ],
};
const idlConditionCount = policy.rules.flatMap((rule) => rule.conditions)
  .filter((condition) => condition.idl).length;
const aggregateIdlBytes = idlConditionCount * idlBytes;
if (aggregateIdlBytes > 128 * 1024)
  throw new Error('Policy exceeds Privy aggregate IDL limit');
const outputDirectory = fileURLToPath(new URL('../.proof/', import.meta.url));
mkdirSync(outputDirectory, { recursive: true });
const policyJson = JSON.stringify(policy);
writeFileSync(
  fileURLToPath(new URL(`../.proof/jupiter-${side}.policy.json`, import.meta.url)),
  policyJson,
  { flag: 'w', mode: 0o600 },
);
console.log(JSON.stringify({
  side,
  wallet: wallet.toBase58(),
  inputMint,
  outputMint,
  sourceAta,
  destinationAta,
  sourceAtaExists: Boolean(sourceAccount),
  destinationAtaExists: Boolean(destinationAccount),
  maxInputRaw,
  slippageBps,
  expiresAtUnix,
  ownerProtected: Boolean(policy.owner_id),
  idlBytes,
  idlConditionCount,
  aggregateIdlBytes,
  policyJsonBytes: Buffer.byteLength(policyJson),
  policySha256: createHash('sha256').update(policyJson).digest('hex'),
  writtenToLocalProofDirectory: true,
  readyForEnrollment: Boolean(policy.owner_id && sourceAccount && destinationAccount),
}));
