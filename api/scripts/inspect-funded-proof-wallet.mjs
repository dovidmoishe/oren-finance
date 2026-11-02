import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { Connection, PublicKey } from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';

config({
  path:
    process.env.PROOF_ENV_PATH ??
    fileURLToPath(new URL('../.env', import.meta.url)),
  quiet: true,
});

const walletAddress = process.env.PROOF_WALLET_ADDRESS;
const stockMintAddress = process.env.PROOF_STOCK_MINT;
const alchemyKey = process.env.ALCHEMY_API_KEY;
if (!walletAddress || !stockMintAddress || !alchemyKey)
  throw new Error(
    'Set PROOF_WALLET_ADDRESS, PROOF_STOCK_MINT and ALCHEMY_API_KEY',
  );

const wallet = new PublicKey(walletAddress);
const stockMint = new PublicKey(stockMintAddress);
const usdcMint = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const connection = new Connection(
  `https://solana-mainnet.g.alchemy.com/v2/${alchemyKey}`,
  'confirmed',
);
const stockMintInfo = await connection.getAccountInfo(stockMint, 'confirmed');
if (
  !stockMintInfo ||
  (!stockMintInfo.owner.equals(TOKEN_2022_PROGRAM_ID) &&
    !stockMintInfo.owner.equals(TOKEN_PROGRAM_ID))
)
  throw new Error('Proof stock mint has an unsupported token owner');

const usdcAta = getAssociatedTokenAddressSync(usdcMint, wallet);
const stockAta = getAssociatedTokenAddressSync(
  stockMint,
  wallet,
  false,
  stockMintInfo.owner,
);
const [solLamports, usdcAccount, stockAccount] = await Promise.all([
  connection.getBalance(wallet, 'confirmed'),
  connection.getAccountInfo(usdcAta, 'confirmed'),
  connection.getAccountInfo(stockAta, 'confirmed'),
]);
const [usdc, stock] = await Promise.all([
  usdcAccount
    ? connection.getTokenAccountBalance(usdcAta, 'confirmed')
    : undefined,
  stockAccount
    ? connection.getTokenAccountBalance(stockAta, 'confirmed')
    : undefined,
]);
console.log(
  JSON.stringify({
    wallet: walletAddress,
    solLamports,
    usdcAta: usdcAta.toBase58(),
    usdcAtaExists: Boolean(usdcAccount),
    usdcRaw: usdc?.value.amount ?? '0',
    stockAta: stockAta.toBase58(),
    stockAtaExists: Boolean(stockAccount),
    stockRaw: stock?.value.amount ?? '0',
  }),
);
