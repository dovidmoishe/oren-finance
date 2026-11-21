"use client";

import { ArrowUpRight, Newspaper, RefreshCw, Sparkles } from "lucide-react";
import Link from "next/link";
import { useEffect, useLayoutEffect, useRef } from "react";
import { useOrenAuth } from "@/components/auth/auth-context";
import { OrenLogo } from "@/components/brand/oren-logo";
import { Button, cn } from "@/components/ui";
import { useI18n, useT } from "@/i18n/i18n";
import { exploreFeedKey, useAgentStore, useExploreStore, type ExploreScope } from "@/store";
import type { NewsStory } from "@/types/news-feed";

const focus = "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus";

export function ExplorePage() {
  const auth = useOrenAuth();
  const t = useT();
  const scope = useExploreStore((state) => state.selectedScope);
  const setScope = useExploreStore((state) => state.selectScope);
  return (
    <div className="@container/news mx-auto max-w-[75rem]">
      <header className="py-3 sm:py-5">
        <h1 className="font-display text-2xl font-medium tracking-tight sm:text-3xl">{t("news.title")}</h1>
        <p className="mt-2 max-w-xl text-sm leading-6 text-muted">{t("news.intro")}</p>
      </header>
      <nav aria-label={t("news.views")} className="mt-4 flex gap-6 border-b border-border">
        {(["for-you", "trending"] as const).map((view) => (
          <button aria-current={view === scope ? "page" : undefined} className={cn("inline-flex min-h-11 items-center gap-2 border-b-2 text-sm", focus, view === scope ? "border-foreground font-medium text-foreground" : "border-transparent text-muted hover:text-foreground")} key={view} onClick={() => setScope(view)} type="button">
            {view === "for-you" ? <Sparkles aria-hidden="true" size={15} /> : <Newspaper aria-hidden="true" size={15} />}
            {t(view === "for-you" ? "news.forYou" : "news.trending")}
          </button>
        ))}
      </nav>
      {scope === "for-you" && (!auth.ready || (auth.authenticated && (!auth.address || !auth.userId))) ? (
        auth.ready && auth.error ? (
          <div className="py-10" role="alert">
            <p className="text-sm text-muted">{auth.error}</p>
            <Button className="mt-3" disabled={auth.walletPreparing || auth.busy} onClick={() => void auth.createWallet()} size="sm" variant="secondary">{t("agent.retryWallet")}</Button>
          </div>
        ) : <p className="py-10 text-sm text-muted" role="status">{t("portfolio.preparingDescription")}</p>
      ) : scope === "for-you" && !auth.authenticated ? (
        <section className="mt-6 rounded-2xl border border-accent-lavender/40 bg-linear-to-br from-accent-lavender/25 via-panel to-panel p-6 sm:p-8">
          <OrenLogo size={32} />
          <h2 className="mt-5 text-xl font-medium tracking-tight">{t("news.signInTitle")}</h2>
          <p className="mt-2 max-w-md text-sm leading-6 text-muted">{t("news.signInBody")}</p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Button disabled={auth.configured === false} onClick={auth.open} size="sm">{t("account.signIn")}</Button>
            <Button onClick={() => setScope("trending")} size="sm" variant="ghost">{t("news.browseTrending")}<ArrowUpRight aria-hidden="true" size={14} /></Button>
          </div>
        </section>
      ) : (
        <NewsFeedSection getAccessToken={auth.getAccessToken} key={`${scope}:${scope === "for-you" ? `${auth.userId}:${auth.address}` : "public"}`} scope={scope} userId={scope === "for-you" ? auth.userId : undefined} wallet={scope === "for-you" ? auth.address : undefined} />
      )}
    </div>
  );
}

