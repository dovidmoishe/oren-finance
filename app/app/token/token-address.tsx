"use client";

import { useEffect, useState } from "react";
import styles from "./token.module.css";

const MINT = "57vAaMsnAJXkvULtAz7fsi6gRn3bHRJFJsJV1okNpump";

export function TokenAddress() {
  const [status, setStatus] = useState<"idle" | "copied" | "error">("idle");

  useEffect(() => {
    if (status === "idle") return;
    const timer = window.setTimeout(() => setStatus("idle"), 3000);
    return () => window.clearTimeout(timer);
  }, [status]);

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(MINT);
      setStatus("copied");
    } catch {
      setStatus("error");
    }
  }

  return <div className={styles.heroMint}>
    <div className={styles.mintChip}>
      <span className={styles.mintLabel}>Token address</span>
      <a href={`https://solscan.io/token/${MINT}`} target="_blank" rel="noopener noreferrer" title={MINT} aria-label={`View official Oren mint ${MINT} on Solscan`}>
        <span className={styles.mintFull}>{MINT}</span><span className={styles.mintShort} aria-hidden="true">57vAaMsn…1okNpump</span>
      </a>
      <button type="button" onClick={copyAddress} aria-label={status === "copied" ? "Address copied" : "Copy token address"} title="Copy token address">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {status === "copied" ? <path d="m5 12 4 4L19 6" /> : <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V4H4v12h4" /></>}
        </svg>
      </button>
    </div>
    <span className={styles.copyStatus} role="status">{status === "error" ? "Couldn’t copy. Open the address on Solscan to copy it." : ""}</span>
  </div>;
}
