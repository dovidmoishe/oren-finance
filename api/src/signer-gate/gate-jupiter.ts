import {
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  unpackMint,
} from '@solana/spl-token';
import { ComputeBudgetProgram, Connection, PublicKey } from '@solana/web3.js';
import type { mcpTradeIntents } from '../database/schema';
import { USDC_MINT } from '../config/constants';
import type { JupiterClient } from '../execution/jupiter/jupiter.client';
import type { TokensService } from '../tokens/tokens.service';
import type { ApprovalRpc } from '../execution/approval-rpc.service';
import { inspectDelegatedJupiterTransaction } from '../mcp-auth/delegated-jupiter-guard';
import { staticJupiterAccounts } from './static-jupiter-accounts';
import { buyNotionalUsd, microsUsd } from '../mcp-auth/trade-budget';
import { rawSellReferenceUsd } from '../mcp-auth/delegated-amounts';

type Intent = typeof mcpTradeIntents.$inferSelect;

export type GateRoute = {
  transaction: string;
  rawInput: string;
  quotedOutputRaw: string;
  minimumOutputRaw: string;
  referenceValueUsd?: string;
  quotedProceedsUsd?: string;
  lastValidBlockHeight?: number;
};

function positiveRaw(value: string | null | undefined): value is string {
  return typeof value === 'string' && /^\d+$/.test(value) && BigInt(value) > 0n;
}

/** Gate-owned quote and transaction build. The MCP API supplies only an intent ID. */
export async function buildGateJupiterRoute(
  intent: Intent,
  deps: {
    jupiter: JupiterClient;
    tokens: TokensService;
    rpc: ApprovalRpc;
    connection: Connection;
  },
): Promise<GateRoute> {
  if (
    intent.mode !== 'delegated' ||
    intent.status !== 'prepared' ||
    intent.expiresAt <= new Date() ||
    !intent.stockMint ||
    !positiveRaw(intent.maxInRaw) ||
    !positiveRaw(intent.minOutRaw) ||
    !Number.isInteger(intent.slippageBps) ||
    intent.slippageBps < 1 ||
    intent.slippageBps > 50
  )
    throw new Error('Prepared intent is unavailable for delegation');
  if (
    intent.side === 'buy' &&
    !buyNotionalUsd(intent.maxInRaw, intent.amountUsd)
  )
    throw new Error('Buy amount differs from raw USDC input');
  const stock = await deps.tokens.getStock(intent.assetId);
  const variant = stock.variants.find(
    (item) => item.mint === intent.stockMint && item.tradable,
  );
  if (stock.id !== intent.assetId || !variant)
    throw new Error('Prepared stock mint is no longer allowlisted');
  const mint = new PublicKey(intent.stockMint);
  const wallet = new PublicKey(intent.wallet);
  const mintAccount = await deps.connection.getAccountInfo(mint, 'confirmed');
  if (
    !mintAccount ||
    ![TOKEN_PROGRAM_ID.toBase58(), TOKEN_2022_PROGRAM_ID.toBase58()].includes(
      mintAccount.owner.toBase58(),
    )
  )
    throw new Error('Stock mint uses an unsupported token program');
  const stockProgram = mintAccount.owner;
  const stockAta = getAssociatedTokenAddressSync(
    mint,
    wallet,
    false,
    stockProgram,
  );
  const usdcAta = getAssociatedTokenAddressSync(
    new PublicKey(USDC_MINT),
    wallet,
  );
  const sourceAta = intent.side === 'buy' ? usdcAta : stockAta;
  const destinationAta = intent.side === 'buy' ? stockAta : usdcAta;
  const [sourceAccount, destinationAccount] = await Promise.all([
    deps.connection.getAccountInfo(sourceAta, 'confirmed'),
    deps.connection.getAccountInfo(destinationAta, 'confirmed'),
  ]);
  if (!sourceAccount || !destinationAccount)
    throw new Error(
      'Headless Jupiter requires existing source and destination token accounts',
    );
  const inputMint = intent.side === 'buy' ? USDC_MINT : intent.stockMint;
  const outputMint = intent.side === 'buy' ? intent.stockMint : USDC_MINT;
  const quote = await deps.jupiter.getQuote({
    inputMint,
    outputMint,
    amount: intent.maxInRaw,
    slippageBps: intent.slippageBps,
  });
  if (
    quote.inputMint !== inputMint ||
    quote.outputMint !== outputMint ||
    quote.inAmount !== intent.maxInRaw ||
    quote.swapMode !== 'ExactIn' ||
    !positiveRaw(quote.outAmount) ||
    !positiveRaw(quote.otherAmountThreshold) ||
    BigInt(quote.otherAmountThreshold) < BigInt(intent.minOutRaw) ||
    quote.slippageBps > intent.slippageBps
  )
    throw new Error('Fresh Jupiter quote moved outside the reviewed terms');
  const swap = await deps.jupiter.postSwap({
    quoteResponse: quote,
    userPublicKey: intent.wallet,
    wrapAndUnwrapSol: false,
    dynamicComputeUnitLimit: true,
    useSharedAccounts: true,
    trackingAccount: null,
  });
  if (!swap.swapTransaction) throw new Error('Jupiter returned no transaction');
  const protectedKeys = new Set([
    intent.wallet,
    inputMint,
    outputMint,
    sourceAta.toBase58(),
    destinationAta.toBase58(),
    ComputeBudgetProgram.programId.toBase58(),
  ]);
  const resolve = async (key: PublicKey) =>
    (await deps.connection.getAddressLookupTable(key)).value;
  const transaction = await staticJupiterAccounts(
    swap.swapTransaction,
    protectedKeys,
    resolve,
  );
  await inspectDelegatedJupiterTransaction(
    transaction,
    {
      wallet: intent.wallet,
      inputMint,
      outputMint,
      sourceAta: sourceAta.toBase58(),
      destinationAta: destinationAta.toBase58(),
      rawInput: quote.inAmount,
      maxInputRaw: intent.maxInRaw,
      quotedOutputRaw: quote.outAmount,
      maxSlippageBps: intent.slippageBps,
    },
    resolve,
  );
  await deps.rpc.inspect(transaction, intent.wallet, {
    inputMint,
    outputMint,
    maxInRaw: intent.maxInRaw,
    minOutRaw: quote.otherAmountThreshold,
  });
  let referenceValueUsd: string | undefined;
  let quotedProceedsUsd: string | undefined;
  if (intent.side === 'sell') {
    const mintState = unpackMint(mint, mintAccount, stockProgram);
    if (!mintState.isInitialized)
      throw new Error('Stock mint is uninitialized');
    referenceValueUsd = rawSellReferenceUsd(
      intent.maxInRaw,
      intent.amountShares,
      mintState.decimals,
      stock.price,
    );
    quotedProceedsUsd = microsUsd(BigInt(quote.outAmount));
  }
  return {
    transaction,
    rawInput: quote.inAmount,
    quotedOutputRaw: quote.outAmount,
    minimumOutputRaw: quote.otherAmountThreshold,
    referenceValueUsd,
    quotedProceedsUsd,
    lastValidBlockHeight: swap.lastValidBlockHeight,
  };
}
