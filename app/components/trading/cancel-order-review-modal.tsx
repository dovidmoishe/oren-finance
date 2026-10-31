'use client';

import { financialExecutionEnabled } from "@/services/environment";
import { Button, Modal, Toast } from '@/components/ui';
import { useApprovalReview } from '@/hooks/use-approval-review';
import type { TradeFlowStatus } from '@/hooks/use-quote-execution';
export function CancelOrderReviewModal({ orderKey, status, error, onClose, onConfirm }: {
  orderKey: string; status: TradeFlowStatus; error?: string; onClose: () => void; onConfirm: (id: string) => Promise<void>;
}) {
  const review = useApprovalReview('cancel', orderKey, true);
  const busy = ['signing', 'preparing', 'confirming', 'submitted'].includes(status);
  return <Modal open title="Cancel limit order" onClose={busy ? () => undefined : onClose}>
    <p className="text-sm">Cancel this open limit order? Filled amounts cannot be reversed.</p>
    <p className="my-3 break-all font-mono text-xs text-muted">{orderKey}</p>
    <p className="mb-4 text-sm">Estimated network fee: {review.approval ? `${Number(review.approval.feeLamports) / 1e9} SOL` : 'Preparing…'}</p>
    {review.error || error ? <Toast tone="error" title="Cancellation update" description={review.error || error} /> : null}
    <Button className="mt-4 w-full" disabled={!financialExecutionEnabled || !review.approval || review.approval.status !== 'prepared' || review.expired || busy || status === 'confirmed'} onClick={() => review.approval && void onConfirm(review.approval.id)}>
      {status === 'confirmed' ? 'Cancelled' : busy ? 'Confirming cancellation…' : 'Confirm cancellation'}
    </Button>
  </Modal>;
}
