import { config } from 'dotenv';
import { Connection, PublicKey } from '@solana/web3.js';
import { inflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });

const programId = new PublicKey(
  process.env.PROOF_PROGRAM_ID ?? 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
);
if (!process.env.ALCHEMY_API_KEY)
  throw new Error('ALCHEMY_API_KEY is required for a read-only account lookup');

const [programSigner] = PublicKey.findProgramAddressSync([], programId);
const idlAddress = await PublicKey.createWithSeed(
  programSigner,
  'anchor:idl',
  programId,
);
const rpc = new Connection(
  `https://solana-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
  'confirmed',
);
const account = await rpc.getAccountInfo(idlAddress);
if (!account) {
  console.log(JSON.stringify({ programId: programId.toBase58(), idlAddress: idlAddress.toBase58(), found: false }));
  process.exit(0);
}
if (account.data.length < 44) throw new Error('On-chain IDL account is too short');
const length = account.data.readUInt32LE(40);
const compressed = account.data.subarray(44, 44 + length);
if (compressed.length !== length) throw new Error('On-chain IDL length is invalid');
const idl = JSON.parse(inflateSync(compressed).toString('utf8'));
const sharedRoute = idl.instructions?.find(
  (instruction) => instruction.name === 'shared_accounts_route',
);
let policyIdlCandidate;
if (sharedRoute) {
  const typesByName = new Map(idl.types?.map((type) => [type.name, type]));
  const requiredTypes = new Map();
  function collectTypes(value) {
    if (!value || typeof value !== 'object') return;
    if (value.defined) {
      const name = typeof value.defined === 'string' ? value.defined : value.defined.name;
      if (!requiredTypes.has(name)) {
        const definition = typesByName.get(name);
        if (!definition) throw new Error(`Missing IDL type: ${name}`);
        requiredTypes.set(name, definition);
        collectTypes(definition);
      }
    }
    for (const nested of Object.values(value)) collectTypes(nested);
  }
  collectTypes(sharedRoute.args);
  const candidate = {
    address: programId.toBase58(),
    metadata: {
      name: idl.metadata?.name ?? 'jupiter',
      version: idl.metadata?.version ?? '0.1.0',
      spec: '0.1.0',
    },
    instructions: [{
      ...sharedRoute,
      accounts: sharedRoute.accounts.map((account) => ({
        name: account.name,
        writable: account.writable ?? account.isMut ?? false,
        signer: account.signer ?? account.isSigner ?? false,
      })),
    }],
    types: [...requiredTypes.values()],
  };
  policyIdlCandidate = {
    instruction: sharedRoute.name,
    discriminatorHex: Buffer.from(sharedRoute.discriminator).toString('hex'),
    bytes: Buffer.byteLength(JSON.stringify(candidate)),
    typeNames: [...requiredTypes.keys()],
  };
}
console.log(
  JSON.stringify({
    programId: programId.toBase58(),
    idlAddress: idlAddress.toBase58(),
    found: true,
    instructionCount: idl.instructions?.length,
    policyIdlCandidate,
    ...(process.env.PROOF_SHOW_TYPES === 'true'
      ? {
          routeTypes: idl.types?.filter((type) =>
            ['RoutePlanStep', 'RoutePlanStepV2', 'Swap', 'Side'].includes(type.name),
          ),
        }
      : {}),
    routes: idl.instructions
      ?.filter((instruction) => /route/i.test(instruction.name))
      .map((instruction) => ({
        name: instruction.name,
        discriminator: instruction.discriminator,
        accounts: instruction.accounts?.map((account) => account.name),
        args: instruction.args?.map((arg) => ({ name: arg.name, type: arg.type })),
      })),
  }),
);
