'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Cancel01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useOrenAuth } from '@/components/auth/auth-context';
import { Button } from '@/components/ui';
import { listFeedback, submitFeedback } from '@/services/feedback-service';
import type { FeedbackKind, FeedbackTicket } from '@/types';
import { FEEDBACK_KIND_LABELS, FEEDBACK_MESSAGE_MAX, FEEDBACK_SUBJECT_MAX, feedbackError, ticketReference } from './feedback-rules';

const inputClass = 'w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-offset-2 focus-visible:outline-2';

export function FeedbackModal({ onClose }: { onClose: () => void }) {
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
  return <dialog ref={dialog} aria-labelledby="feedback-title" className="oren-deposit-modal m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-3xl border border-border bg-panel p-5 text-foreground shadow-2xl sm:p-6" onCancel={onClose} onClick={event => {
    if (event.target !== event.currentTarget) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
  }}>
    <div className="flex items-center justify-between gap-4"><h2 id="feedback-title" className="font-display text-xl font-semibold">Help &amp; feedback</h2><button aria-label="Close help and feedback" className="grid h-8 w-8 place-items-center rounded-full text-muted hover:bg-background" type="button" onClick={onClose}><HugeiconsIcon icon={Cancel01Icon} size={16} aria-hidden="true" /></button></div>
    <p className="mt-2 text-sm leading-6 text-muted">Tell us what works, what doesn&apos;t, or what you need help with. The team reads every message.</p>
    {!auth.ready ? <p className="mt-6 text-sm" role="status">Loading your account…</p>
      : !auth.authenticated ? <Button className="mt-6" onClick={auth.open}>Sign in to send feedback</Button>
      : !auth.address ? <p className="mt-6 text-sm" role="status">Your wallet is being prepared. Try again shortly.</p>
      : <FeedbackForm key={auth.address} wallet={auth.address} />}
  </dialog>;
}

function FeedbackForm({ wallet }: { wallet: string }) {
  const { getAccessToken } = useOrenAuth();
  const pathname = usePathname();
  const [kind, setKind] = useState<FeedbackKind>('feedback');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [sent, setSent] = useState<FeedbackTicket>();
  const [tickets, setTickets] = useState<FeedbackTicket[]>();

  useEffect(() => {
    let active = true;
    void getAccessToken().then(token => token ? listFeedback(wallet, token) : []).then(result => { if (active) setTickets(result); }).catch(() => { if (active) setTickets([]); });
    return () => { active = false; };
  }, [getAccessToken, wallet]);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    const problem = feedbackError(subject, message);
    if (problem) { setError(problem); return; }
    setBusy(true); setError(undefined);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error('Sign in again to send feedback.');
      const ticket = await submitFeedback({ kind, subject: subject.trim(), message: message.trim(), page: pathname || undefined }, wallet, token);
      setSent(ticket);
      setTickets(current => [ticket, ...(current ?? [])]);
      setSubject(''); setMessage('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to send. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return <div className="mt-6">
    {sent ? <div className="rounded-2xl border border-border bg-background p-4" role="status">
      <p className="text-sm font-semibold">Thanks, we got it.</p>
      <p className="mt-1 text-sm leading-6 text-muted">Your reference is {ticketReference(sent.id)}. We&apos;ll follow up by email if we need more detail.</p>
      <Button className="mt-4 w-full" onClick={() => setSent(undefined)}>Send another</Button>
    </div> : <form className="space-y-4" onSubmit={send} noValidate>
      <fieldset>
        <legend className="text-sm font-medium">What&apos;s this about?</legend>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {(Object.keys(FEEDBACK_KIND_LABELS) as FeedbackKind[]).map(option => <label key={option} className={`cursor-pointer rounded-xl border px-2 py-2 text-center text-xs font-medium ${kind === option ? 'border-foreground bg-background' : 'border-border'}`}>
            <input className="sr-only" type="radio" name="feedback-kind" value={option} checked={kind === option} onChange={() => setKind(option)} />
            {FEEDBACK_KIND_LABELS[option]}
          </label>)}
        </div>
      </fieldset>
      <label className="block text-sm font-medium">Subject<input className={`${inputClass} mt-2`} disabled={busy} maxLength={FEEDBACK_SUBJECT_MAX} value={subject} onChange={event => setSubject(event.target.value)} /></label>
      <label className="block text-sm font-medium">Message<textarea className={`${inputClass} mt-2 min-h-32 resize-y`} disabled={busy} maxLength={FEEDBACK_MESSAGE_MAX} value={message} onChange={event => setMessage(event.target.value)} placeholder={kind === 'bug' ? 'What happened, and what did you expect?' : undefined} /></label>
      <p className="text-xs leading-5 text-muted">Never include your seed phrase, private key, or passwords. Oren will never ask for them.</p>
      {error ? <p role="alert" className="text-sm leading-6 text-red-700">{error}</p> : null}
      <Button className="w-full" variant="primary" disabled={busy} type="submit">{busy ? 'Sending…' : 'Send'}</Button>
    </form>}
    <section className="mt-6 border-t border-border pt-4" aria-labelledby="feedback-history">
      <h3 id="feedback-history" className="text-sm font-semibold">Your requests</h3>
      {tickets === undefined ? <p className="mt-2 text-sm text-muted" role="status">Loading…</p>
        : tickets.length === 0 ? <p className="mt-2 text-sm text-muted">Nothing sent yet.</p>
        : <ul className="mt-2 divide-y divide-border">
          {tickets.map(ticket => <li key={ticket.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
            <div className="min-w-0"><p className="truncate font-medium">{ticket.subject}</p><p className="text-xs text-muted">{ticketReference(ticket.id)} · {new Date(ticket.createdAt).toLocaleDateString()}</p></div>
            <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${ticket.status === 'resolved' ? 'bg-green-50 text-green-800' : 'bg-background text-muted'}`}>{ticket.status === 'resolved' ? 'Resolved' : 'Open'}</span>
          </li>)}
        </ul>}
    </section>
  </div>;
}
