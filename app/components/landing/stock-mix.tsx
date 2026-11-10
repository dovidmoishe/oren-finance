"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft01Icon, RefreshIcon, ArrowUpRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { OrenLogo } from "@/components/brand/oren-logo";
import { AgentComposerView } from "@/components/agent/agent-composer-view";
import { BasketProposal } from "@/components/trading/basket-proposal";
import { BasketReview } from "@/components/trading/basket-review";
import { Button, ButtonLink, formatCurrency } from "@/components/ui";
import type { BasketResponse } from "@/types";
import { applyMixRequest, initialMix, mixAmounts } from "./stock-mix-model";
import { useI18n } from "@/i18n/i18n";
import styles from "./stock-mix.module.css";
import { useLandingReveal } from "./use-landing-reveal";
import motion from "./landing-motion.module.css";

const names = { NVDA: "NVIDIA", AAPL: "Apple", MSFT: "Microsoft", TSLA: "Tesla" };
const initialPrompt = "Build a $1,000 mix with NVIDIA, Apple and Microsoft.";
const initialResponse = "Here’s a sample mix: 40% NVIDIA, 35% Apple and 25% Microsoft. You can change it before reviewing each trade.";
const prompts = ["Make it equal", "Add Tesla", "Use $500", "Less NVIDIA"];

export function StockMix() {
  const { locale } = useI18n();
  const root = useRef<HTMLElement>(null);
  useLandingReveal(root);
  const [holdings, setHoldings] = useState(initialMix);
  const [budget, setBudget] = useState(1000);
  const [question, setQuestion] = useState(initialPrompt);
  const [answer, setAnswer] = useState(initialResponse);
  const [composer, setComposer] = useState("");
  const [review, setReview] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const reviewRef = useRef<HTMLHeadingElement>(null);
  const amounts = mixAmounts(holdings, budget);
  const basket: BasketResponse = {
    id: "landing-stock-mix-demo", totalAmountUsd: budget, createdAt: "2026-10-31T00:00:00Z", riskLabel: "Demo",
    allocations: holdings.flatMap((holding, index) => holding.weight > 0 ? [{
      assetId: `demo-${holding.symbol}`, ticker: holding.symbol, name: names[holding.symbol],
      weightPercent: holding.weight, amountUsd: amounts[index],
    }] : []),
  };

  useEffect(() => {
    if (review) {
      reviewRef.current?.focus({ preventScroll: true });
      const bounds = reviewRef.current?.getBoundingClientRect();
      if (bounds && (bounds.top < 96 || bounds.bottom > window.innerHeight)) reviewRef.current?.scrollIntoView({ block: "start" });
    }
  }, [review]);

  function submit(prompt: string) {
    const text = prompt.trim().slice(0, 180);
    if (!text) return;
    const result = applyMixRequest(holdings, budget, text);
    setQuestion(text); setHoldings(result.holdings); setBudget(result.budget);
    setAnswer(result.recognized
      ? `Updated. ${formatCurrency(result.budget, locale)} across ${result.holdings.filter((holding) => holding.weight > 0).length} stocks. Your proposal is ready to review.`
      : "This demo supports a few requests. Try “Make it equal”, “Add Tesla”, “Less NVIDIA”, or an amount from $10 to $10,000.");
    setComposer(""); setReview(false);
  }

  function reset() {
    setHoldings(initialMix); setBudget(1000); setQuestion(initialPrompt); setAnswer(initialResponse); setComposer(""); setReview(false);
  }

  return <section ref={root} className={`${styles.section} ${motion.group}`} id="stock-mix" aria-labelledby="stock-mix-heading">
    <div className={styles.intro}>
      <h2 className={motion.focus} data-reveal="ready" id="stock-mix-heading">Build your stock mix.</h2>
    </div>
    <div className={`${styles.frame} ${motion.surface}`} data-reveal="ready">
      <div className={`${styles.terminal} oren-app`}>
        <header className={styles.header}>
          <span className={styles.wordmark}><OrenLogo size={26} className="h-[26px] w-[26px]" />Oren</span>
          <span className={styles.workspaceLabel}>Agent workspace</span>
          <div className={styles.headerActions}><span className={styles.demo}>Demo</span><Button aria-label="Reset Stock mix demo" onClick={reset} variant="ghost" size="icon"><HugeiconsIcon icon={RefreshIcon} size={16} strokeWidth={1.8} /></Button></div>
        </header>
        <div className={styles.workspace}>
          <div className={styles.conversation}>
            <div className={styles.chat}>
              <p className={styles.threadTitle}>Building your stock mix</p>
              <div className={styles.userMessage}>{question}</div>
              <div className={styles.response}><span className={styles.agentIdentity}><OrenLogo size={25} className="h-[25px] w-[25px]" /><strong>Oren</strong></span><p aria-live="polite"><span key={`${question}:${answer}`} className={motion.reply}>{answer}</span></p><button type="button" className={styles.artifactChip} aria-label="View stock mix proposal" onClick={() => reviewRef.current?.scrollIntoView({ block: "start" })}>Stock mix · {basket.allocations.length} stocks <HugeiconsIcon icon={ArrowUpRight01Icon} size={16} strokeWidth={1.5} color="currentColor" aria-hidden="true" focusable="false" className="inline-block shrink-0 align-middle" /></button></div>
            </div>
            <div className={styles.suggestions} aria-label="Try a sample request">{prompts.map((prompt) => <button type="button" key={prompt} onClick={() => submit(prompt)}>{prompt}<span aria-hidden><HugeiconsIcon icon={ArrowUpRight01Icon} size={16} strokeWidth={1.5} color="currentColor" aria-hidden="true" focusable="false" className="inline-block shrink-0 align-middle" /></span></button>)}</div>
            <AgentComposerView connected isSending={false} composer={composer} composerRef={composerRef} placeholder="Try “Add Tesla” or “Use $500”…" onComposerChange={(value) => setComposer(value.slice(0, 180))} onSubmit={() => submit(composer)} onStop={() => {}} />
          </div>
          <aside className={styles.workingSet} aria-label="Stock mix working set">
            <div className={styles.workingHeading}><h3 ref={reviewRef} tabIndex={review ? -1 : undefined}>{review ? "Review your mix" : "Working set"}</h3>{review ? <Button size="sm" variant="ghost" onClick={() => { setReview(false); composerRef.current?.focus(); }}><HugeiconsIcon icon={ArrowLeft01Icon} size={13} />Back</Button> : <span>1 proposal</span>}</div>
            <div className={`${styles.result} ${motion.result}`} key={`${review}:${budget}:${holdings.map((holding) => `${holding.symbol}-${holding.weight}`).join(",")}`}>
              {review ? <><BasketReview basket={basket} /><ButtonLink href="/app" className="mt-4 h-10 w-full rounded-[12px]" variant="primary">Open Oren <HugeiconsIcon icon={ArrowUpRight01Icon} size={16} strokeWidth={1.5} color="currentColor" aria-hidden="true" focusable="false" className="inline-block shrink-0 align-middle" /></ButtonLink></> : <BasketProposal basket={basket} onReview={() => setReview(true)} />}
            </div>
          </aside>
        </div>
        <footer className={styles.caption}><span>Interactive demo</span><span>Sample requests and allocations. No funds move.</span></footer>
      </div>
    </div>
  </section>;
}
