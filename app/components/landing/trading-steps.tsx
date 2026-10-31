"use client";
import { ArrowUpRight01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';


import Image from "next/image";
import { useRef, type CSSProperties } from "react";
import { StockLogo } from "@/components/stock/stock-logo";
import { useLandingReveal } from "./use-landing-reveal";
import motion from "./landing-motion.module.css";
import styles from "./trading-steps.module.css";

const steps = [
  { number: "01", title: "Research your stocks.", copy: "Explore charts, signals, and news with Oren.", asset: "pick-stocks", alt: "Painted meadow paths winding toward lilac mountains" },
  { number: "02", title: "Review the details.", copy: "Check the amount, route, and estimated fees.", asset: "review-trade", alt: "A quiet painted lakeside lookout overlooking the mountains" },
  { number: "03", title: "You approve.", copy: "Confirm each trade when everything looks right.", asset: "approve-trade", alt: "A painted stone bridge leading through a sunlit meadow" },
];

export function TradingSteps() {
  const root = useRef<HTMLElement>(null);
  useLandingReveal(root);

  return <section ref={root} className={`${styles.section} ${motion.group}`} id="how-it-works" aria-labelledby="trading-steps-heading">
    <div className={styles.intro}>
      <div><p className={styles.eyebrow}>How it works</p><h2 className={motion.focus} data-reveal="ready" id="trading-steps-heading">Trade in three steps.</h2></div>
      <p className={`${styles.support} ${motion.focus}`} data-reveal="ready" style={{ "--reveal-delay": "120ms" } as CSSProperties}>Oren helps you get there.<br />You make the call.</p>
    </div>

    <div className={styles.cards}>
      {steps.map((step, index) => <article key={step.number} className={`${styles.card} ${motion.rise}`} data-reveal="ready" style={{ "--reveal-delay": `${index * 100}ms` } as CSSProperties}>
        <span className={styles.number}>{step.number}<span aria-hidden> / 03</span></span>
        <div className={styles.visual}>
          <Image src={`/landing/trading-steps/${step.asset}-v2.webp`} alt={step.alt} fill unoptimized sizes="(max-width: 700px) calc(100vw - 40px), (max-width: 1023px) 30vw, 390px" className={styles.art} />
          {index === 0 && <span className={styles.stockBadge} aria-label="NVIDIA, Apple and Microsoft"><StockLogo ticker="NVDA" size={24} /><StockLogo ticker="AAPL" size={24} /><StockLogo ticker="MSFT" size={24} /></span>}
        </div>
        <div className={styles.copy}><h3>{step.title}</h3><p>{step.copy}</p></div>
      </article>)}
    </div>
    <a className={styles.explore} href="#stock-mix">Try it with Stock mix <span aria-hidden><HugeiconsIcon icon={ArrowUpRight01Icon} size={16} strokeWidth={1.5} color="currentColor" aria-hidden="true" focusable="false" className="inline-block shrink-0 align-middle" /></span></a>
  </section>;
}
