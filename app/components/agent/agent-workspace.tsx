'use client';

import type { RefObject } from 'react';
import type {
  AgentArtifact,
  AgentDisplayMessage,
  AgentPageContext,
  BasketResponse,
  LimitOrderProposal,
  QuoteResponse,
} from '@/types';
import { cn } from '@/components/ui';
import { AgentArtifacts } from './agent-artifacts';
import { AgentComposer, AgentConversationThread } from './agent-conversation';
import { contextLabel } from './agent-utils';

export function AgentContextCard({
  context,
  ticker,
  className,
}: {
  context: AgentPageContext;
  ticker?: string;
  className?: string;
}) {
  return (
    <section
      className={cn(
        'rounded-[20px] border border-border bg-panel-subtle p-5',
        className,
      )}
    >
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">Page context</p>
      <p className="mt-2 font-display text-xl font-semibold">{contextLabel(context, ticker)}</p>
      <p className="mt-2 text-sm leading-6 text-muted">
        Oren uses this page when you ask a question. Artifacts from the latest response will appear here.
      </p>
    </section>
  );
}

export function AgentArtifactRail({
  artifacts,
  context,
  ticker,
  onReviewQuote,
  onReviewBasket,
  onReviewLimitOrder,
  onNavigate,
}: {
  artifacts: AgentArtifact[];
  context: AgentPageContext;
  ticker?: string;
  onReviewQuote: (quote: QuoteResponse) => void;
  onReviewBasket: (basket: BasketResponse) => void;
  onReviewLimitOrder: (proposal: LimitOrderProposal) => void;
  onNavigate?: () => void;
}) {
  return (
    <aside className="flex min-h-0 w-full flex-col border-l border-border bg-panel-subtle/40 lg:w-[420px] lg:shrink-0">
      <div className="shrink-0 border-b border-border px-4 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">Working set</p>
        <p className="mt-0.5 text-xs text-muted">
          {artifacts.length
            ? `${artifacts.length} artifact${artifacts.length === 1 ? '' : 's'} from the latest response`
            : 'Artifacts appear here as Oren works'}
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
        {artifacts.length ? (
          <AgentArtifacts
            artifacts={artifacts}
            density="rail"
            onNavigate={onNavigate}
            onReviewBasket={onReviewBasket}
            onReviewLimitOrder={onReviewLimitOrder}
            onReviewQuote={onReviewQuote}
          />
        ) : (
          <AgentContextCard context={context} ticker={ticker} />
        )}
      </div>
    </aside>
  );
}

export function AgentWorkspace({
  connected,
  isLoadingHistory,
  messages,
  prompts,
  error,
  context,
  ticker,
  railArtifacts,
  composer,
  composerRef,
  scrollRef,
  shouldFollowRef,
  isSending,
  onComposerChange,
  onSubmit,
  onStop,
  onPrompt,
  onRetry,
  onConnect,
  onReviewQuote,
  onReviewBasket,
  onReviewLimitOrder,
  onNavigate,
}: {
  connected: boolean;
  isLoadingHistory: boolean;
  messages: AgentDisplayMessage[];
  prompts: string[];
  error?: string;
  context: AgentPageContext;
  ticker?: string;
  railArtifacts: AgentArtifact[];
  composer: string;
  composerRef: RefObject<HTMLTextAreaElement | null>;
  scrollRef: RefObject<HTMLDivElement | null>;
  shouldFollowRef: RefObject<boolean>;
  isSending: boolean;
  onComposerChange: (value: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  onPrompt: (prompt: string) => void;
  onRetry: () => void;
  onConnect: () => void;
  onReviewQuote: (quote: QuoteResponse) => void;
  onReviewBasket: (basket: BasketResponse) => void;
  onReviewLimitOrder: (proposal: LimitOrderProposal) => void;
  onNavigate?: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <AgentConversationThread
          artifactDensity="chips"
          connected={connected}
          error={error}
          isLoadingHistory={isLoadingHistory}
          messages={messages}
          onConnect={onConnect}
          onNavigate={onNavigate}
          onPrompt={onPrompt}
          onRetry={onRetry}
          onReviewBasket={onReviewBasket}
          onReviewLimitOrder={onReviewLimitOrder}
          onReviewQuote={onReviewQuote}
          prompts={prompts}
          scrollRef={scrollRef}
          shouldFollowRef={shouldFollowRef}
        />
        <AgentComposer
          composer={composer}
          composerRef={composerRef}
          connected={connected}
          isSending={isSending}
          onComposerChange={onComposerChange}
          onStop={onStop}
          onSubmit={onSubmit}
        />
      </div>
      <AgentArtifactRail
        artifacts={railArtifacts}
        context={context}
        onNavigate={onNavigate}
        onReviewBasket={onReviewBasket}
        onReviewLimitOrder={onReviewLimitOrder}
        onReviewQuote={onReviewQuote}
        ticker={ticker}
      />
    </div>
  );
}

export function latestAssistantArtifacts(messages: AgentDisplayMessage[]): AgentArtifact[] {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === 'assistant' && message.artifacts?.length) {
      return message.artifacts;
    }
  }
  return [];
}
