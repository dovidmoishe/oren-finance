import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(`${process.cwd()}/package.json`);
for (const file of ['package.json', 'lib/db/migrate.mjs', 'lib/db/migrations/meta/_journal.json']) {
  fs.readFileSync(file);
}
for (const name of fs.readdirSync('lib/db/migrations')) {
  if (name.endsWith('.sql')) fs.readFileSync(`lib/db/migrations/${name}`);
}
require('postgres');
require('drizzle-orm/pg-core');
console.log('API migration sources and runtime dependencies are readable by the image default user');
