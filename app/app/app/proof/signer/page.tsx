import { notFound } from 'next/navigation';
import { ProofSigner } from './proof-signer';

/** Disposable-wallet proof page; remove this route before PR #18 is merged. */
export default function Page() {
  if (
    process.env.NEXT_PUBLIC_DEPLOYMENT_ENV !== 'preview' ||
    process.env.NEXT_PUBLIC_PREVIEW_PR_NUMBER !== '18'
  ) notFound();
  return <ProofSigner />;
}
