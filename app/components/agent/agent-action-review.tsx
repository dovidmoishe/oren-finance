'use client';

import { useEffect, useState } from 'react';
import { useQuoteExecution } from '@/hooks/use-quote-execution';
import { useOrenAuth } from '@/components/auth/auth-context';
import { walletSessionIsCurrent } from '@/services/wallet-session';
import { useQuoteRefresh } from '@/hooks/use-quote-refresh';
import { useLimitOrderExecution } from '@/hooks/use-limit-order-execution';
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
import { PriceMovedReview } from '@/components/trading/price-moved-review';
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
        onSign={(approvalId) => executeLimitOrder(limitOrder, approvalId)}
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
        onAcceptAlternative={(alternative) => {
          // Swap in the Jupiter alternative; the modal prepares a fresh
          // approval for it. Nothing is signed without the user.
          seedQuoteIntoStore(alternative, useExecutionStore.getState().lastQuoteIntent);
          resetFeedback();
        }}
        onRefreshQuote={() => void refreshQuote()}
        onSign={(approvalId, reviewed) => executeQuote(reviewed, approvalId)}
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

function BasketExecutionReview({ basket, onClose }: { basket: BasketResponse; onClose: () => void }) {
  const auth = useOrenAuth();
  const [progress, setProgress] = useState<BasketExecutionProgress>();
  const [nextLeg, setNextLeg] = useState(0);
  const [preparing, setPreparing] = useState(false);
  const [preparationError, setPreparationError] = useState<string>();
  // Jupiter alternatives the user accepted for legs refused with PRICE_MOVED.
  const [acceptedAlternatives, setAcceptedAlternatives] = useState<Record<number, QuoteResponse>>({});
  const prepareBasketTrades = useExecutionStore(state => state.prepareBasketTrades);
  const { confirmation, error, executeQuote, flowStatus, resetFeedback } = useQuoteExecution(() => {
    setProgress(current => current ? { ...current, legs: current.legs.map((leg, i) => i === nextLeg ? { ...leg, status: 'confirmed' } : leg) } : current);
    setNextLeg(index => index + 1);
  });
  useEffect(() => { resetFeedback(); }, [nextLeg, resetFeedback]);
  const leg = progress?.legs[nextLeg];
  async function prepare() {
    if (!auth.address || preparing) return;
    setPreparing(true); setPreparationError(undefined);
    const current = walletSessionIsCurrent();
    try {
      await prepareBasketTrades({ basketId: basket.id, wallet: auth.address });
      if (!current()) return;
      const prepared = useExecutionStore.getState().preparedBasket;
      if (!prepared) throw new Error(useExecutionStore.getState().error || 'Unable to prepare basket');
      setProgress(prepared.progress);
    } catch (error) {
      if (current()) setPreparationError(error instanceof Error ? error.message : 'Unable to prepare basket');
    } finally { setPreparing(false); }
  }
  const legQuote = leg ? acceptedAlternatives[nextLeg] ?? leg.quote : undefined;
  if (leg && legQuote) return <QuoteReviewModal open quote={legQuote} status={flowStatus} confirmation={confirmation} error={error}
    onClose={onClose} onSign={(id, reviewed) => executeQuote(reviewed, id)} />;
  return <Modal open title="Review basket" onClose={onClose}>
    <BasketReview basket={basket} progress={progress} />
    <p className="my-4 text-sm text-muted">Review and confirm each stock separately. Completed trades are not repeated.</p>
    {preparationError ? <Toast title="Basket preparation" description={preparationError} tone="error" /> : null}
    {leg && !leg.quote && leg.priceMoved ? (
      <PriceMovedReview
        details={leg.priceMoved}
        onAccept={alternative => setAcceptedAlternatives(current => ({ ...current, [nextLeg]: alternative }))}
        onCancel={() => setNextLeg(index => index + 1)}
      />
    ) : leg && !leg.quote ? <>
      <Toast title={`${leg.ticker} unavailable`} description={leg.error || 'This stock could not be prepared. No trade was submitted.'} tone="error" />
      <Button onClick={() => setNextLeg(index => index + 1)}>Skip this stock</Button>
    </> : null}
    <Button disabled={preparing || Boolean(progress) || !auth.address} onClick={() => void prepare()}>
      {progress ? leg ? 'Review paused' : 'Basket review complete' : preparing ? 'Preparing…' : 'Review first stock'}
    </Button>
  </Modal>;
}
