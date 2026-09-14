'use client';

import {
  Add01Icon,
  ArrowUp02Icon,
  Cancel01Icon,
  CancelCircleIcon,
  ChatBotIcon,
  CheckmarkCircle01Icon,
  HistoryIcon,
  Loading03Icon,
  SparklesIcon,
  StopCircleIcon,
  Wallet02Icon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAgentStore, useStockStore } from '@/store';
import type {
  AgentDisplayMessage,
  AgentPageContext,
  AgentToolActivity,
  BasketResponse,
  QuoteResponse,
} from '@/types';
import { Button, cn } from '@/components/ui';
import { AgentActionReview } from './agent-action-review';
import { AgentArtifacts } from './agent-artifacts';

function Icon({ icon, size = 18, className }: { icon: IconSvgElement; size?: number; className?: string }) {
  return <HugeiconsIcon className={className} color="currentColor" icon={icon} size={size} strokeWidth={1.8} />;
}

export function AgentPanel() {
  const pathname = usePathname();
  const { connected, publicKey } = useWallet();
  const { setVisible } = useWalletModal();
  const selectedStock = useStockStore((state) => state.selected);
  const walletAddress = publicKey?.toBase58();
  const panelOpen = useAgentStore((state) => state.panelOpen);
  const hydrated = useAgentStore((state) => state.hydrated);
  const threadId = useAgentStore((state) => state.threadId);
  const messages = useAgentStore((state) => state.messages);
  const recentThreads = useAgentStore((state) => state.recentThreads);
  const isLoadingHistory = useAgentStore((state) => state.isLoadingHistory);
  const isSending = useAgentStore((state) => state.isSending);
  const error = useAgentStore((state) => state.error);
  const initialize = useAgentStore((state) => state.initialize);
  const setPanelOpen = useAgentStore((state) => state.setPanelOpen);
  const newChat = useAgentStore((state) => state.newChat);
  const loadThread = useAgentStore((state) => state.loadThread);
  const sendMessage = useAgentStore((state) => state.sendMessage);
  const stop = useAgentStore((state) => state.stop);
  const retry = useAgentStore((state) => state.retry);
  const [composer, setComposer] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [reviewQuote, setReviewQuote] = useState<QuoteResponse>();
  const [reviewBasket, setReviewBasket] = useState<BasketResponse>();
  const scrollRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const reviewOriginRef = useRef<HTMLElement | null>(null);
  const shouldFollow = useRef(true);
  const context = useMemo(() => pageContext(pathname), [pathname]);
  const prompts = useMemo(
    () => promptSuggestions(context, selectedStock?.ticker),
    [context, selectedStock?.ticker],
  );
  const closePanel = useCallback(() => {
    setShowHistory(false);
    setPanelOpen(false);
    window.requestAnimationFrame(() => {
      document.getElementById('oren-agent-launcher')?.focus();
    });
  }, [setPanelOpen]);

  useEffect(() => {
    void initialize(walletAddress);
  }, [initialize, walletAddress]);

  useEffect(() => {
    if (!panelOpen || typeof window === 'undefined' || window.innerWidth >= 640) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [panelOpen]);

  useEffect(() => {
    if (!panelOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || reviewQuote || reviewBasket) return;
      if (showHistory) {
        setShowHistory(false);
        return;
      }
      closePanel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [closePanel, panelOpen, reviewBasket, reviewQuote, showHistory]);

  useEffect(() => {
    if (!panelOpen || !hydrated) return;
    window.requestAnimationFrame(() => {
      const target = connected
        ? composerRef.current
        : panelRef.current?.querySelector<HTMLElement>('button');
      target?.focus();
    });
  }, [connected, hydrated, panelOpen]);

  useEffect(() => {
    const textarea = composerRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 128)}px`;
  }, [composer]);

  useEffect(() => {
    if (shouldFollow.current) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, isSending]);

  const submit = async (value = composer) => {
    if (!walletAddress || !value.trim()) return;
    setComposer('');
    shouldFollow.current = true;
    await sendMessage(value, walletAddress, context);
  };

  const openQuoteReview = (quote: QuoteResponse) => {
    reviewOriginRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setReviewQuote(quote);
  };

  const openBasketReview = (basket: BasketResponse) => {
    reviewOriginRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setReviewBasket(basket);
  };

  const closeReview = () => {
    setReviewQuote(undefined);
    setReviewBasket(undefined);
    window.requestAnimationFrame(() => reviewOriginRef.current?.focus());
  };

  return (
    <>
      <div
        aria-hidden
        className={cn(
          'fixed inset-0 top-[72px] z-30 bg-black/20 backdrop-blur-[2px] transition-opacity 2xl:hidden',
          panelOpen ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        onClick={closePanel}
      />

      <aside
        aria-label="Oren investing copilot"
        aria-busy={isSending}
        aria-hidden={!panelOpen}
        className={cn(
          't-panel-slide fixed inset-x-2 bottom-2 top-[80px] z-40 flex min-h-0 flex-col overflow-hidden rounded-[28px] border border-border bg-panel shadow-[0_28px_90px_rgba(23,23,23,0.18)] sm:inset-x-auto sm:bottom-4 sm:right-4 sm:top-[88px] sm:w-[420px] 2xl:right-5',
          reviewQuote || reviewBasket ? 'opacity-40' : '',
        )}
        data-open={panelOpen && hydrated}
        inert={!panelOpen}
        ref={panelRef}
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3.5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-[15px] bg-foreground text-white">
              <Icon icon={ChatBotIcon} size={19} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="truncate font-display font-semibold">Oren</h2>
                {isSending ? <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-positive" /> : null}
              </div>
              <p className="truncate text-xs text-muted">
                {isSending ? 'Working with live market tools' : 'Your investing copilot'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button
              aria-label="Recent conversations"
              aria-expanded={showHistory}
              onClick={() => setShowHistory((value) => !value)}
              size="icon"
              variant="ghost"
            >
              <Icon icon={HistoryIcon} size={17} />
            </Button>
            <Button
              aria-label="New conversation"
              disabled={isSending}
              onClick={() => {
                newChat();
                setShowHistory(false);
              }}
              size="icon"
              variant="ghost"
            >
              <Icon icon={Add01Icon} size={18} />
            </Button>
            <Button aria-label="Close Oren" onClick={closePanel} size="icon" variant="ghost">
              <Icon icon={Cancel01Icon} size={18} />
            </Button>
          </div>
        </header>

        {showHistory ? (
          <ConversationHistory
            activeThreadId={threadId}
            disabled={isSending}
            onSelect={(id) => {
              void loadThread(id);
              setShowHistory(false);
            }}
            recentThreads={recentThreads}
          />
        ) : null}

        <div
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5"
          onScroll={(event) => {
            const node = event.currentTarget;
            shouldFollow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 96;
          }}
          ref={scrollRef}
        >
          {!connected ? (
            <DisconnectedState onConnect={() => setVisible(true)} />
          ) : isLoadingHistory ? (
            <div className="grid h-full place-items-center text-sm text-muted">
              <span className="t-shimmer" data-text="Restoring conversation">Restoring conversation</span>
            </div>
          ) : messages.length === 0 ? (
            <EmptyConversation prompts={prompts} onPrompt={(prompt) => void submit(prompt)} />
          ) : (
            <div className="space-y-6">
              {messages.map((message) => (
                <Message
                  key={message.id}
                  message={message}
                  onReviewBasket={openBasketReview}
                  onReviewQuote={openQuoteReview}
                />
              ))}
              {error ? (
                <div className="rounded-[18px] border border-red-200 bg-red-50 p-3 text-xs leading-5 text-red-900">
                  <div className="flex items-start gap-2">
                    <Icon className="mt-0.5 shrink-0" icon={CancelCircleIcon} size={14} />
                    <span className="flex-1">{error}</span>
                    <button className="font-semibold underline underline-offset-2" onClick={() => void retry()} type="button">Retry</button>
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>

        <footer className="shrink-0 border-t border-border bg-panel/95 p-3 backdrop-blur">
          <div className="rounded-[20px] border border-border-strong bg-panel-subtle p-2 focus-within:border-foreground">
            <textarea
              aria-label="Ask Oren"
              className="max-h-32 min-h-12 w-full resize-none bg-transparent px-2 py-2 text-sm leading-6 outline-none placeholder:text-muted-2"
              disabled={!connected || isSending}
              onChange={(event) => setComposer(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void submit();
                }
              }}
              placeholder={connected ? 'Ask about your portfolio or the market…' : 'Connect your wallet to ask Oren'}
              rows={1}
              ref={composerRef}
              value={composer}
            />
            <div className="flex items-center justify-between gap-3 px-1 pb-1">
              <p className="text-[10px] text-muted">Oren proposes. Your wallet approves.</p>
              {isSending ? (
                <Button aria-label="Stop response" className="h-9 w-9 rounded-full" onClick={stop} size="icon" variant="secondary">
                  <Icon icon={StopCircleIcon} size={16} />
                </Button>
              ) : (
                <Button
                  aria-label="Send message"
                  className="h-9 w-9 rounded-full"
                  disabled={!connected || !composer.trim()}
                  onClick={() => void submit()}
                  size="icon"
                  variant="primary"
                >
                  <Icon icon={ArrowUp02Icon} size={16} />
                </Button>
              )}
            </div>
          </div>
        </footer>
      </aside>

      <Button
        aria-hidden={panelOpen}
        aria-expanded={panelOpen}
        aria-label="Open Oren"
        className={cn(
          'fixed bottom-5 right-5 z-40 h-14 w-14 rounded-[20px] shadow-[0_18px_50px_rgba(23,23,23,0.2)] transition-[opacity,transform]',
          panelOpen ? 'pointer-events-none scale-90 opacity-0' : 'scale-100 opacity-100',
        )}
        id="oren-agent-launcher"
        onClick={() => setPanelOpen(true)}
        size="icon"
        tabIndex={panelOpen ? -1 : 0}
        variant="primary"
      >
        <Icon icon={ChatBotIcon} size={22} />
        {isSending ? <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-white bg-positive" /> : null}
      </Button>

      <div aria-live="polite" className="sr-only">
        {!isSending && messages.at(-1)?.role === 'assistant' ? 'Oren response complete' : ''}
      </div>

      <AgentActionReview basket={reviewBasket} onClose={closeReview} quote={reviewQuote} />
    </>
  );
}

function Message({
  message,
  onReviewQuote,
  onReviewBasket,
}: {
  message: AgentDisplayMessage;
  onReviewQuote: (quote: QuoteResponse) => void;
  onReviewBasket: (basket: BasketResponse) => void;
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
        <span className="t-shimmer text-sm" data-text="Oren is thinking">Oren is thinking</span>
      ) : null}
      {message.artifacts?.length ? (
        <AgentArtifacts artifacts={message.artifacts} onReviewBasket={onReviewBasket} onReviewQuote={onReviewQuote} />
      ) : null}
      {message.interrupted && message.content ? <p className="mt-2 text-xs text-muted">Stopped before completion</p> : null}
    </article>
  );
}

function ToolTrace({ activities }: { activities: AgentToolActivity[] }) {
  const running = activities.some((activity) => activity.status === 'running');
  return (
    <details className="mb-3 rounded-[15px] border border-border bg-panel-subtle px-3 py-2" open={running}>
      <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-medium text-muted">
        <Icon className={running ? 'animate-spin' : ''} icon={running ? Loading03Icon : CheckmarkCircle01Icon} size={13} />
        {running ? toolLabel(activities.find((item) => item.status === 'running')!.toolName) : `${activities.length} source${activities.length === 1 ? '' : 's'} checked`}
      </summary>
      <div className="mt-2 space-y-1.5 border-t border-border pt-2">
        {activities.map((activity) => (
          <div className={cn('flex items-start gap-2 text-[11px]', activity.status === 'failed' ? 'text-negative' : 'text-muted')} key={activity.callId}>
            <Icon className={activity.status === 'running' ? 'animate-spin' : ''} icon={activity.status === 'failed' ? CancelCircleIcon : activity.status === 'running' ? Loading03Icon : CheckmarkCircle01Icon} size={12} />
            <span>{toolLabel(activity.toolName)}{activity.error ? ` — ${activity.error}` : ''}</span>
          </div>
        ))}
      </div>
    </details>
  );
}

function EmptyConversation({ prompts, onPrompt }: { prompts: string[]; onPrompt: (prompt: string) => void }) {
  return (
    <div className="flex min-h-full flex-col justify-center py-8">
      <div className="grid h-12 w-12 place-items-center rounded-[18px] bg-accent-pink-soft">
        <Icon icon={SparklesIcon} size={21} />
      </div>
      <h3 className="mt-5 font-display text-2xl font-semibold">What should we look at?</h3>
      <p className="mt-2 max-w-sm text-sm leading-6 text-muted">I can combine your positions with market data, deterministic Oren signals, news, and executable quotes.</p>
      <div className="mt-6 grid gap-2">
        {prompts.map((prompt) => (
          <button className="rounded-[17px] border border-border bg-panel px-4 py-3 text-left text-sm font-medium transition-colors hover:border-border-strong hover:bg-panel-subtle" key={prompt} onClick={() => onPrompt(prompt)} type="button">
            {prompt}
          </button>
        ))}
      </div>
    </div>
  );
}

function DisconnectedState({ onConnect }: { onConnect: () => void }) {
  return (
    <div className="flex h-full flex-col justify-center rounded-[24px] bg-accent-pink-soft p-6">
      <div className="grid h-12 w-12 place-items-center rounded-[18px] bg-white"><Icon icon={Wallet02Icon} size={20} /></div>
      <h3 className="mt-5 font-display text-2xl font-semibold">Your portfolio, in context.</h3>
      <p className="mt-2 text-sm leading-6 text-muted">Connect your Solana wallet to restore private conversations and let Oren reason from your real positions.</p>
      <Button className="mt-6 h-11 rounded-[15px]" onClick={onConnect} variant="primary"><Icon icon={Wallet02Icon} size={16} />Connect wallet</Button>
    </div>
  );
}

function ConversationHistory({
  recentThreads,
  activeThreadId,
  disabled,
  onSelect,
}: {
  recentThreads: { id: string; title: string; updatedAt: string }[];
  activeThreadId?: string;
  disabled: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="absolute inset-x-3 top-[70px] z-10 max-h-[55%] overflow-y-auto rounded-[22px] border border-border bg-panel p-2 shadow-[0_22px_60px_rgba(23,23,23,0.16)]">
      <p className="px-3 pb-2 pt-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">Recent conversations</p>
      {recentThreads.length ? recentThreads.map((thread) => (
        <button className={cn('w-full rounded-[15px] px-3 py-2.5 text-left hover:bg-panel-subtle', thread.id === activeThreadId && 'bg-panel-subtle')} disabled={disabled} key={thread.id} onClick={() => onSelect(thread.id)} type="button">
          <p className="truncate text-sm font-medium">{thread.title}</p>
          <p className="mt-0.5 text-[10px] text-muted">{new Date(thread.updatedAt).toLocaleDateString()}</p>
        </button>
      )) : <p className="px-3 py-5 text-sm text-muted">Your recent chats will appear here.</p>}
    </div>
  );
}

function pageContext(pathname: string): AgentPageContext {
  if (pathname.startsWith('/stocks/')) return { page: 'stock', assetId: decodeURIComponent(pathname.split('/')[2] ?? '') };
  if (pathname.startsWith('/leaderboard')) return { page: 'leaderboard' };
  if (pathname.startsWith('/markets')) return { page: 'markets' };
  if (pathname.startsWith('/vault')) return { page: 'vault' };
  if (pathname.startsWith('/activity')) return { page: 'activity' };
  return { page: 'dashboard' };
}

function promptSuggestions(context: AgentPageContext, ticker?: string): string[] {
  switch (context.page) {
    case 'stock': return [`Analyze ${ticker ?? 'this stock'} for me`, `What is the latest news on ${ticker ?? 'this stock'}?`, `What are the main risks here?`];
    case 'leaderboard': return ['Who is leading right now?', 'Compare the top traders', 'Help me copy a public portfolio'];
    case 'markets': return ['What is standing out in the market?', 'Find three moderate-risk opportunities', 'Build me a balanced $200 basket'];
    case 'vault': return ['How much of my portfolio is locked?', "What's unlocking next?", 'Explain my vault positions'];
    case 'activity': return ['Explain my recent activity', 'What changed in my portfolio?', 'Summarize my latest trades'];
    default: return ['Review my portfolio', 'Where am I taking the most risk?', 'Find opportunities that fit my holdings'];
  }
}

function toolLabel(toolName: string) {
  const labels: Record<string, string> = {
    getPortfolio: 'Checking your portfolio',
    getPortfolioActivity: 'Reading portfolio activity',
    getStock: 'Loading stock data',
    getStockChart: 'Reading price history',
    getStockNews: 'Reading recent news',
    analyzeStock: 'Running Oren analysis',
    searchStocks: 'Searching stocks',
    findOpportunities: 'Comparing opportunities',
    getSignals: 'Calculating market signals',
    getSwapQuote: 'Requesting a live quote',
    prepareSwap: 'Preparing an unsigned trade',
    createBasket: 'Building a basket',
    prepareBasketPurchase: 'Preparing basket transactions',
    getVaults: 'Checking vault positions',
    prepareLock: 'Preparing a lock transaction',
    prepareUnlock: 'Preparing an unlock transaction',
    getLeaderboard: 'Reading public leaderboard',
    getTraderProfile: 'Loading public trader profile',
    prepareCopyPortfolio: 'Building copy proposal',
  };
  return labels[toolName] ?? 'Using an Oren tool';
}
