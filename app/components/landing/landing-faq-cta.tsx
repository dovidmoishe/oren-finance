"use client";

import Link from "next/link";
import { useId, useRef, useState } from "react";
import { OrenLogo } from "@/components/brand/oren-logo";
import { ButtonLink } from "@/components/ui";
import { useLandingReveal } from "./use-landing-reveal";
import motion from "./landing-motion.module.css";
import styles from "./landing-faq-cta.module.css";
import "./landing-accordion.css";

const questions = [
  { question: "What is Oren?", answer: "Oren is an AI-powered trading terminal for tokenized stocks on Solana. Research stocks, build a mix, and follow your portfolio in one place." },
  { question: "What can I trade?", answer: "Supported tokenized stocks on Solana. Browse Markets to see the available companies, token details, and current quotes." },
  { question: "What can the AI agent do?", answer: "Ask about a stock, explore market signals, or build a stock mix. Oren helps with research and proposes trades for you to review." },
  { question: "Can Oren trade without my approval?", answer: "No. Oren proposes a trade, then you review the details and approve it before it is submitted. The final call is yours." },
  { question: "Do I need to set up a wallet first?", answer: "No. Sign in with your email and Oren prepares a Solana wallet for your account. You can fund it from the app." },
  { question: "What fees will I pay?", answer: "You can review the quote and estimated network fee before approving a trade. Costs vary with the trade and network conditions." },
];

function Arrow() {
  return <svg aria-hidden width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8h9M8.5 4.5 12 8l-3.5 3.5" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export function LandingFaqCta() {
  const root = useRef<HTMLDivElement>(null);
  const id = useId();
  const [open, setOpen] = useState<number | null>(0);
  useLandingReveal(root);

  return <div ref={root} className={motion.group}>
    <section className={styles.faq} id="faq" aria-labelledby="faq-heading">
      <div className={styles.faqIntro}>
        <h2 id="faq-heading" aria-label="A few things to know." className={motion.focus} data-reveal="ready">A few things{" "}<br />to know.</h2>
        <p className={styles.faqNote}>Before you make your first move.</p>
      </div>
      <div className={`${styles.questions} ${motion.rise}`} data-reveal="ready">
        {questions.map((item, index) => {
          const expanded = open === index;
          const questionId = `${id}-question-${index}`;
          const answerId = `${id}-answer-${index}`;
          return <div key={item.question} className={`t-acc ${styles.item}`} data-open={expanded}>
            <h3>
              <button type="button" id={questionId} className={`t-acc-head ${styles.question}`} aria-expanded={expanded} aria-controls={answerId} onClick={() => setOpen(current => current === index ? null : index)}>
                <span>{item.question}</span>
                <span className={`t-acc-chevron ${styles.chevron}`} aria-hidden="true"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 6.5L8 10.5L12 6.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
              </button>
            </h3>
            <div id={answerId} className="t-acc-panel" role="region" aria-labelledby={questionId} aria-hidden={!expanded} inert={!expanded}>
              <div className="t-acc-panel-inner"><p className={styles.answer}>{item.answer}</p></div>
            </div>
          </div>;
        })}
      </div>
    </section>

    <section className={styles.closing} id="get-started" aria-labelledby="closing-heading">
      <div className={`${styles.invitation} ${motion.surface}`} data-reveal="ready">
        <div className={styles.landscape} aria-hidden="true" />
        <div className={styles.closingCopy}>
          <h2 id="closing-heading" className={motion.focus} data-reveal="ready">Start with<br />a question.</h2>
          <p className={styles.description}>Research a stock, build a mix, and review your next trade with Oren.</p>
          <div className={styles.actions}>
            <ButtonLink href="/app" id="closing-launch-cta" variant="primary" className="h-11 rounded-full px-5 text-[13px] font-medium">Launch Oren <Arrow /></ButtonLink>
            <Link href="/app/markets" className={styles.marketLink}>Explore markets <span aria-hidden="true">↗</span></Link>
          </div>
        </div>
        <div className={styles.mascotStage} aria-hidden="true">
          <div className={styles.mascot}><OrenLogo size={170} interactive attentionTargetId="closing-launch-cta" className={styles.character} /></div>
          <span className={styles.ground} />
        </div>
      </div>
    </section>

  </div>;
}
