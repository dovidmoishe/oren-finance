import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { Connection } from '@solana/web3.js';
import alchemyModule from '../dist/src/alchemy/alchemy.client.js';
import approvalRpcModule from '../dist/src/execution/approval-rpc.service.js';
import jupiterGatewayModule from '../dist/src/execution/jupiter/jupiter-gateway.js';
import jupiterClientModule from '../dist/src/execution/jupiter/jupiter.client.js';
import tokensClientModule from '../dist/src/tokens/tokens.client.js';
import tokensServiceModule from '../dist/src/tokens/tokens.service.js';
import gateModule from '../dist/src/signer-gate/gate-jupiter.js';

config({ path: process.env.PROOF_ENV_PATH ?? fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });
if (process.env.PROOF_CHECK_FUNDED_ROUTE !== 'true')
  throw new Error('Set PROOF_CHECK_FUNDED_ROUTE=true for this unsigned check');
const wallet = process.env.PROOF_WALLET_ADDRESS;
const stockMint = process.env.PROOF_STOCK_MINT;
const side = process.env.PROOF_SIDE ?? 'buy';
if (!['buy', 'sell'].includes(side)) throw new Error('PROOF_SIDE must be buy or sell');
const alchemyKey = process.env.ALCHEMY_API_KEY;
const tokensKey = process.env.TOKENS_API_KEY;
if (!wallet || !stockMint || !alchemyKey || !tokensKey)
  throw new Error('Proof wallet, stock mint, Alchemy and Tokens settings are required');

const env = {
  ALCHEMY_API_KEY: alchemyKey,
  TOKENS_API_BASE_URL: process.env.TOKENS_API_BASE_URL ?? 'https://api.tokens.xyz',
  TOKENS_API_KEY: tokensKey,
  JUPITER_API_KEY: process.env.JUPITER_API_KEY,
  JUPITER_MAX_RPS: 1,
};
const { AlchemyClient } = alchemyModule;
const { ApprovalRpc } = approvalRpcModule;
const { JupiterGateway } = jupiterGatewayModule;
const { JupiterClient } = jupiterClientModule;
const { TokensClient } = tokensClientModule;
const { TokensService } = tokensServiceModule;
const { buildGateJupiterRoute } = gateModule;
const deps = {
  jupiter: new JupiterClient(env, new JupiterGateway(env)),
  tokens: new TokensService(new TokensClient(env)),
  rpc: new ApprovalRpc(new AlchemyClient(env)),
  connection: new Connection(`https://solana-mainnet.g.alchemy.com/v2/${alchemyKey}`, 'confirmed'),
};
const intent = {
  mode: 'delegated',
  status: 'prepared',
  side,
  assetId: 'tesla',
  stockMint,
  wallet,
  maxInRaw: side === 'buy' ? '1000000' : '1000',
  amountShares: side === 'sell' ? '0.001' : null,
  minOutRaw: '1',
  slippageBps: 50,
  expiresAt: new Date(Date.now() + 60_000),
};
const route = await buildGateJupiterRoute(intent, deps);
console.log(JSON.stringify({
  wallet,
  stockMint,
  side,
  rawInput: route.rawInput,
  quotedOutputRaw: route.quotedOutputRaw,
  minimumOutputRaw: route.minimumOutputRaw,
  referenceValueUsd: route.referenceValueUsd,
  quotedProceedsUsd: route.quotedProceedsUsd,
  unsignedBytes: Buffer.from(route.transaction, 'base64').length,
  simulated: true,
  signed: false,
  broadcast: false,
}));
