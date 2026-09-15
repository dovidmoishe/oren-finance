'use client';

import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { useCallback, useState } from 'react';
import {
  confirmCancelLimitOrder,
  confirmLimitOrder,
  prepareCancelLimitOrder,
  prepareLimitOrder,
} from '@/services';
import type { LimitOrderProposal } from '@/types';
import {
  decodeBase64Transaction,
  type TradeFlowStatus,
} from './use-quote-execution';
import { usePortfolioRefresh } from './use-portfolio-refresh';

export function useLimitOrderExecution(
  onConfirmed?: () => Promise<void> | void,
) {
  const { connection } = useConnection();
  const { connected, publicKey, sendTransaction } = useWallet();
  const { setVisible } = useWalletModal();
  const refreshPortfolio = usePortfolioRefresh();
  const [flowStatus, setFlowStatus] = useState<TradeFlowStatus>('idle');
  const [error, setError] = useState<string>();
  const [confirmation, setConfirmation] = useState<{
    signature: string;
    orderKey?: string;
  }>();

  const executeLimitOrder = useCallback(
    async (proposal: LimitOrderProposal) => {
      const wallet = publicKey?.toBase58();
      setError(undefined);
      setConfirmation(undefined);
      if (!connected || !wallet) {
        setVisible(true);
        return;
      }

      try {
        setFlowStatus('preparing');
        const prepared = await prepareLimitOrder({
          proposalId: proposal.id,
          wallet,
        });

        setFlowStatus('signing');
        const signature = await sendTransaction(
          decodeBase64Transaction(prepared.transaction),
          connection,
        );

        setFlowStatus('confirming');
        const confirmed = await confirmLimitOrder({
          proposalId: proposal.id,
          wallet,
          signature,
          orderKey: prepared.orderKey,
        });

        setConfirmation({
          signature: confirmed.signature,
          orderKey: confirmed.orderKey,
        });
        setFlowStatus('confirmed');
        await Promise.all([refreshPortfolio(), onConfirmed?.()]);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Limit order failed');
        setFlowStatus('failed');
      }
    },
    [
      connected,
      connection,
      onConfirmed,
      publicKey,
      refreshPortfolio,
      sendTransaction,
      setVisible,
    ],
  );

  const cancelLimitOrder = useCallback(
    async (orderKey: string) => {
      const wallet = publicKey?.toBase58();
      setError(undefined);
      if (!connected || !wallet) {
        setVisible(true);
        return;
      }

      try {
        setFlowStatus('preparing');
        const prepared = await prepareCancelLimitOrder({ orderKey, wallet });
        setFlowStatus('signing');
        const signature = await sendTransaction(
          decodeBase64Transaction(prepared.transaction),
          connection,
        );
        setFlowStatus('confirming');
        await confirmCancelLimitOrder({ orderKey, wallet, signature });
        setFlowStatus('confirmed');
        await Promise.all([refreshPortfolio(), onConfirmed?.()]);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Cancel failed');
        setFlowStatus('failed');
      }
    },
    [
      connected,
      connection,
      onConfirmed,
      publicKey,
      refreshPortfolio,
      sendTransaction,
      setVisible,
    ],
  );

  const resetFeedback = useCallback(() => {
    setFlowStatus('idle');
    setError(undefined);
    setConfirmation(undefined);
  }, []);

  return {
    confirmation,
    error,
    executeLimitOrder,
    cancelLimitOrder,
    flowStatus,
    resetFeedback,
    setError,
    setFlowStatus,
  };
}
