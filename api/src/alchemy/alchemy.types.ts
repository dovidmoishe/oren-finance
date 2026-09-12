/** Alchemy Solana JSON-RPC / REST response shapes. */

export interface AlchemyRpcError {
  code: number;
  message: string;
}

export interface AlchemyRpcResponse<T> {
  jsonrpc: string;
  id: number | string;
  result?: T;
  error?: AlchemyRpcError;
}

export interface AlchemyTokenBalanceRaw {
  mint?: string;
  tokenAddress?: string;
  amount?: string | number;
  decimals?: number;
  uiAmount?: number | null;
  uiAmountString?: string;
}

export interface AlchemyTokenBalancesResult {
  address?: string;
  tokenBalances?: Array<{
    mint?: string;
    tokenAddress?: string;
    contractAddress?: string;
    amount?: string;
    decimals?: number;
    uiAmount?: number | null;
    uiAmountString?: string;
  }>;
}

export interface AlchemyTokenAccountRaw {
  pubkey?: string;
  account?: {
    data?: {
      parsed?: {
        info?: {
          mint?: string;
          owner?: string;
          tokenAmount?: {
            amount?: string;
            decimals?: number;
            uiAmount?: number | null;
            uiAmountString?: string;
          };
        };
      };
    };
  };
}

export interface AlchemySignatureInfo {
  signature?: string;
  slot?: number;
  blockTime?: number | null;
  err?: unknown;
  confirmationStatus?: string;
  memo?: string | null;
}
