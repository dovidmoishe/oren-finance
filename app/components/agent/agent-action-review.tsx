'use client';

import {
  CheckmarkCircle01Icon,
  Loading03Icon,
  PauseCircleIcon,
  Wallet02Icon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { useEffect, useRef, useState } from 'react';
import { decodeBase64Transaction, useQuoteExecution } from '@/hooks/use-quote-execution';
import { useQuoteRefresh } from '@/hooks/use-quote-refresh';
import { useLimitOrderExecution } from '@/hooks/use-limit-order-execution';
import { usePortfolioRefresh } from '@/hooks/use-portfolio-refresh';
import { useExecutionStore } from '@/store';
import type {
  BasketExecutionProgress,
  BasketResponse,
  LimitOrderProposal,
  QuoteResponse,
} from '@/types';
import { Button, Modal, Toast } from '@/components/ui';
import { BasketReview } from '@/components/trading/basket-review';
import { QuoteReviewModal } from '@/components/trading/quote-review-modal';
import { LimitOrderReviewModal } from '@/components/trading/limit-order-review-modal';

interface AgentActionReviewProps {
  quote?: QuoteResponse;
  basket?: BasketResponse;
  limitOrder?: LimitOrderProposal;
  onClose: () => void;
}

export function AgentActionReview({
  quote,
  basket,
  limitOrder,
  onClose,
}: AgentActionReviewProps) {
  const seedQuoteIntoStore = useExecutionStore((state) => state.seedQuote);
  const storeQuote = useExecutionStore((state) => state.quote);
  const { confirmation, error, executeQuote, flowStatus, resetFeedback } =
    useQuoteExecution();
  const {
    confirmation: limitConfirmation,
    error: limitError,
    executeLimitOrder,
    flowStatus: limitFlowStatus,
    resetFeedback: resetLimitFeedback,
  } = useLimitOrderExecution();
  const {
    secondsLeft,
    isRefreshingQuote,
    refreshFailed,
    refreshQuote,
  } = useQuoteRefresh({
    enabled: Boolean(quote),
    flowStatus,
    seedQuote: quote,
  });

  useEffect(() => {
    if (!quote) return;
    seedQuoteIntoStore(quote);
    resetFeedback();
  }, [quote, resetFeedback, seedQuoteIntoStore]);

  useEffect(() => {
    if (!limitOrder) return;
    resetLimitFeedback();
  }, [limitOrder, resetLimitFeedback]);

  if (limitOrder) {
    return (
      <LimitOrderReviewModal
        confirmation={limitConfirmation}
        error={limitError}
        onClose={onClose}
        onSign={() => executeLimitOrder(limitOrder)}
        open
        proposal={limitOrder}
        status={limitFlowStatus === 'idle' ? 'quoted' : limitFlowStatus}
      />
    );
  }

  if (quote) {
    const liveQuote = storeQuote?.assetId === quote.assetId ? storeQuote : quote;
    return (
      <QuoteReviewModal
        confirmation={confirmation}
        error={error}
        isRefreshingQuote={isRefreshingQuote}
        onClose={onClose}
        onRefreshQuote={() => void refreshQuote()}
        onSign={() => executeQuote()}
        open
        quote={liveQuote}
        refreshFailed={refreshFailed}
        secondsLeft={secondsLeft}
        status={flowStatus === 'idle' ? 'quoted' : flowStatus}
      />
    );
  }

  return basket ? <BasketExecutionReview basket={basket} onClose={onClose} /> : null;
}

function BasketExecutionReview({
  basket,
  onClose,
}: {
  basket: BasketResponse;
  onClose: () => void;
}) {
  const { connection } = useConnection();
  const { connected, publicKey, sendTransaction } = useWallet();
  const { setVisible } = useWalletModal();
  const prepareBasketTrades = useExecutionStore((state) => state.prepareBasketTrades);
  const confirmTrade = useExecutionStore((state) => state.confirmTrade);
  const resetTrade = useExecutionStore((state) => state.resetTrade);
  const refreshPortfolio = usePortfolioRefresh();
  const [progress, setProgress] = useState<BasketExecutionProgress>();
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);
  const [nextLeg, setNextLeg] = useState(0);
  const [error, setError] = useState<string>();
  const stopRequested = useRef(false);

  const run = async () => {
    const wallet = publicKey?.toBase58();
    if (!connected || !wallet) {
      setVisible(true);
      return;
    }
    setBusy(true);
    setError(undefined);
    stopRequested.current = false;

    try {
      let current = progress;
      if (!current) {
        await prepareBasketTrades({ basketId: basket.id, wallet });
        current = useExecutionStore.getState().preparedBasket?.progress;
        if (!current) {
          throw new Error(
            useExecutionStore.getState().error ?? 'Unable to prepare basket transactions',
          );
        }
        setProgress(current);
      }

      for (let index = nextLeg; index < current.legs.length; index += 1) {
        if (stopRequested.current) {
          setNextLeg(index);
          break;
        }
        const leg = current.legs[index];
        const prepared =
          leg.preparedTransaction ??
          useExecutionStore.getState().preparedBasket?.transactions[index];
        if (!prepared) {
          current = updateLeg(current, index, 'failed', 'Prepared transaction is missing');
          setProgress(current);
          setNextLeg(index + 1);
          break;
        }
        if (new Date(prepared.expiresAt).getTime() <= Date.now()) {
          current = updateLeg(current, index, 'failed', 'This basket quote expired');
          setProgress(current);
          setNextLeg(index + 1);
          setError('A basket quote expired. Build a fresh basket before continuing.');
          break;
        }

        current = updateLeg(current, index, 'awaiting_signature');
        setProgress(current);
        try {
          const signature = await sendTransaction(
            decodeBase64Transaction(prepared.transaction),
            connection,
          );
          current = updateLeg(current, index, 'submitted');
          setProgress(current);
          resetTrade();
          await confirmTrade(wallet, prepared.quoteId, signature);
          const confirmed = useExecutionStore.getState().status;
          if (!confirmed || confirmed.quoteId !== prepared.quoteId) {
            throw new Error(
              useExecutionStore.getState().error ?? `Unable to confirm ${leg.ticker}`,
            );
          }
          current = updateLeg(current, index, 'confirmed');
          setProgress(current);
          setNextLeg(index + 1);
          await refreshPortfolio();
        } catch (legError) {
          const message = legError instanceof Error ? legError.message : 'Transaction failed';
          current = updateLeg(current, index, 'failed', message);
          setProgress(current);
          setNextLeg(index + 1);
          setError(`${leg.ticker} was not completed. You can continue with the remaining legs.`);
          break;
        }
      }

      if (current.legs.every((leg) => leg.status === 'confirmed')) setComplete(true);
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : 'Unable to execute basket');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={busy ? () => undefined : onClose} side="right" title="Review basket">
      <div className="space-y-4">
        <BasketReview basket={basket} progress={progress} />
        {error ? <Toast title="Basket paused" description={error} tone="error" /> : null}
        <div className="rounded-[18px] border border-border bg-panel-subtle p-4 text-xs leading-5 text-muted">
          Each stock is a separate wallet approval. Oren stops after a rejection or failure; completed legs are never repeated automatically.
        </div>
        <div className="flex gap-2">
          {busy ? (
            <Button
              className="h-12 flex-1 rounded-[16px]"
              onClick={() => {
                stopRequested.current = true;
              }}
              variant="secondary"
            >
              <HugeiconsIcon icon={PauseCircleIcon} size={16} strokeWidth={1.8} />
              Stop after current
            </Button>
          ) : null}
          <Button
            className="h-12 flex-1 rounded-[16px]"
            disabled={busy || complete}
            onClick={() => void run()}
            variant="primary"
          >
            <HugeiconsIcon
              className={busy ? 'animate-spin' : undefined}
              icon={
                complete
                  ? CheckmarkCircle01Icon
                  : busy
                    ? Loading03Icon
                    : Wallet02Icon
              }
              size={16}
              strokeWidth={1.8}
            />
            {complete
              ? 'Basket complete'
              : busy
                ? 'Executing basket'
                : progress
                  ? 'Continue remaining'
                  : 'Prepare and begin'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function updateLeg(
  progress: BasketExecutionProgress,
  index: number,
  status: BasketExecutionProgress['legs'][number]['status'],
  error?: string,
): BasketExecutionProgress {
  return {
    ...progress,
    legs: progress.legs.map((leg, legIndex) =>
      legIndex === index ? { ...leg, status, error } : leg,
    ),
  };
}
