'use client';

import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { VersionedTransaction } from '@solana/web3.js';
import { useCallback, useState } from 'react';
import { useExecutionStore } from '@/store';
import type { QuoteResponse } from '@/types';
import { usePortfolioRefresh } from './use-portfolio-refresh';

export type TradeFlowStatus =
  | 'idle'
  | 'quoted'
  | 'preparing'
  | 'signing'
  | 'confirming'
  | 'confirmed'
  | 'failed';

export function decodeBase64Transaction(transaction: string) {
  const binary = atob(transaction);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return VersionedTransaction.deserialize(bytes);
}

export function useQuoteExecution(onConfirmed?: () => Promise<void> | void) {
  const { connection } = useConnection();
  const { connected, publicKey, sendTransaction } = useWallet();
  const { setVisible } = useWalletModal();
  const refreshPortfolio = usePortfolioRefresh();
  const prepareTrade = useExecutionStore((state) => state.prepareTrade);
  const confirmTrade = useExecutionStore((state) => state.confirmTrade);
  const confirmation = useExecutionStore((state) => state.status);
  const storeError = useExecutionStore((state) => state.error);
  const [flowStatus, setFlowStatus] = useState<TradeFlowStatus>('idle');
  const [localError, setLocalError] = useState<string>();

  const executeQuote = useCallback(
    async (quote: QuoteResponse) => {
      const wallet = publicKey?.toBase58();
      setLocalError(undefined);
      if (!connected || !wallet) {
        setVisible(true);
        return;
      }
      if (new Date(quote.expiresAt).getTime() <= Date.now()) {
        setLocalError('This quote expired. Request a fresh quote before signing.');
        setFlowStatus('failed');
        return;
      }

      try {
        setFlowStatus('preparing');
        await prepareTrade({ quoteId: quote.id, wallet });
        const prepared = useExecutionStore.getState().prepared;
        if (!prepared) {
          throw new Error(useExecutionStore.getState().error ?? 'Unable to prepare transaction');
        }

        setFlowStatus('signing');
        const signature = await sendTransaction(
          decodeBase64Transaction(prepared.transaction),
          connection,
        );

        setFlowStatus('confirming');
        await confirmTrade(wallet, prepared.quoteId, signature);
        if (!useExecutionStore.getState().status) {
          throw new Error(useExecutionStore.getState().error ?? 'Unable to confirm transaction');
        }

        setFlowStatus('confirmed');
        await Promise.all([refreshPortfolio(), onConfirmed?.()]);
      } catch (error) {
        setLocalError(error instanceof Error ? error.message : 'Transaction failed');
        setFlowStatus('failed');
      }
    },
    [
      connected,
      confirmTrade,
      connection,
      onConfirmed,
      prepareTrade,
      publicKey,
      refreshPortfolio,
      sendTransaction,
      setVisible,
    ],
  );

  const resetFeedback = useCallback(() => {
    setFlowStatus('idle');
    setLocalError(undefined);
  }, []);

  return {
    confirmation,
    error: localError ?? storeError,
    executeQuote,
    flowStatus,
    resetFeedback,
    setError: setLocalError,
    setFlowStatus,
  };
}
