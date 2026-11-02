'use client';

import { useEffect, useRef, useState } from 'react';
import { Cancel01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useOrenAuth } from '@/components/auth/auth-context';
import { Button } from '@/components/ui';
import { useFunding } from '@/hooks/use-funding';
import { usePortfolioRefresh } from '@/hooks/use-portfolio-refresh';
import { ApiError } from '@/services/api-client';
import { approveServerTrade, forgetApproval, getServerApproval, type TradeApproval } from '@/services/approval-service';
import { financialExecutionEnabled } from '@/services/environment';
import { getWithdrawalStocks, prepareWithdrawal, recoverWithdrawal, solCost, type WithdrawalStock } from '@/services/withdrawal-service';
import { walletSessionIsCurrent } from '@/services/wallet-session';

export function WithdrawalModal({ onClose }: { onClose: () => void }) {
  const auth = useOrenAuth();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    element.showModal();
    document.body.style.overflow = 'hidden';
    return () => {
      element.close(); document.body.style.overflow = previousOverflow; previousFocus?.focus();
    };
  }, []);
  return <dialog ref={dialog} aria-labelledby="withdraw-title" className="oren-deposit-modal m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-3xl border border-border bg-panel p-5 text-foreground shadow-2xl sm:p-6" onCancel={onClose} onClick={event => {
    if (event.target !== event.currentTarget) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
  }}>
      <div className="flex items-center justify-between gap-4"><h2 id="withdraw-title" className="font-display text-xl font-semibold">Withdraw</h2><button aria-label="Close withdrawal" className="grid h-8 w-8 place-items-center rounded-full text-muted hover:bg-background" type="button" onClick={onClose}><HugeiconsIcon icon={Cancel01Icon} size={16} aria-hidden="true" /></button></div>
      <p className="mt-2 text-sm leading-6 text-muted">Send cash or tokenized stocks to another Solana wallet.</p>
      {!financialExecutionEnabled ? <p className="mt-6 text-sm" role="status">Withdrawals are disabled in previews.</p>
        : !auth.ready ? <p className="mt-6 text-sm" role="status">Loading your account…</p>
        : !auth.authenticated ? <Button className="mt-6" onClick={auth.open}>Sign in to withdraw</Button>
        : !auth.address ? <p className="mt-6 text-sm" role="status">Your wallet is being prepared. Try again shortly.</p>
        : <WithdrawalForm key={auth.address} wallet={auth.address} />}
  </dialog>;
}

