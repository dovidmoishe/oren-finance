import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const linux = process.platform === 'linux';
const sha = 'a'.repeat(40);
function fixture(t, options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'oren-controller-test-'));
  t.after(() => rmSync(dir, {recursive:true,force:true}));
  const root = join(dir,'preview'), bin = join(dir,'bin');
  for(const p of ['control','stacks','sites']) mkdirSync(join(root,p),{recursive:true});
  mkdirSync(bin);
  const script = readFileSync(new URL('./manage.sh',import.meta.url),'utf8').replace('ROOT=/opt/oren/preview',`ROOT='${root}'`);
  writeFileSync(join(dir,'manage.sh'),script);
  writeFileSync(join(root,'domain'),'preview.example.com\n');
  writeFileSync(join(root,'privy-origins'),'pr-42.preview.example.com\n');
  writeFileSync(join(root,'provider.env'),'PRIVY_APP_ID=preview-id\n');
  const executable = (name, body) => writeFileSync(join(bin,name),'#!/usr/bin/env bash\nset -euo pipefail\n'+body,{mode:0o755});
  executable('docker',`printf '%s\\n' "$*" >> "$TEST_LOG"
case "$*" in
  login*) cat >/dev/null ;;
  *' run --rm migrate'*) [[ "\${FAIL_MIGRATION:-0}" != 1 ]] ;;
  *' pull'*) [[ "\${FAIL_PULL:-0}" != 1 ]] ;;
  *'--entrypoint node'*) echo '{"keys":[{"kty":"RSA"}]}' ;;
  *'node --input-type=module'*) echo signed-cookie ;;
esac
`);
  executable('curl',`if [[ "$*" == *api.github.com* ]]; then
 n=0; [[ ! -f "$TEST_COUNTER" ]] || n=$(cat "$TEST_COUNTER"); n=$((n+1)); echo "$n" > "$TEST_COUNTER"
 head=${sha}; if [[ "\${SUPERSEDE:-0}" == 1 && "$n" -ge 3 ]]; then head=${'b'.repeat(40)}; fi
 printf '{"state":"open","base":{"ref":"master"},"head":{"sha":"%s","repo":{"full_name":"owner/repo"}},"user":{"type":"User"}}' "$head"
elif [[ "$*" == *--write-out* ]]; then echo 302
elif [[ "$*" == *api/environment* ]]; then echo '{"environment":"preview","commitSha":"${sha}","prNumber":42,"financialExecution":false,"backgroundWorkers":false}'
elif [[ "$*" == *oauth-protected-resource/mcp* ]]; then echo '{"resource":"https://pr-42.preview.example.com/mcp"}'
elif [[ "$*" == *openid-configuration* ]]; then echo '{"issuer":"https://pr-42.preview.example.com/oauth","registration_endpoint":"https://pr-42.preview.example.com/oauth/reg"}'
fi
`);
  executable('awk',`if [[ "$*" == *MemAvailable* ]]; then echo "\${AVAILABLE_KIB:-8388608}"; else cat >/dev/null; echo 33554432; fi\n`);
  const env = {...process.env,PATH:bin+':'+process.env.PATH,TEST_LOG:join(dir,'docker.log'),TEST_COUNTER:join(dir,'counter'),...options};
  const stack = join(root,'stacks','pr-42'), site = join(root,'sites','pr-42.caddy');
  const existing = () => {
    mkdirSync(stack,{recursive:true});
    writeFileSync(join(stack,'release.env'),`COMMIT_SHA=${'c'.repeat(40)}\nDB_PASSWORD=${'d'.repeat(48)}\n`);
    writeFileSync(site,'old protected preview route');
  };
  const run = (action='deploy', extra=[]) => spawnSync('bash',[join(dir,'manage.sh'),action,'42',...(action==='deploy'?[sha,'owner','repo','preview-id']:extra)],{env,input:'test-token\n',encoding:'utf8'});
  return {root,stack,site,existing,run,log:()=>existsSync(env.TEST_LOG)?readFileSync(env.TEST_LOG,'utf8'):''};
}
test('controller allocates exact preview project and records verified commit', {skip:!linux}, t=>{
  const f=fixture(t), result=f.run();assert.equal(result.status,0,result.stderr);
  assert.equal(JSON.parse(readFileSync(join(f.stack,'state.json'),'utf8')).sha,sha);
  assert.match(readFileSync(f.site,'utf8'),/forward_auth preview-access:8080/);
  assert.match(readFileSync(f.site,'utf8'),/\.well-known\/oauth-protected-resource\/mcp/);
  assert.match(readFileSync(join(f.stack,'oauth.env'),'utf8'),/MCP_OAUTH_JWKS=/);
  assert.match(f.log(),/--project-name oren-pr-42/);assert.ok(!f.log().includes('prune'));
});
test('preview OAuth issuer keys persist across updates and disappear on stop', {skip:!linux}, t=>{
  const f=fixture(t);
  assert.equal(f.run().status,0);
  const first=readFileSync(join(f.stack,'oauth.env'),'utf8');
  assert.equal(f.run().status,0);
  assert.equal(readFileSync(join(f.stack,'oauth.env'),'utf8'),first);
  assert.equal(f.run('stop').status,0);
  assert.equal(existsSync(join(f.stack,'oauth.env')),false);
});
test('controller accepts quoted shared Privy app IDs', {skip:!linux}, t=>{
  const f=fixture(t);
  for (const quote of ['"', "'"]) {
    writeFileSync(join(f.root,'provider.env'),`PRIVY_APP_ID=${quote}preview-id${quote}\n`);
    const result=f.run();assert.equal(result.status,0,result.stderr);
  }
});
test('failed migration removes routing without deleting preview data', {skip:!linux},t=>{
  const f=fixture(t,{FAIL_MIGRATION:'1'});f.existing();const result=f.run();
  assert.notEqual(result.status,0);assert.equal(existsSync(f.site),false);
  assert.equal(existsSync(join(f.stack,'release.env')),true);assert.ok(!f.log().includes('down --volumes'));
});
test('failed pull preserves previously healthy routing', {skip:!linux},t=>{
  const f=fixture(t,{FAIL_PULL:'1'});f.existing();assert.notEqual(f.run().status,0);assert.equal(existsSync(f.site),true);
});
test('superseded commit never activates a route', {skip:!linux},t=>{
  const f=fixture(t,{SUPERSEDE:'1'});assert.notEqual(f.run().status,0);assert.equal(existsSync(f.site),false);
});
test('capacity rejection creates no new stack', {skip:!linux},t=>{
  const f=fixture(t,{AVAILABLE_KIB:'1000'});assert.notEqual(f.run().status,0);assert.equal(existsSync(f.stack),false);
  for(const n of [1,2,3]){const p=join(f.root,'stacks',`pr-${n}`);mkdirSync(p);writeFileSync(join(p,'release.env'),'');}
  assert.match(f.run().stderr,/Three preview slots/);
});
test('incorrect reset confirmation is inert; stop is repeatable and narrowly scoped', {skip:!linux},t=>{
  const f=fixture(t);f.existing();assert.notEqual(f.run('reset',['wrong']).status,0);
  assert.equal(existsSync(f.site),true);assert.equal(f.log(),'');
  const stopped=f.run('stop');assert.equal(stopped.status,0,stopped.stderr);assert.match(stopped.stdout,/PREVIEW_REMOVED 42/);
  assert.equal(f.run('stop').status,0);assert.match(f.log(),/--project-name oren-pr-42/);assert.ok(!f.log().includes('oren-db'));
});
