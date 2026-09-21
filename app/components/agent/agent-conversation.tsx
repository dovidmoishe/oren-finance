'use client';

import {
  ArrowUp02Icon,
  CancelCircleIcon,
  CheckmarkCircle01Icon,
  Loading03Icon,
  SparklesIcon,
  StopCircleIcon,
  Wallet02Icon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import type { RefObject } from 'react';
import type {
  AgentArtifactDensity,
  AgentDisplayMessage,
  AgentRecentThread,
  AgentToolActivity,
  BasketResponse,
  LimitOrderProposal,
  QuoteResponse,
} from '@/types';
import { Button, cn } from '@/components/ui';
import { AgentArtifacts } from './agent-artifacts';
import { toolLabel } from './agent-utils';

function Icon({ icon, size = 18, className }: { icon: IconSvgElement; size?: number; className?: string }) {
  return <HugeiconsIcon className={className} color="currentColor" icon={icon} size={size} strokeWidth={1.8} />;
}

export function AgentMessage({
  message,
  artifactDensity = 'inline',
  onReviewQuote,
  onReviewBasket,
  onReviewLimitOrder,
  onNavigate,
}: {
  message: AgentDisplayMessage;
  artifactDensity?: AgentArtifactDensity;
  onReviewQuote: (quote: QuoteResponse) => void;
  onReviewBasket: (basket: BasketResponse) => void;
  onReviewLimitOrder: (proposal: LimitOrderProposal) => void;
  onNavigate?: () => void;
}) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[86%] rounded-[20px] rounded-br-[7px] bg-foreground px-4 py-3 text-sm leading-6 text-white">
          {message.content}
          {message.interrupted ? <p className="mt-2 text-[10px] text-white/55">Response interrupted</p> : null}
        </div>
      </div>
    );
  }

  return (
    <article>
      {message.activities?.length ? <ToolTrace activities={message.activities} /> : null}
      {message.content ? (
        <p className="whitespace-pre-wrap text-[15px] leading-7 text-foreground">{message.content}</p>
      ) : message.streaming ? (
        <span className="t-shimmer text-sm" data-text="Oren is thinking">
          Oren is thinking
        </span>
      ) : null}
      {message.artifacts?.length ? (
        <AgentArtifacts
          artifacts={message.artifacts}
          density={artifactDensity}
          onNavigate={onNavigate}
          onReviewBasket={onReviewBasket}
          onReviewLimitOrder={onReviewLimitOrder}
          onReviewQuote={onReviewQuote}
        />
      ) : null}
      {message.interrupted && message.content ? (
        <p className="mt-2 text-xs text-muted">Stopped before completion</p>
      ) : null}
    </article>
  );
}

function ToolTrace({ activities }: { activities: AgentToolActivity[] }) {
  const running = activities.some((activity) => activity.status === 'running');
  return (
    <details className="mb-3 rounded-[15px] border border-border bg-panel-subtle px-3 py-2" open={running}>
      <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-medium text-muted">
        <Icon
          className={running ? 'animate-spin' : ''}
          icon={running ? Loading03Icon : CheckmarkCircle01Icon}
          size={13}
        />
        {running
          ? toolLabel(activities.find((item) => item.status === 'running')!.toolName)
          : `${activities.length} source${activities.length === 1 ? '' : 's'} checked`}
      </summary>
      <div className="mt-2 space-y-1.5 border-t border-border pt-2">
        {activities.map((activity) => (
          <div
            className={cn(
              'flex items-start gap-2 text-[11px]',
              activity.status === 'failed' ? 'text-negative' : 'text-muted',
            )}
            key={activity.callId}
          >
            <Icon
              className={activity.status === 'running' ? 'animate-spin' : ''}
              icon={
                activity.status === 'failed'
                  ? CancelCircleIcon
                  : activity.status === 'running'
                    ? Loading03Icon
                    : CheckmarkCircle01Icon
              }
              size={12}
            />
            <span>
              {toolLabel(activity.toolName)}
              {activity.error ? ` — ${activity.error}` : ''}
            </span>
          </div>
        ))}
      </div>
    </details>
  );
}