function NewsFeedSection({ scope, userId, wallet, getAccessToken }: {
  scope: ExploreScope;
  userId?: string;
  wallet?: string;
  getAccessToken: () => Promise<string | null>;
}) {
  const { locale, timeZone, t } = useI18n();
  const key = exploreFeedKey(scope, userId, wallet);
  const entry = useExploreStore((state) => key ? state.feeds[key] : undefined);
  const loadFeed = useExploreStore((state) => state.loadFeed);
  const feed = entry?.feed;
  const error = entry?.error ?? false;
  const loading = entry?.isLoading ?? true;
  const tokenProvider = useRef(getAccessToken);
  useLayoutEffect(() => { tokenProvider.current = getAccessToken; }, [getAccessToken]);
  useEffect(() => {
    void loadFeed(scope, userId && wallet ? { userId, wallet, getAccessToken: () => tokenProvider.current() } : undefined);
  }, [scope, userId, wallet, loadFeed]);
  const personal = scope === "for-you";
  const refresh = () => { void loadFeed(scope, userId && wallet ? { userId, wallet, getAccessToken: () => tokenProvider.current() } : undefined, true); };
  return (
    <section aria-label={t(personal ? "news.forYou" : "news.trending")}>
      <div className="flex flex-wrap items-center justify-between gap-3 py-4">
        <p className="text-xs leading-5 text-muted" role="status">
          {loading ? t(personal ? "news.curating" : "markets.loadingData") : feed?.selection === "agent" ? t("news.agentSelected") : t(personal ? "news.latestHoldings" : "news.trendingNote")}
        </p>
        <button aria-label={t("news.refresh")} className={cn("inline-flex min-h-9 items-center gap-1.5 rounded-full px-2 text-xs text-muted hover:bg-panel-subtle hover:text-foreground disabled:opacity-50 pointer-coarse:min-h-11", focus)} disabled={loading} onClick={refresh} type="button">
          <RefreshCw aria-hidden="true" className={loading ? "motion-safe:animate-spin" : undefined} size={13} />{t("news.refresh")}
        </button>
      </div>
      {loading && !feed ? <div aria-hidden="true" className="space-y-6 py-4 motion-safe:animate-pulse">{[0, 1, 2].map((key) => <div className="space-y-3" key={key}><div className="h-3 w-28 rounded bg-panel-subtle" /><div className="h-6 w-4/5 rounded bg-panel-subtle" /><div className="h-3 w-3/5 rounded bg-panel-subtle" /></div>)}</div> : null}
      {error ? <div className="rounded-xl border border-border p-5" role="alert"><p className="text-sm text-muted">{t("news.loadError")}</p><Button className="mt-3" onClick={refresh} size="sm" variant="secondary">{t("preferences.retry")}</Button></div> : null}
      {feed && !error ? (
        <>
          {feed.partial ? <p className="mb-4 text-xs leading-5 text-muted" role="status">{t("news.partial")}</p> : null}
          {feed.state === "no_holdings" ? <NewsEmpty body={t("news.noHoldingsBody")} title={t("news.noHoldingsTitle")} /> : feed.items.length === 0 ? <NewsEmpty body={t("news.noNewsBody")} title={t("news.noNewsTitle")} /> : (
            <div className="grid items-start gap-7 @4xl/news:grid-cols-[minmax(0,1fr)_13rem] @4xl/news:gap-10">
              <div className="min-w-0">
                {feed.items.map((story, index) => <StoryRow featured={index === 0} key={story.id} personal={personal} story={story} />)}
              </div>
              {personal && feed.stocks.length ? (
                <aside className="min-w-0 border-t border-border pt-5 @4xl/news:border-t-0 @4xl/news:pt-1">
                  <h2 className="text-xs font-medium text-muted">{t("news.yourHoldings")}</h2>
                  <ul className="mt-3 divide-y divide-border">{feed.stocks.map((stock) => <li key={stock.assetId}><Link className={cn("flex min-h-12 items-center justify-between gap-2 py-3", focus)} href={`/app/stocks/${encodeURIComponent(stock.assetId)}`}><span className="min-w-0"><span className="block text-xs font-medium">{stock.ticker}</span><span className="block truncate text-xs text-muted">{stock.name}</span></span><ArrowUpRight aria-hidden="true" className="shrink-0 text-muted" size={13} /></Link></li>)}</ul>
                  <p className="mt-4 text-xs leading-5 text-muted">{t("news.coverage", { count: feed.stocks.length, total: feed.totalHoldings })}</p>
                </aside>
              ) : null}
            </div>
          )}
          <p className="mt-6 text-[11px] text-muted">{t("news.updated", { time: new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone }).format(new Date(feed.generatedAt)) })}</p>
        </>
      ) : null}
    </section>
  );
}

function NewsEmpty({ title, body }: { title: string; body: string }) {
  return <div className="py-12"><h2 className="text-lg font-medium">{title}</h2><p className="mt-2 max-w-md text-sm leading-6 text-muted">{body}</p></div>;
}

function StoryRow({ story, featured, personal }: { story: NewsStory; featured: boolean; personal: boolean }) {
  const { locale, timeZone, t } = useI18n();
  const auth = useOrenAuth();
  const busy = useAgentStore((state) => state.isSending);
  const setPanelOpen = useAgentStore((state) => state.setPanelOpen);
  const sendMessage = useAgentStore((state) => state.sendMessage);
  const canAsk = auth.authenticated && Boolean(auth.address);
  const ask = () => {
    if (!auth.address || !canAsk || busy) return;
    setPanelOpen(true);
    void sendMessage(t("news.askPrompt", { headline: story.headline, url: story.url }), auth.address, { page: "explore" });
  };
  return (
    <article className={cn("min-w-0 border-b border-border py-5 last:border-0", featured && "rounded-2xl border-0 bg-linear-to-br from-accent-lavender/20 via-panel-subtle to-panel-subtle p-5 sm:p-6")}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted"><span className="font-medium text-foreground">{story.source}</span><span aria-hidden="true">·</span><time dateTime={story.publishedAt}>{new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone }).format(new Date(story.publishedAt))}</time></div>
      <h2 className={cn("mt-2.5 text-base font-medium leading-snug tracking-tight", featured && "max-w-2xl text-xl sm:text-2xl")}><a className={cn("rounded hover:underline hover:decoration-foreground/30 hover:underline-offset-4", focus)} href={story.url} rel="noopener noreferrer" target="_blank">{story.headline}<ArrowUpRight aria-hidden="true" className="ms-1.5 inline-block align-baseline text-muted" size={featured ? 17 : 14} /></a></h2>
      {story.summary ? <p className={cn("mt-2.5 line-clamp-2 text-sm leading-6 text-muted", featured && "line-clamp-3")}>{story.summary}</p> : null}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap gap-1.5">{story.stocks.map((stock) => <Link className={cn("inline-flex min-h-7 items-center rounded-full border border-border px-2.5 text-[11px] text-muted hover:border-border-strong hover:text-foreground pointer-coarse:min-h-11", focus)} href={`/app/stocks/${encodeURIComponent(stock.assetId)}`} key={stock.assetId}>{personal ? t("news.youHold", { ticker: stock.ticker }) : stock.ticker}</Link>)}</div>
        {canAsk ? <button className={cn("inline-flex min-h-9 items-center gap-1.5 rounded-full px-2 text-xs font-medium text-muted hover:text-foreground disabled:opacity-50 pointer-coarse:min-h-11", focus)} disabled={busy} onClick={ask} type="button"><Sparkles aria-hidden="true" size={13} />{t("news.askOren")}</button> : null}
      </div>
    </article>
  );
}
