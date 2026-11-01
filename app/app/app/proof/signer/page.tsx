import { notFound, redirect } from 'next/navigation';

/** Keep the original proof URL working while the disposable test is in progress. */
export default function Page() {
  if (
    process.env.NEXT_PUBLIC_DEPLOYMENT_ENV !== 'preview' ||
    process.env.NEXT_PUBLIC_PREVIEW_PR_NUMBER !== '18'
  ) notFound();
  redirect('/proof/signer');
}