function WithdrawalForm({ wallet }: { wallet: string }) {
  const { getAccessToken, authorizeTrade } = useOrenAuth();
  const { snapshot, error: balanceError } = useFunding(wallet, getAccessToken);
  const refresh = usePortfolioRefresh();
  const [asset, setAsset] = useState<string>('USDC');
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [approval, setApproval] = useState<TradeApproval>();
  const [stage, setStage] = useState<'loading' | 'recovery-error' | 'edit' | 'review' | 'pending' | 'confirmed' | 'failed'>('loading');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [checked, setChecked] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const lock = useRef(false);
  const mounted = useRef(true);
  const requestId = useRef<string | undefined>(undefined);
  const [stocks, setStocks] = useState<WithdrawalStock[]>([]);
  const [stocksLoading, setStocksLoading] = useState(true);
  const [stocksError, setStocksError] = useState<string>();
  const [stocksRevision, setStocksRevision] = useState(0);
  const [recoveryRevision, setRecoveryRevision] = useState(0);
  const stock = stocks.find(item => item.mint === asset);
  const symbol = stock?.symbol ?? asset;
  useEffect(() => {
    let active = true;
    const current = walletSessionIsCurrent();
    void getAccessToken().then(token => getWithdrawalStocks(wallet, token)).then(result => {
      if (!active || !current()) return;
      setStocks(result.stocks); setStocksLoading(false);
      setStocksError(result.incomplete ? 'Some stock holdings could not be loaded. Retry to refresh the list.' : undefined);
    }).catch(() => {
      if (active && current()) { setStocksLoading(false); setStocksError('Unable to load your stock holdings. Try again.'); }
    });
    return () => { active = false; };
  }, [wallet, getAccessToken, stocksRevision]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let active = true;
    const current = walletSessionIsCurrent();
    void getAccessToken().then(token => recoverWithdrawal(wallet, token)).then(pending => {
      if (!active || !current()) return;
      if (pending) { setApproval(pending); setStage('pending'); }
      else setStage('edit');
    }).catch(() => {
      if (active && current()) { setStage('recovery-error'); setError('Unable to check previous withdrawals. Check again before sending another transfer.'); }
    });
    return () => { active = false; };
  }, [wallet, getAccessToken, recoveryRevision]);
  useEffect(() => {
    if (stage !== 'review') return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [stage]);

  async function acceptStatus(result: TradeApproval) {
    if (result.kind !== 'withdrawal' || result.wallet !== wallet) throw new Error('Withdrawal does not match your wallet.');
    setApproval(result);
    if (result.status === 'confirmed' || result.status === 'failed') {
      forgetApproval(result.id);
      setStage(result.status);
      if (result.status === 'confirmed') {
        setStocksLoading(true); setStocksRevision(value => value + 1);
        void refresh().catch(() => { /* Confirmation remains valid if the portfolio refresh is unavailable. */ });
      }
    } else setStage('pending');
  }

  // Poll only the existing approval. A lost response must never create a new transfer.
  useEffect(() => {
    if (stage !== 'pending' || !approval?.id) return;
    let stopped = false;
    const current = walletSessionIsCurrent();
    let timer: ReturnType<typeof setTimeout>;
    let attempts = 0;
    async function poll() {
      try {
        const token = await getAccessToken();
        if (stopped || !current()) return;
        const result = await getServerApproval(approval!.id, token);
        if (stopped || !current()) return;
        if (result.status === 'confirmed' || result.status === 'failed') {
          await acceptStatus(result); return;
        }
        setApproval(result);
      } catch { /* Keep the pending state when confirmation is unavailable. */ }
      if (!stopped && current() && ++attempts < 30) timer = setTimeout(() => void poll(), 2000);
    }
    timer = setTimeout(() => void poll(), 2000);
    return () => { stopped = true; clearTimeout(timer); };
    // State changes above deliberately do not restart the polling budget.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, approval?.id, getAccessToken]);

  function edited() { requestId.current = undefined; setError(undefined); }
  async function prepare(event: React.FormEvent) {
    event.preventDefault();
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(undefined);
    const currentSession = walletSessionIsCurrent();
    const current = () => mounted.current && currentSession();
    try {
      requestId.current ??= crypto.randomUUID();
      const token = await getAccessToken();
      if (!current()) return;
      if (asset !== 'USDC' && asset !== 'SOL' && !stock) throw new Error('Choose a stock from your holdings.');
      const kind = stock ? 'STOCK' : asset as 'USDC' | 'SOL';
      const result = await prepareWithdrawal({ wallet, recipient: recipient.trim(), amount: amount.trim(), asset: kind, ...(stock ? { mint: stock.mint } : {}), requestId: requestId.current }, token);
      if (!current()) return;
      if (result.wallet !== wallet || result.kind !== 'withdrawal' || result.details.asset !== kind || result.details.mint !== stock?.mint || result.details.recipient !== recipient.trim()) throw new Error('Withdrawal review does not match your request.');
      setApproval(result); setChecked(false); setNow(Date.now());
      if (result.status === 'prepared') setStage('review');
      else await acceptStatus(result);
    } catch (cause) { if (current()) setError(cause instanceof Error ? cause.message : 'Unable to prepare withdrawal.'); }
    finally { lock.current = false; if (current()) setBusy(false); }
  }

  async function submit(checkOnly = false, retrySame = false) {
    if (!approval || lock.current) return;
    lock.current = true; setBusy(true); setError(undefined);
    const currentSession = walletSessionIsCurrent();
    const current = () => mounted.current && currentSession();
    let submissionStarted = false;
    try {
      const token = await getAccessToken();
      if (!current()) return;
      if (checkOnly) {
        let result = await getServerApproval(approval.id, token);
        if (!current()) return;
        if (retrySame && result.status === 'signed') {
          submissionStarted = true;
          result = await approveServerTrade(approval.id, token, wallet);
        }
        if (current()) await acceptStatus(result);
        return;
      }
      if (!checked || Date.parse(approval.expiresAt) <= Date.now()) throw new Error('Review a fresh withdrawal before confirming.');
      const signature = await authorizeTrade(approval.id, token);
      if (!current()) return;
      submissionStarted = true;
      const result = await approveServerTrade(approval.id, token, wallet, signature);
      if (current()) await acceptStatus(result);
    } catch (cause) {
      if (!current()) return;
      const rejected = !submissionStarted || cause instanceof ApiError && ([400, 401, 403, 404].includes(cause.status) || (cause.details as { code?: string })?.code === 'PRIVY_SIGNING_FAILED');
      if (submissionStarted && !rejected) {
        setStage('pending'); setError('Submission status is uncertain. Check this withdrawal before sending again.');
      } else {
        if (submissionStarted) forgetApproval(approval.id);
        setError(cause instanceof Error ? cause.message : 'Unable to approve withdrawal.');
      }
    } finally { lock.current = false; if (current()) setBusy(false); }
  }

  const expired = approval ? Date.parse(approval.expiresAt) <= now : false;
  const inputClass = 'mt-2 w-full rounded-xl border border-border bg-background px-3 py-3 text-sm outline-offset-2';
  return <div className="mt-6">
    {stage === 'loading' ? <p className="text-sm text-muted" role="status">Checking pending withdrawals…</p> : stage === 'recovery-error' ? <Button className="w-full" onClick={() => { setStage('loading'); setError(undefined); setRecoveryRevision(value => value + 1); }}>Check pending withdrawals</Button> : stage === 'edit' ? <form onSubmit={event => void prepare(event)} className="space-y-5">
      <label className="block text-sm font-medium">Asset<select className={inputClass} disabled={busy} value={asset} onChange={event => { edited(); setAsset(event.target.value); setAmount(''); }}><optgroup label="Cash"><option value="USDC">USDC</option><option value="SOL">SOL</option></optgroup>{stocks.length > 0 ? <optgroup label="Your stocks">{stocks.map(item => <option key={item.mint} value={item.mint}>{item.symbol} · {item.name}{item.issuer ? ` · ${item.issuer}` : ''} · {item.mint.slice(0, 4)}…{item.mint.slice(-4)}</option>)}</optgroup> : null}</select></label>
      <p className="text-xs text-muted" role="status">{stock ? `Available: ${stock.balance} ${stock.symbol}` : snapshot ? `Available: ${asset === 'USDC' ? snapshot.usdc : snapshot.sol} ${asset}` : balanceError || 'Loading balance…'}</p>
      {stocksLoading ? <p className="text-xs text-muted" role="status">Loading your stocks…</p> : stocksError ? <div className="text-xs text-muted" role="status"><p>{stocksError}</p><button type="button" className="mt-1 underline" disabled={busy} onClick={() => { setStocksLoading(true); setStocksRevision(value => value + 1); }}>Retry stock balances</button></div> : stocks.length === 0 ? <p className="text-xs text-muted">No unlocked stock tokens found in this wallet.</p> : null}
      <label className="block text-sm font-medium">Receiving wallet<input className={inputClass} disabled={busy} required autoComplete="off" autoCapitalize="none" spellCheck={false} minLength={32} maxLength={44} placeholder="Solana wallet address" value={recipient} onChange={event => { edited(); setRecipient(event.target.value); }} /></label>
      <label className="block text-sm font-medium">{stock ? 'Shares' : 'Amount'}<input className={inputClass} disabled={busy} required inputMode="decimal" autoComplete="off" maxLength={30} placeholder="0.00" value={amount} onChange={event => { edited(); setAmount(event.target.value); }} /></label>
      {stock ? <p className="text-xs leading-5 text-muted">Only unlocked shares in your wallet can be sent. The receiving wallet must support this exact {stock.symbol} token.</p> : null}
      <p className="text-xs leading-5 text-muted">Use a wallet that supports {symbol} on Solana. A small SOL balance covers network fees{asset !== 'SOL' ? ' and the receiving token account if needed' : ''}.</p>
      <Button className="w-full" variant="primary" disabled={busy} type="submit">{busy ? 'Preparing withdrawal…' : 'Review withdrawal'}</Button>
    </form> : approval ? <div className="space-y-5">
      <div className="rounded-2xl border border-border bg-background p-4">
        <p className="text-xs text-muted">{stage === 'confirmed' ? 'Sent' : 'You send'}</p><p className="mt-1 text-2xl font-semibold">{approval.details.amount} {approval.details.symbol ?? approval.details.asset}</p>
        {approval.details.requestedAmount && approval.details.requestedAmount !== approval.details.amount ? <p className="mt-2 text-xs leading-5 text-muted">Rounded down from {approval.details.requestedAmount} to the stock token’s available precision.</p> : null}
        <dl className="mt-4 space-y-3 text-sm">
          {approval.details.mint ? <><div><dt className="text-muted">Stock token{approval.details.issuer ? ` · ${approval.details.issuer}` : ''}</dt><dd className="mt-1 text-sm">{approval.details.name}</dd><dd className="mt-1 select-all break-all font-mono text-xs leading-5">{approval.details.mint}</dd></div></> : null}
          <div><dt className="text-muted">To</dt><dd className="mt-1 select-all break-all font-mono text-xs leading-5">{approval.details.recipient}</dd></div>
          <div><dt className="text-muted">From</dt><dd className="mt-1 break-all font-mono text-xs leading-5">{wallet}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-muted">Network</dt><dd>Solana</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-muted">Network fee</dt><dd>{solCost(approval.feeLamports)} SOL</dd></div>
          {approval.details.rentLamports !== '0' && approval.details.rentLamports ? <div className="flex justify-between gap-3"><dt className="text-muted">Receiving account cost</dt><dd>{solCost(approval.details.rentLamports)} SOL</dd></div> : null}
        </dl>
      </div>
      {stage === 'review' ? <>
        <label className="flex items-start gap-3 text-sm leading-6"><input className="mt-1" type="checkbox" checked={checked} disabled={busy} onChange={event => setChecked(event.target.checked)} />I checked the address and Solana network. Transfers cannot be reversed.</label>
        {expired ? <p role="status" className="text-sm text-muted">This review expired. Prepare a fresh withdrawal.</p> : null}
        <Button className="w-full" variant="primary" disabled={busy || !checked || expired} onClick={() => void submit()}>{busy ? 'Approving withdrawal…' : 'Confirm withdrawal'}</Button>
        <Button className="w-full" disabled={busy} onClick={() => { requestId.current = undefined; setApproval(undefined); setStage('edit'); setError(undefined); }}>Edit withdrawal</Button>
      </> : <>
        <p role="status" className="text-sm leading-6">{stage === 'confirmed' ? 'Withdrawal confirmed.' : stage === 'failed' ? 'This withdrawal failed or expired. No transfer completed. A network fee may still apply.' : approval.status === 'prepared' ? 'Your approval may still be processing. Keep checking until it completes or expires before sending again.' : 'Your withdrawal is awaiting confirmation. Check its status before sending again.'}</p>
        {approval.signature ? <a className="block text-sm underline" target="_blank" rel="noopener noreferrer" href={`https://solscan.io/tx/${encodeURIComponent(approval.signature)}`}>View transaction</a> : null}
        {stage === 'pending' ? <>
          <Button className="w-full" disabled={busy} onClick={() => void submit(true)}>{busy ? 'Checking…' : 'Check withdrawal status'}</Button>
          {approval.status === 'signed' ? <Button className="w-full" disabled={busy} onClick={() => void submit(true, true)}>Retry same submission</Button> : null}
        </> : <Button className="w-full" onClick={() => { requestId.current = undefined; setApproval(undefined); setAmount(''); setChecked(false); setError(undefined); setStage('edit'); }}>New withdrawal</Button>}
      </>}
    </div> : null}
    {error ? <p role="alert" className="mt-4 text-sm leading-6 text-red-700">{error}</p> : null}
  </div>;
}
