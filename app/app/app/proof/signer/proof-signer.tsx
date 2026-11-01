'use client';

import { useEffect, useState } from 'react';
import { useOrenAuth } from '@/components/auth/auth-context';

const WALLET = 'AJoHhwuUnSQXWqDPTmvzb9X2r5KiBCX7wopvPHoqLMF3';
const EMAIL = 'ayomidedavidbaiye@gmail.com';
const SIGNER_ID = 'h2917c50veqxb2omcxfwc87j';
const POLICY_ID = 'wwfcrjbf9ur4ehh7knd9x8rq';
const EXPIRES_AT_UNIX = 1794176586;

/** Browser owner consent for the disposable wallet only; never used in production. */
export function ProofSigner() {
  const auth = useOrenAuth();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<'added' | 'removed'>();
  const [error, setError] = useState<string>();
  const [acknowledgedGrant, setAcknowledgedGrant] = useState(false);
  const [acknowledgedRemoval, setAcknowledgedRemoval] = useState(false);
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    const update = () => setExpired(Date.now() >= EXPIRES_AT_UNIX * 1000);
    update();
    const interval = window.setInterval(update, 30_000);
    return () => window.clearInterval(interval);
  }, []);
  const eligible =
    auth.ready &&
    auth.authenticated &&
    auth.address === WALLET &&
    auth.email?.toLowerCase() === EMAIL;

  async function add() {
    if (!eligible || !acknowledgedGrant || busy || done === 'added' || Date.now() >= EXPIRES_AT_UNIX * 1000) return;
    setBusy(true);
    setError(undefined);
    try {
      await auth.addWalletSigners(WALLET, [{ signerId: SIGNER_ID, policyIds: [POLICY_ID] }]);
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
      await auth.removeWalletSigners(WALLET);
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
    <p className="mt-3 text-muted">This is the PR #18 preview proof page for one test wallet. Headless trading is disabled.</p>
    <div className="mt-6 rounded-2xl border border-border bg-panel p-5 text-sm">
      <p>Wallet: <span className="break-all font-medium">{WALLET}</span></p>
      <p className="mt-2">Account: {EMAIL}</p>
      <p className="mt-2">Proof policy: <span className="break-all font-medium">{POLICY_ID}</span></p>
      <p className="mt-2">Jupiter buy: at most 1 USDC into TSLAx, 0.50% slippage, exact wallet token accounts.</p>
      <p className="mt-2">Expires: {new Date(EXPIRES_AT_UNIX * 1000).toLocaleString()}</p>
    </div>
    {!auth.ready && <p className="mt-6 text-muted">Loading your account…</p>}
    {auth.ready && !auth.authenticated && <button className="mt-6 rounded-xl bg-foreground px-5 py-3 text-white" onClick={auth.open} type="button">Sign in with the test email</button>}
    {auth.ready && auth.authenticated && !eligible && <p className="mt-6 text-red-700" role="alert">This page only works with the designated disposable test account and wallet. Current wallet: {auth.address ?? 'not ready'}.</p>}
    {eligible && <>
      <label className="mt-6 flex items-start gap-3 text-sm"><input checked={acknowledgedGrant} onChange={(event) => setAcknowledgedGrant(event.target.checked)} type="checkbox" /><span>I authorize this proof signer for matching Jupiter buys on this disposable wallet until the expiry shown above. Any matching signed trade can spend up to 1 USDC from this wallet.</span></label>
      <button className="mt-3 rounded-xl bg-foreground px-5 py-3 text-white disabled:opacity-50" disabled={busy || !acknowledgedGrant || done === 'added' || expired} onClick={() => void add()} type="button">{busy ? 'Waiting for Privy…' : done === 'added' ? 'Proof signer added' : 'Add proof signer'}</button>
      <p className="mt-8 text-sm text-muted">Privy’s removal action removes every signer on this wallet. Use it only after the proof tests are finished.</p>
      <label className="mt-3 flex items-start gap-3 text-sm"><input checked={acknowledgedRemoval} onChange={(event) => setAcknowledgedRemoval(event.target.checked)} type="checkbox" /><span>I understand this removes all signers on this disposable wallet.</span></label>
      <button className="mt-3 rounded-xl border border-border px-5 py-3 disabled:opacity-50" disabled={busy || !acknowledgedRemoval} onClick={() => void remove()} type="button">Remove all wallet signers</button>
    </>}
    {done && <p className="mt-5 text-sm" role="status">Privy reported the proof signer was {done}. Ask Oren to verify the wallet state before the next step.</p>}
    {error && <p className="mt-5 text-sm text-red-700" role="alert">{error}</p>}
  </main>;
}
