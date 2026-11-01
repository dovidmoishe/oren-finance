import { notFound } from 'next/navigation';
import { ProofSigner } from './proof-signer';

/** One-off proof route; remove it before merging PR #18. */
export default function Page() {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim();
  if (
    process.env.NEXT_PUBLIC_DEPLOYMENT_ENV !== 'preview' ||
    process.env.NEXT_PUBLIC_PREVIEW_PR_NUMBER !== '18' ||
    !appId
  ) notFound();
  return <ProofSigner appId={appId} />;
}
