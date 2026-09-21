'use client';

import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { VersionedTransaction } from '@solana/web3.js';
import { useCallback, useEffect, useState } from 'react';
import { confirmExecution, getExecutionTrackingStatus } from '@/services';
import { useExecutionStore } from '@/store';
import type { QuoteResponse } from '@/types';
import { usePortfolioRefresh } from './use-portfolio-refresh';

export type TradeFlowStatus =
  | 'idle'
  | 'quoted'
  | 'preparing'
  | 'signing'
  | 'confirming'
  | 'submitted'
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

  useEffect(() => {
    const wallet = publicKey?.toBase58();
    if (!wallet) return;
    for (const pending of readPendingConfirmations().filter((item) => item.wallet === wallet)) {
      void confirmExecution(pending)
        .then(() => removePendingConfirmation(pending.signature))
        .catch(() => undefined);
    }
  }, [publicKey]);

  const executeQuote = useCallback(
    async (quote?: QuoteResponse) => {
      const wallet = publicKey?.toBase58();
      setLocalError(undefined);
      if (!connected || !wallet) {
        setVisible(true);
        return;
      }

      // Always prefer the freshest store quote (auto-refresh may have replaced it).
      const liveQuote = useExecutionStore.getState().quote ?? quote;
      if (!liveQuote) {
        setLocalError('Request a fresh quote before signing.');
        setFlowStatus('failed');
        return;
      }
      if (new Date(liveQuote.expiresAt).getTime() <= Date.now()) {
        setLocalError('This quote expired. Waiting for a fresh quote before signing.');
        setFlowStatus('failed');
        return;
      }

      let broadcastSignature: string | undefined;
      try {
        setFlowStatus('preparing');
        await prepareTrade({ quoteId: liveQuote.id, wallet });
        const prepared = useExecutionStore.getState().prepared;
        if (!prepared) {
          throw new Error(useExecutionStore.getState().error ?? 'Unable to prepare transaction');
        }

        setFlowStatus('signing');
        const signature = await sendTransaction(
          decodeBase64Transaction(prepared.transaction),
          connection,
        );
        broadcastSignature = signature;
        const pending = {
          executionId: prepared.executionId,
          quoteId: prepared.quoteId,
          wallet,
          signature,
        };
        savePendingConfirmation(pending);

        setFlowStatus('confirming');
        await confirmTrade(wallet, prepared.executionId, prepared.quoteId, signature);
        if (!useExecutionStore.getState().status) {
          throw new Error(useExecutionStore.getState().error ?? 'Unable to confirm transaction');
        }
        removePendingConfirmation(signature);
        setFlowStatus('submitted');
        void waitForVerification(prepared.executionId).then(async (verified) => {
          if (!verified) return;
          setFlowStatus('confirmed');
          await Promise.all([refreshPortfolio(), onConfirmed?.()]);
        });
      } catch (error) {
        if (broadcastSignature) {
          setLocalError('Submitted on-chain. Oren is syncing the verified fill in the background.');
          setFlowStatus('submitted');
          return;
        }
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

const PENDING_CONFIRMATIONS_KEY = 'oren.pending-confirmations.v1';
type PendingConfirmation = {
  executionId: string;
  quoteId: string;
  wallet: string;
  signature: string;
};

function readPendingConfirmations(): PendingConfirmation[] {
  if (typeof window === 'undefined') return [];
  try {
    const value = JSON.parse(window.localStorage.getItem(PENDING_CONFIRMATIONS_KEY) ?? '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function savePendingConfirmation(item: PendingConfirmation) {
  const items = readPendingConfirmations().filter((current) => current.signature !== item.signature);
  window.localStorage.setItem(PENDING_CONFIRMATIONS_KEY, JSON.stringify([...items, item]));
}

function removePendingConfirmation(signature: string) {
  if (typeof window === 'undefined') return;
  const items = readPendingConfirmations().filter((item) => item.signature !== signature);
  window.localStorage.setItem(PENDING_CONFIRMATIONS_KEY, JSON.stringify(items));
}

async function waitForVerification(executionId: string): Promise<boolean> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, 3_000));
    try {
      const result = await getExecutionTrackingStatus(executionId);
      if (result.status === 'confirmed') return true;
      if (result.status === 'failed') return false;
    } catch {
      // Background verification is best-effort from the user's perspective.
    }
  }
  return false;
}
