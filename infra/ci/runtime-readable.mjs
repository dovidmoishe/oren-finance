import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(`${process.cwd()}/package.json`);
if (process.getuid() === 0) throw Error('API runtime must use an unprivileged default user');
for (const file of ['package.json', 'dist/src/main.js', 'lib/db/migrate.mjs', 'lib/db/migrations/meta/_journal.json']) {
  fs.readFileSync(file);
}
for (const name of fs.readdirSync('lib/db/migrations')) {
  if (name.endsWith('.sql')) fs.readFileSync(`lib/db/migrations/${name}`);
}
require('postgres');
require('drizzle-orm/pg-core');
console.log('API migration sources and runtime dependencies are readable by the image default user');
