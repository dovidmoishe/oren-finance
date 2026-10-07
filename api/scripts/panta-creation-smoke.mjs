import 'dotenv/config';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { validateEnv } = require('../dist/src/config/env.schema.js');
const {
  CreationTransactionService,
} = require('../dist/src/predictions/creation/creation-transaction.service.js');
try {
  const env = validateEnv();
  if (!env.PANTA_API_BASE_URL || !env.PANTA_API_KEY) {
    console.log('Creation access smoke skipped: Panta URL/key absent.');
    process.exit(0);
  }
  const response = await fetch(`${env.PANTA_API_BASE_URL}/whoami/`, {
    headers: { 'X-Api-Key': env.PANTA_API_KEY },
    signal: AbortSignal.timeout(8000),
    redirect: 'error',
  });
  if (!response.ok) {
    console.log(
      JSON.stringify({ status: 'blocked', accessHttpStatus: response.status }),
    );
    process.exitCode = 1;
  } else {
    const body = await response.json();
    const permissions = body.permissions ?? body;
    const verification = new CreationTransactionService(env);
    console.log(
      JSON.stringify(
        {
          status: 'access_verified',
          canCreateMarkets:
            permissions.canCreateMarkets ?? body.canCreateMarkets ?? null,
          publicationBlockers: verification.blockers(),
          unsignedBuildSmoke:
            'skipped: requires an explicitly reviewed draft and verified deployment manifest',
          signedPublicationSmoke:
            'pending: requires human wallet review and signature',
        },
        null,
        2,
      ),
    );
    if (!verification.blockers().length) {
      await verification.network();
      console.log(
        'Configured genesis, deployment and USDC mint verified read-only.',
      );
    }
  }
} catch {
  console.error('Creation access/network smoke failed (sanitized).');
  process.exitCode = 1;
}
