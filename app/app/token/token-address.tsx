"use client";
import { Tick02Icon, Copy01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';


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
        <HugeiconsIcon icon={status === "copied" ? Tick02Icon : Copy01Icon} size={16} strokeWidth={1.5} color="currentColor" aria-hidden="true" focusable="false" className="inline-block shrink-0 align-middle" />
      </button>
    </div>
    <span className={styles.copyStatus} role="status">{status === "error" ? "Couldn’t copy. Open the address on Solscan to copy it." : ""}</span>
  </div>;
}
