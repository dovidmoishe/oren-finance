'use client';

import { PrivyProvider, usePrivy, useSigners } from '@privy-io/react-auth';
import { useEffect, useRef, useState } from 'react';
import { EmailLogin } from '@/components/auth/email-login';

/** The preview proof route owns its Privy session instead of using the dashboard's deferred session bridge. */
export function ProofSigner({ appId }: { appId: string }) {
  return <PrivyProvider appId={appId} config={{
    loginMethods: ['email'],
    appearance: { theme: 'light', accentColor: '#171717', walletChainType: 'solana-only' },
    externalWallets: { disableAllExternalWallets: true, walletConnect: { enabled: false } },
    embeddedWallets: { solana: { createOnLogin: 'off' }, showWalletUIs: true },
  }}><ProofSignerSession /></PrivyProvider>;
}

/** Public proof identifiers are typed by the wallet owner and never saved by this page. */
function ProofSignerSession() {
  const { ready, authenticated, user } = usePrivy();
  const { addSigners, removeSigners } = useSigners();
  const currentUserId = useRef(user?.id);
  useEffect(() => { currentUserId.current = user?.id; }, [user?.id]);
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
  const [loadingTooLong, setLoadingTooLong] = useState(false);
  useEffect(() => {
    const update = () => setNow(Date.now());
    update();
    const interval = window.setInterval(update, 30_000);
    return () => window.clearInterval(interval);
  }, []);
  useEffect(() => {
    if (ready) return;
    const timeout = window.setTimeout(() => setLoadingTooLong(true), 12_000);
    return () => window.clearTimeout(timeout);
  }, [ready]);

  const target = wallet.trim();
  const expiresAt = Number(expiry) * 1000;
  const validExpiry = Number.isSafeInteger(Number(expiry)) && expiresAt > now && expiresAt <= now + 7 * 86400_000;
  const ownsWallet = user?.linkedAccounts.some((account) =>
    account.type === 'wallet' && account.chainType === 'solana' &&
    account.walletClientType === 'privy' && account.address === target,
  );
  const eligible =
    ready && authenticated && ownsWallet &&
    target !== '' && user?.email?.address?.toLowerCase() === email.trim().toLowerCase() &&
    email.trim() !== '' && signerId.trim() !== '' && policyId.trim() !== '' && validExpiry;

  async function add() {
    if (!eligible || busy || done === 'added' || Date.now() >= expiresAt) return;
    const startedUser = user?.id;
    setBusy(true);
    setError(undefined);
    try {
      await addSigners({ address: target, signers: [{ signerId: signerId.trim(), policyIds: [policyId.trim()] }] });
      if (currentUserId.current !== startedUser) throw new Error('Your account changed. Check signer status again.');
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
    const startedUser = user?.id;
    setBusy(true);
    setError(undefined);
    try {
      await removeSigners({ address: target });
      if (currentUserId.current !== startedUser) throw new Error('Your account changed. Check signer status again.');
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
      <label>Wallet public address<input className="mt-1 w-full rounded-lg border border-border bg-background p-2" autoComplete="off" disabled={busy} value={wallet} onChange={(event) => setWallet(event.target.value)} /></label>
      <label>Test account email<input className="mt-1 w-full rounded-lg border border-border bg-background p-2" autoComplete="off" disabled={busy} type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
      <label>Proof signer ID<input className="mt-1 w-full rounded-lg border border-border bg-background p-2" autoComplete="off" disabled={busy} value={signerId} onChange={(event) => setSignerId(event.target.value)} /></label>
      <label>Proof policy ID<input className="mt-1 w-full rounded-lg border border-border bg-background p-2" autoComplete="off" disabled={busy} value={policyId} onChange={(event) => setPolicyId(event.target.value)} /></label>
      <label>Policy expiry, Unix seconds<input className="mt-1 w-full rounded-lg border border-border bg-background p-2" autoComplete="off" disabled={busy} inputMode="numeric" value={expiry} onChange={(event) => setExpiry(event.target.value)} /></label>
    </div>
    <p className="mt-3 text-sm">Proof terms: one unfunded, sign-only Jupiter buy into TSLAx with 0.50% slippage and exact wallet token accounts. Privy limits each instruction separately; the independent gate must reject multiple routes. Policy expiry: {validExpiry ? new Date(expiresAt).toLocaleString() : 'enter the supplied timestamp'}.</p>
    {!ready && <p className="mt-6 text-muted" role="status">{loadingTooLong ? 'Privy has not loaded. Please try this preview in a regular browser and refresh once.' : 'Loading Privy…'}</p>}
    {ready && !authenticated && <div className="mt-6 rounded-2xl border border-border bg-panel p-5"><EmailLogin onComplete={() => {}} /></div>}
    {ready && authenticated && !eligible && <p className="mt-6 text-red-700" role="alert">Enter the exact proof details for your signed-in account and embedded wallet.</p>}
    {eligible && <>
      <label className="mt-6 flex items-start gap-3 text-sm"><input checked={acknowledgedGrant} onChange={(event) => setAcknowledgedGrant(event.target.checked)} type="checkbox" /><span>I authorize this two-key proof signer for sign-only Jupiter tests on this unfunded disposable wallet until the expiry shown above. Privy checks each route separately; I will leave the wallet unfunded.</span></label>
      <button className="mt-3 rounded-xl bg-foreground px-5 py-3 text-white disabled:opacity-50" disabled={busy || !acknowledgedGrant || done === 'added'} onClick={() => void add()} type="button">{busy ? 'Waiting for Privy…' : done === 'added' ? 'Proof signer added' : 'Add proof signer'}</button>
      <p className="mt-8 text-sm text-muted">Privy’s removal action removes every signer on this wallet. Use it only after the proof tests are finished.</p>
      <label className="mt-3 flex items-start gap-3 text-sm"><input checked={acknowledgedRemoval} onChange={(event) => setAcknowledgedRemoval(event.target.checked)} type="checkbox" /><span>I understand this removes all signers on this disposable wallet.</span></label>
      <button className="mt-3 rounded-xl border border-border px-5 py-3 disabled:opacity-50" disabled={busy || !acknowledgedRemoval} onClick={() => void remove()} type="button">Remove all wallet signers</button>
    </>}
    {done && <p className="mt-5 text-sm" role="status">Privy reported the proof signer was {done}. Ask Oren to verify the wallet state before the next step.</p>}
    {error && <p className="mt-5 text-sm text-red-700" role="alert">{error}</p>}
  </main>;
}
