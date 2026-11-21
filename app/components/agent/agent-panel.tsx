'use client';

import {
  Plus as PlusIcon,
  X as XIcon,
  History as HistoryIcon,
  Expand as ExpandGlyph,
  Shrink as ShrinkIcon,
  type LucideIcon,
} from "lucide-react";
import { InterfaceIcon } from "@/components/ui/interface-icon";

import { useWallet } from '@/components/auth/wallet-context';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAgentStore, usePortfolioStore, useStockStore } from '@/store';
import type { BasketResponse, LimitOrderProposal, QuoteResponse } from '@/types';
import { useWalletModal } from '@/components/auth/wallet-modal-context';
import { OrenLogo, type OrenLogoState } from '@/components/brand/oren-logo';
import { Button, cn } from '@/components/ui';
import { AgentActionReview } from './agent-action-review';
import { resizeAgentComposer } from './agent-composer-view';
import {
  AgentComposer,
  AgentConversationThread,
  ConversationHistory,
} from './agent-conversation';
import { contextTicker, pageContext, promptSuggestions } from './agent-utils';
import { AgentWorkspace } from './agent-workspace';
// Artifacts paused: import { latestAssistantArtifacts } from './agent-workspace';
import { useT } from "@/i18n/i18n";

function Icon({ icon, size = 18, className }: { icon: LucideIcon; size?: number; className?: string }) {
  return <InterfaceIcon className={className} color="currentColor" icon={icon} size={size} strokeWidth={1.8} />;
}

function ExpandIcon({ size = 17 }: { size?: number }) {
  return (
    <ExpandGlyph size={size} strokeWidth={1.5} color="currentColor" aria-hidden="true" focusable="false" className="shrink-0" />
  );
}

function CollapseIcon({ size = 17 }: { size?: number }) {
  return (
    <ShrinkIcon size={size} strokeWidth={1.5} color="currentColor" aria-hidden="true" focusable="false" className="shrink-0" />
  );
}