export function EmptyConversation({
  prompts,
  onPrompt,
}: {
  prompts: string[];
  onPrompt: (prompt: string) => void;
}) {
  return (
    <div className="flex min-h-full flex-col justify-center py-8">
      <div className="grid h-12 w-12 place-items-center rounded-[18px] bg-accent-pink-soft">
        <Icon icon={SparklesIcon} size={21} />
      </div>
      <h3 className="mt-5 font-display text-2xl font-semibold">What should we look at?</h3>
      <p className="mt-2 max-w-sm text-sm leading-6 text-muted">
        I can combine your positions with market data, deterministic Oren signals, news, and executable quotes.
      </p>
      <div className="mt-6 grid gap-2">
        {prompts.map((prompt) => (
          <button
            className="rounded-[17px] border border-border bg-panel px-4 py-3 text-left text-sm font-medium transition-colors hover:border-border-strong hover:bg-panel-subtle"
            key={prompt}
            onClick={() => onPrompt(prompt)}
            type="button"
          >
            {prompt}
          </button>
        ))}
      </div>
    </div>
  );
}

export function DisconnectedState({ onConnect }: { onConnect: () => void }) {
  return (
    <div className="flex h-full flex-col justify-center rounded-[24px] bg-accent-pink-soft p-6">
      <div className="grid h-12 w-12 place-items-center rounded-[18px] bg-white">
        <Icon icon={Wallet02Icon} size={20} />
      </div>
      <h3 className="mt-5 font-display text-2xl font-semibold">Your portfolio, in context.</h3>
      <p className="mt-2 text-sm leading-6 text-muted">
        Connect your Solana wallet to restore private conversations and let Oren reason from your real positions.
      </p>
      <Button className="mt-6 h-11 rounded-[15px]" onClick={onConnect} variant="primary">
        <Icon icon={Wallet02Icon} size={16} />
        Connect wallet
      </Button>
    </div>
  );
}

export function ConversationHistory({
  recentThreads,
  activeThreadId,
  disabled,
  onSelect,
}: {
  recentThreads: AgentRecentThread[];
  activeThreadId?: string;
  disabled: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="absolute inset-x-3 top-[70px] z-10 max-h-[55%] overflow-y-auto rounded-[22px] border border-border bg-panel p-2 shadow-[0_22px_60px_rgba(23,23,23,0.16)]">
      <p className="px-3 pb-2 pt-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
        Recent conversations
      </p>
      {recentThreads.length ? (
        recentThreads.map((thread) => (
          <button
            className={cn(
              'w-full rounded-[15px] px-3 py-2.5 text-left hover:bg-panel-subtle',
              thread.id === activeThreadId && 'bg-panel-subtle',
            )}
            disabled={disabled}
            key={thread.id}
            onClick={() => onSelect(thread.id)}
            type="button"
          >
            <p className="truncate text-sm font-medium">{thread.title}</p>
            <p className="mt-0.5 text-[10px] text-muted">{new Date(thread.updatedAt).toLocaleDateString()}</p>
          </button>
        ))
      ) : (
        <p className="px-3 py-5 text-sm text-muted">Your recent chats will appear here.</p>
      )}
    </div>
  );
}

