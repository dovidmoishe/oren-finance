import { config } from 'dotenv';
import { PrivyClient } from '@privy-io/node';
import { fileURLToPath } from 'node:url';

config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });

if (!process.env.PRIVY_APP_ID || !process.env.PRIVY_APP_SECRET)
  throw new Error('Privy app credentials are required');
const privy = new PrivyClient({
  appId: process.env.PRIVY_APP_ID,
  appSecret: process.env.PRIVY_APP_SECRET,
});
const quorums = [];
for await (const quorum of privy.keyQuorums().list()) {
  quorums.push({
    id: quorum.id,
    displayName: quorum.display_name,
    authorizationThreshold: quorum.authorization_threshold,
    keyCount: quorum.authorization_keys?.length ?? 0,
    nestedQuorumCount: quorum.key_quorum_ids?.length ?? 0,
    userCount: quorum.user_ids?.length ?? 0,
  });
}
console.log(JSON.stringify({ quorumCount: quorums.length, quorums }));
