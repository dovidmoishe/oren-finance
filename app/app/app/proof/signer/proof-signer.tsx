'use client';

import { useEffect, useState } from 'react';
import { useOrenAuth } from '@/components/auth/auth-context';

/** One-off preview UI. Proof identifiers are entered by the owner and never saved by the page. */
export function ProofSigner() {
  const auth = useOrenAuth();
  const [wallet, setWallet] = useState('');
  const [email, setEmail] = useState('');
  const [signerId, setSignerId] = useState('');
  const [policyId, setPolicyId] = useState('');
  const [expiry, setExpiry] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<'added' | 'removed'>();
  const [error, setError] = useState<string>();
  const [acknowledgedGrant, setAcknowledgedGrant] = useState(false);
  const [acknowledgedRemoval, setAcknowledgedRemoval] = useState(false);
  const [now, setNow] = useState(0);
  useEffect(() => {
    const update = () => setNow(Date.now());
    update();
    const interval = window.setInterval(update, 30_000);
    return () => window.clearInterval(interval);
  }, []);

  const expiresAt = Number(expiry) * 1000;
  const validExpiry = Number.isSafeInteger(Number(expiry)) && expiresAt > now && expiresAt <= now + 7 * 86400_000;
  const eligible =
    auth.ready && auth.authenticated &&
    wallet.trim() !== '' && auth.address === wallet.trim() &&
    email.trim() !== '' && auth.email?.toLowerCase() === email.trim().toLowerCase() &&
    signerId.trim() !== '' && policyId.trim() !== '' && validExpiry;

  async function add() {
    if (!eligible || busy || done === 'added' || Date.now() >= expiresAt) return;
    setBusy(true);
    setError(undefined);
    try {
      await auth.addWalletSigners(wallet.trim(), [{ signerId: signerId.trim(), policyIds: [policyId.trim()] }]);
      setDone('added');
      setAcknowledgedGrant(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Privy could not add the proof signer.');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!eligible || busy || !acknowledgedRemoval) return;
    setBusy(true);
    setError(undefined);
    try {
      await auth.removeWalletSigners(wallet.trim());
      setDone('removed');
      setAcknowledgedRemoval(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Privy could not remove wallet signers.');
    } finally {
      setBusy(false);
    }
  }

  return <main className="mx-auto max-w-xl px-5 py-12 text-foreground">
    <h1 className="text-3xl font-semibold">Disposable wallet signer proof</h1>
    <p className="mt-3 text-muted">This is the PR #18 preview proof page. Enter the public proof details provided in chat; this page does not save them. Headless trading is disabled.</p>
    <div className="mt-6 grid gap-3 rounded-2xl border border-border bg-panel p-5 text-sm">
      <label>Wallet public address<input className="mt-1 w-full rounded-lg border border-border bg-background p-2" autoComplete="off" value={wallet} onChange={(event) => setWallet(event.target.value)} /></label>
      <label>Test account email<input className="mt-1 w-full rounded-lg border border-border bg-background p-2" autoComplete="off" type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
      <label>Proof signer ID<input className="mt-1 w-full rounded-lg border border-border bg-background p-2" autoComplete="off" value={signerId} onChange={(event) => setSignerId(event.target.value)} /></label>
      <label>Proof policy ID<input className="mt-1 w-full rounded-lg border border-border bg-background p-2" autoComplete="off" value={policyId} onChange={(event) => setPolicyId(event.target.value)} /></label>
      <label>Policy expiry, Unix seconds<input className="mt-1 w-full rounded-lg border border-border bg-background p-2" autoComplete="off" inputMode="numeric" value={expiry} onChange={(event) => setExpiry(event.target.value)} /></label>
    </div>
    <p className="mt-3 text-sm">Proof terms: Jupiter buy only, at most 1 USDC into TSLAx, 0.50% slippage, and exact wallet token accounts. Policy expiry: {validExpiry ? new Date(expiresAt).toLocaleString() : 'enter the supplied timestamp'}.</p>
    {!auth.ready && <p className="mt-6 text-muted">Loading your account…</p>}
    {auth.ready && !auth.authenticated && <button className="mt-6 rounded-xl bg-foreground px-5 py-3 text-white" onClick={auth.open} type="button">Sign in with the test account</button>}
    {auth.ready && auth.authenticated && !eligible && <p className="mt-6 text-red-700" role="alert">Enter the exact proof details for your signed-in account and active wallet. Current wallet: {auth.address ?? 'not ready'}.</p>}
    {eligible && <>
      <label className="mt-6 flex items-start gap-3 text-sm"><input checked={acknowledgedGrant} onChange={(event) => setAcknowledgedGrant(event.target.checked)} type="checkbox" /><span>I authorize this proof signer for matching Jupiter buys on this disposable wallet until the expiry shown above. Any matching signed trade can spend up to 1 USDC from this wallet.</span></label>
      <button className="mt-3 rounded-xl bg-foreground px-5 py-3 text-white disabled:opacity-50" disabled={busy || !acknowledgedGrant || done === 'added'} onClick={() => void add()} type="button">{busy ? 'Waiting for Privy…' : done === 'added' ? 'Proof signer added' : 'Add proof signer'}</button>
      <p className="mt-8 text-sm text-muted">Privy’s removal action removes every signer on this wallet. Use it only after the proof tests are finished.</p>
      <label className="mt-3 flex items-start gap-3 text-sm"><input checked={acknowledgedRemoval} onChange={(event) => setAcknowledgedRemoval(event.target.checked)} type="checkbox" /><span>I understand this removes all signers on this disposable wallet.</span></label>
      <button className="mt-3 rounded-xl border border-border px-5 py-3 disabled:opacity-50" disabled={busy || !acknowledgedRemoval} onClick={() => void remove()} type="button">Remove all wallet signers</button>
    </>}
    {done && <p className="mt-5 text-sm" role="status">Privy reported the proof signer was {done}. Ask Oren to verify the wallet state before the next step.</p>}
    {error && <p className="mt-5 text-sm text-red-700" role="alert">{error}</p>}
  </main>;
}