export function AgentConversationThread({
  connected,
  isLoadingHistory,
  messages,
  prompts,
  error,
  artifactDensity = 'inline',
  scrollRef,
  shouldFollowRef,
  onPrompt,
  onRetry,
  onReviewQuote,
  onReviewBasket,
  onReviewLimitOrder,
  onNavigate,
  onConnect,
}: {
  connected: boolean;
  isLoadingHistory: boolean;
  messages: AgentDisplayMessage[];
  prompts: string[];
  error?: string;
  artifactDensity?: AgentArtifactDensity;
  scrollRef: RefObject<HTMLDivElement | null>;
  shouldFollowRef: RefObject<boolean>;
  onPrompt: (prompt: string) => void;
  onRetry: () => void;
  onReviewQuote: (quote: QuoteResponse) => void;
  onReviewBasket: (basket: BasketResponse) => void;
  onReviewLimitOrder: (proposal: LimitOrderProposal) => void;
  onNavigate?: () => void;
  onConnect: () => void;
}) {
  return (
    <div
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5"
      onScroll={(event) => {
        const node = event.currentTarget;
        shouldFollowRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 96;
      }}
      ref={scrollRef}
    >
      {!connected ? (
        <DisconnectedState onConnect={onConnect} />
      ) : isLoadingHistory ? (
        <div className="grid h-full place-items-center text-sm text-muted">
          <span className="t-shimmer" data-text="Restoring conversation">
            Restoring conversation
          </span>
        </div>
      ) : messages.length === 0 ? (
        <EmptyConversation onPrompt={onPrompt} prompts={prompts} />
      ) : (
        <div className="space-y-6">
          {messages.map((message) => (
            <AgentMessage
              artifactDensity={artifactDensity}
              key={message.id}
              message={message}
              onNavigate={onNavigate}
              onReviewBasket={onReviewBasket}
              onReviewLimitOrder={onReviewLimitOrder}
              onReviewQuote={onReviewQuote}
            />
          ))}
          {error ? (
            <div className="rounded-[18px] border border-red-200 bg-red-50 p-3 text-xs leading-5 text-red-900">
              <div className="flex items-start gap-2">
                <Icon className="mt-0.5 shrink-0" icon={CancelCircleIcon} size={14} />
                <span className="flex-1">{error}</span>
                <button
                  className="font-semibold underline underline-offset-2"
                  onClick={() => void onRetry()}
                  type="button"
                >
                  Retry
                </button>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

export function AgentComposer({
  connected,
  isSending,
  composer,
  composerRef,
  onComposerChange,
  onSubmit,
  onStop,
}: {
  connected: boolean;
  isSending: boolean;
  composer: string;
  composerRef: RefObject<HTMLTextAreaElement | null>;
  onComposerChange: (value: string) => void;
  onSubmit: () => void;
  onStop: () => void;
}) {
  return (
    <footer className="shrink-0 border-t border-border bg-panel/95 p-3 backdrop-blur">
      <div className="rounded-[20px] border border-border-strong bg-panel-subtle p-2 focus-within:border-foreground">
        <textarea
          aria-label="Ask Oren"
          className="max-h-32 min-h-12 w-full resize-none bg-transparent px-2 py-2 text-sm leading-6 outline-none placeholder:text-muted-2"
          disabled={!connected || isSending}
          onChange={(event) => onComposerChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              onSubmit();
            }
          }}
          placeholder={connected ? 'Ask about your portfolio or the market…' : 'Connect your wallet to ask Oren'}
          ref={composerRef}
          rows={1}
          value={composer}
        />
        <div className="flex items-center justify-between gap-3 px-1 pb-1">
          <p className="text-[10px] text-muted">Oren proposes. Your wallet approves.</p>
          {isSending ? (
            <Button
              aria-label="Stop response"
              className="h-9 w-9 rounded-full"
              onClick={onStop}
              size="icon"
              variant="secondary"
            >
              <Icon icon={StopCircleIcon} size={16} />
            </Button>
          ) : (
            <Button
              aria-label="Send message"
              className="h-9 w-9 rounded-full"
              disabled={!connected || !composer.trim()}
              onClick={() => onSubmit()}
              size="icon"
              variant="primary"
            >
              <Icon icon={ArrowUp02Icon} size={16} />
            </Button>
          )}
        </div>
      </div>
    </footer>
  );
}
