import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { generateKeyPairSync, createPublicKey, createPrivateKey } from 'node:crypto';


/** Only used by a one-off provisioning container, never an API/gate runtime. */
export async function preparePolicyOwner(privy) {
  const file = '/state/policy-owner.json';
  let owner;
  if (existsSync(file)) owner = JSON.parse(readFileSync(file, 'utf8'));
  else {
    const key = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    owner = { privateKey: key.privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'), publicKey: key.publicKey.export({ type: 'spki', format: 'der' }).toString('base64') };
    writeFileSync(file, JSON.stringify(owner), { mode: 0o600, flag: 'wx' });
  }
  const save = () => writeFileSync(file, JSON.stringify(owner), { mode: 0o600 });
  const derived = createPublicKey(createPrivateKey({ key: Buffer.from(owner.privateKey, 'base64'), type: 'pkcs8', format: 'der' })).export({ type: 'spki', format: 'der' }).toString('base64');
  if (derived !== owner.publicKey || owner.publicKey === process.env.SIGNER_GATE_API_PUBLIC_KEY)
    throw new Error('Separate policy-owner key is inconsistent');
  if (!owner.quorumId) {
    for await (const q of privy.keyQuorums().list()) {
      if (q.authorization_threshold === 1 && q.authorization_keys?.length === 1 && q.authorization_keys[0].public_key === owner.publicKey) owner.quorumId = q.id;
    }
    if (!owner.quorumId) owner.quorumId = (await privy.keyQuorums().create({ authorization_threshold: 1, display_name: 'oren offline stock-policy owner', public_keys: [owner.publicKey] })).id;
    save();
  }
  if (owner.quorumId === process.env.SIGNER_GATE_QUORUM_ID) throw new Error('Trade signers cannot own the policy');
  const quorum = await privy.keyQuorums().get(owner.quorumId);
  if (quorum.authorization_threshold !== 1 || quorum.authorization_keys?.length !== 1 || quorum.authorization_keys[0].public_key !== owner.publicKey)
    throw new Error('Offline policy-owner quorum changed');
  return { ownerId: owner.quorumId };
}
