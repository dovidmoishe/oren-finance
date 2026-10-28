"use client";

import QRCode from "qrcode";
import { useEffect, useRef, useState } from "react";
import { useOrenAuth } from "@/components/auth/auth-context";
import { Button } from "@/components/ui";
import { useFunding } from "@/hooks/use-funding";

export function DepositModal() {
  const auth = useOrenAuth();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (!auth.depositOpen || !element) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    element.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      element.close();
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [auth.depositOpen]);
  return <dialog aria-labelledby="deposit-title" className="oren-deposit-modal m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-3xl border border-border bg-panel p-6 text-foreground shadow-2xl sm:p-8" onCancel={auth.closeDeposit} onClick={(event) => {
    if (event.target !== event.currentTarget) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) auth.closeDeposit();
  }} ref={dialog}>
    <div className="flex items-center justify-between gap-4"><h2 className="font-display text-xl font-semibold" id="deposit-title">Deposit</h2><button aria-label="Close deposit" className="grid h-8 w-8 place-items-center rounded-full text-xl text-muted hover:bg-background" onClick={auth.closeDeposit} type="button">×</button></div>
    {auth.depositOpen && <div className="mt-5">
      {!auth.authenticated ? <div><p className="text-sm text-muted">Sign in to get your deposit address.</p><Button className="mt-4" onClick={() => { auth.closeDeposit(); auth.open(); }}>Sign in</Button></div>
        : !auth.address ? <div role="status"><p className="text-sm text-muted">{auth.error ? "Your wallet needs another moment." : "Preparing your wallet…"}</p>{auth.error && <><p className="mt-2 text-sm text-red-700" role="alert">{auth.error}</p><Button className="mt-4" disabled={auth.busy} onClick={() => void auth.createWallet()}>Retry wallet setup</Button></>}</div>
        : <DepositAddress key={auth.address} wallet={auth.address} getAccessToken={auth.getAccessToken} />}
    </div>}
  </dialog>;
}

function DepositAddress({ wallet, getAccessToken }: { wallet: string; getAccessToken: () => Promise<string | null> }) {
  // Funding events only live for this open modal. Balances/reconnection controls are intentionally absent.
  const { received } = useFunding(wallet, getAccessToken);
  const [qr, setQr] = useState<string>();
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void QRCode.toDataURL(wallet, { width: 240, margin: 2, errorCorrectionLevel: "M" }).then((value) => {
      if (!cancelled) setQr(value);
    }).catch(() => { /* The selectable address remains available. */ });
    return () => { cancelled = true; };
  }, [wallet]);
  return <>
    <p className="text-sm leading-6 text-muted">Send USDC or SOL to your Oren wallet using the Solana network.</p>
    <div className="mx-auto my-5 flex h-56 w-56 items-center justify-center rounded-2xl border border-border bg-white">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {qr ? <img alt="Your Solana deposit address QR code" className="h-52 w-52" height={208} width={208} src={qr} /> : <span className="text-sm text-muted">Preparing QR code…</span>}
    </div>
    <p className="text-xs font-semibold text-muted">Solana receiving address</p>
    <code className="mt-2 block select-all break-all rounded-xl border border-border bg-background p-3 text-xs leading-5">{wallet}</code>
    <Button className="mt-3 w-full" onClick={async () => {
      try { await navigator.clipboard.writeText(wallet); setCopied(true); setCopyError(false); }
      catch { setCopyError(true); }
    }}>{copied ? "Address copied" : "Copy address"}</Button>
    {copyError && <p className="mt-2 text-xs text-muted" role="status">Select and copy the address above.</p>}
    <p className="mt-4 text-xs leading-5 text-muted">Solana only. Send native USDC, and keep some SOL for network fees. Transfers on other networks may be lost.</p>
    {received && <p className="mt-4 text-sm font-medium text-emerald-700" role="status">Funds received.</p>}
  </>;
}