export function AgentPanel() {
  const pathname = usePathname();
  const t = useT();
  const { connected, publicKey } = useWallet();
  const { setVisible } = useWalletModal();
  const selectedStock = useStockStore((state) => state.selected);
  const portfolio = usePortfolioStore((state) => state.portfolio);
  const loadPortfolio = usePortfolioStore((state) => state.loadPortfolio);
  const walletAddress = publicKey?.toBase58();
  const panelOpen = useAgentStore((state) => state.panelOpen);
  const expanded = useAgentStore((state) => state.expanded);
  const hydrated = useAgentStore((state) => state.hydrated);
  const threadId = useAgentStore((state) => state.threadId);
  const messages = useAgentStore((state) => state.messages);
  const recentThreads = useAgentStore((state) => state.recentThreads);
  const isLoadingHistory = useAgentStore((state) => state.isLoadingHistory);
  const isSending = useAgentStore((state) => state.isSending);
  const error = useAgentStore((state) => state.error);
  const initialize = useAgentStore((state) => state.initialize);
  const setPanelOpen = useAgentStore((state) => state.setPanelOpen);
  const setExpanded = useAgentStore((state) => state.setExpanded);
  const newChat = useAgentStore((state) => state.newChat);
  const loadThread = useAgentStore((state) => state.loadThread);
  const sendMessage = useAgentStore((state) => state.sendMessage);
  const stop = useAgentStore((state) => state.stop);
  const retry = useAgentStore((state) => state.retry);
  const [composer, setComposer] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [reviewQuote, setReviewQuote] = useState<QuoteResponse>();
  const [reviewBasket, setReviewBasket] = useState<BasketResponse>();
  const [reviewLimitOrder, setReviewLimitOrder] = useState<LimitOrderProposal>();
  const [successFlash, setSuccessFlash] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const wasSendingRef = useRef(false);
  const panelRef = useRef<HTMLElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const reviewOriginRef = useRef<HTMLElement | null>(null);
  const shouldFollowRef = useRef(true);
  const context = useMemo(() => pageContext(pathname), [pathname]);
  const ticker = contextTicker(context, selectedStock);
  const prompts = useMemo(
    () => promptSuggestions(context, ticker),
    [context, ticker],
  );
  // Artifacts paused: const railArtifacts = useMemo(() => latestAssistantArtifacts(messages), [messages]);
  const logoState = useMemo((): OrenLogoState => {
    if (successFlash) return 'success';
    if (error) return 'alert';
    if (!isSending) return 'idle';

    const lastMessage = messages.at(-1);
    const hasRunningTool = lastMessage?.activities?.some((activity) => activity.status === 'running');
    return hasRunningTool ? 'processing' : 'thinking';
  }, [error, isSending, messages, successFlash]);

  useEffect(() => {
    if (wasSendingRef.current && !isSending && !error) {
      setSuccessFlash(true);
      const timer = window.setTimeout(() => setSuccessFlash(false), 720);
      wasSendingRef.current = isSending;
      return () => window.clearTimeout(timer);
    }
    wasSendingRef.current = isSending;
  }, [error, isSending]);

  const collapseToSidecar = useCallback(() => {
    setExpanded(false);
  }, [setExpanded]);

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
    if (!panelOpen || !walletAddress || portfolio?.wallet === walletAddress) return;
    void loadPortfolio(walletAddress);
  }, [loadPortfolio, panelOpen, portfolio?.wallet, walletAddress]);

  useEffect(() => {
    if (!panelOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || reviewQuote || reviewBasket || reviewLimitOrder || document.querySelector(':popover-open')) return;
      if (showHistory) {
        setShowHistory(false);
        return;
      }
      if (expanded) {
        collapseToSidecar();
        return;
      }
      closePanel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    closePanel,
    collapseToSidecar,
    expanded,
    panelOpen,
    reviewBasket,
    reviewLimitOrder,
    reviewQuote,
    showHistory,
  ]);

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
    resizeAgentComposer(textarea);
  }, [composer, expanded, panelOpen]);

  useEffect(() => {
    if (shouldFollowRef.current) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, isSending]);

  const submit = async (value = composer) => {
    if (!walletAddress || !value.trim()) return;
    setComposer('');
    shouldFollowRef.current = true;
    await sendMessage(value, walletAddress, context);
  };

  const openQuoteReview = (quote: QuoteResponse) => {
    reviewOriginRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setReviewQuote(quote);
  };

  const openBasketReview = (basket: BasketResponse) => {
    reviewOriginRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setReviewBasket(basket);
  };

  const openLimitOrderReview = (proposal: LimitOrderProposal) => {
    reviewOriginRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setReviewLimitOrder(proposal);
  };

  const closeReview = () => {
    setReviewQuote(undefined);
    setReviewBasket(undefined);
    setReviewLimitOrder(undefined);
    window.requestAnimationFrame(() => reviewOriginRef.current?.focus());
  };

  const hasReviewOpen = Boolean(reviewQuote || reviewBasket || reviewLimitOrder);
  const visible = panelOpen && hydrated;
  return (
    <>
      <aside
        aria-label={t("agent.copilotLabel")}
        aria-busy={isSending}
        aria-hidden={!visible}
        className={cn(
          't-panel-slide fixed inset-x-0 bottom-0 top-[var(--app-header-bottom,var(--app-nav-height))] z-20 flex min-h-0 min-w-0 flex-col overflow-hidden border-t border-border bg-panel lg:relative lg:inset-auto lg:h-dvh lg:border-t-0',
          !expanded && hasReviewOpen ? 'opacity-40' : '',
        )}
        data-open={visible}
        id="oren-agent-panel"
        inert={!visible}
        ref={panelRef}
      >
        <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <OrenLogo className="shrink-0" size={26} state={logoState} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate font-display font-semibold">Oren</h2>
                {isSending ? <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-positive" /> : null}
              </div>
              <p className="truncate text-xs text-muted">
                {isSending ? t("agent.working") : t("agent.tagline")}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button
              aria-label={t("agent.recent")}
              aria-expanded={showHistory}
              onClick={() => setShowHistory((value) => !value)}
              size="icon"
              variant="ghost"
            >
              <Icon icon={HistoryIcon} size={17} />
            </Button>
            <Button
              aria-label={t("agent.newConversation")}
              disabled={isSending}
              onClick={() => {
                newChat();
                setShowHistory(false);
              }}
              size="icon"
              variant="ghost"
            >
              <Icon icon={PlusIcon} size={18} />
            </Button>
            <div className="hidden lg:block">
              <Button
                aria-label={t(expanded ? "agent.collapse" : "agent.expand")}
                onClick={() => setExpanded(!expanded)}
                size="icon"
                variant="ghost"
              >
                {expanded ? <CollapseIcon /> : <ExpandIcon />}
              </Button>
            </div>
            <Button aria-label={t("agent.close")} onClick={closePanel} size="icon" variant="ghost">
              <Icon icon={XIcon} size={18} />
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

        {expanded ? (
          // Artifacts paused: restore railArtifacts={railArtifacts} with the working-set rail.
          <AgentWorkspace
            composer={composer}
            composerRef={composerRef}
            connected={connected}
            context={context}
            error={error}
            isLoadingHistory={isLoadingHistory}
            isSending={isSending}
            messages={messages}
            onComposerChange={setComposer}
            onConnect={() => setVisible(true)}
            onNavigate={collapseToSidecar}
            onPrompt={(prompt) => void submit(prompt)}
            onRetry={() => void retry()}
            onReviewBasket={openBasketReview}
            onReviewLimitOrder={openLimitOrderReview}
            onReviewQuote={openQuoteReview}
            onStop={stop}
            onSubmit={() => void submit()}
            prompts={prompts}
            scrollRef={scrollRef}
            shouldFollowRef={shouldFollowRef}
            ticker={ticker}
          />
        ) : (
          <>
            <AgentConversationThread
              connected={connected}
              error={error}
              isLoadingHistory={isLoadingHistory}
              messages={messages}
              onConnect={() => setVisible(true)}
              onPrompt={(prompt) => void submit(prompt)}
              onRetry={() => void retry()}
              onReviewBasket={openBasketReview}
              onReviewLimitOrder={openLimitOrderReview}
              onReviewQuote={openQuoteReview}
              prompts={prompts}
              scrollRef={scrollRef}
              shouldFollowRef={shouldFollowRef}
            />
            <AgentComposer
              composer={composer}
              composerRef={composerRef}
              connected={connected}
              isSending={isSending}
              onComposerChange={setComposer}
              onStop={stop}
              onSubmit={() => void submit()}
            />
          </>
        )}
      </aside>

      <div aria-live="polite" className="sr-only">
        {!isSending && messages.at(-1)?.role === 'assistant' ? t("agent.complete") : ''}
      </div>

      <AgentActionReview
        basket={reviewBasket}
        limitOrder={reviewLimitOrder}
        onClose={closeReview}
        quote={reviewQuote}
      />
    </>
  );
}
