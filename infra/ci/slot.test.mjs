import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitFor(file) {
  const until=Date.now()+4000;
  while (!fs.existsSync(file) && Date.now()<until) await pause(25);
  assert.ok(fs.existsSync(file),'slot did not become ready');
}
test('distinct builder identities serialize through a worker-lifetime slot', {skip:process.platform==='win32',timeout:10000}, async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'oren-ci-slot-'));
  const children=[];
  const start=(command,args)=>{const child=spawn(command,args,{stdio:'ignore'});children.push(child);return child;};
  try {
    const first=start('sleep',['60']), second=start('sleep',['60']);
    const script=fileURLToPath(new URL('./hold-build-slot.sh',import.meta.url));
    const readyA=path.join(root,'a'), readyB=path.join(root,'b'), lock=path.join(root,'slot');
    start('bash',[script,String(first.pid),readyA,lock]);
    await waitFor(readyA);
    start('bash',[script,String(second.pid),readyB,lock]);
    await pause(200);
    assert.equal(fs.existsSync(readyB),false,'two builds held the slot at once');
    first.kill('SIGKILL');
    await waitFor(readyB);
  } finally {
    for (const child of children) child.kill('SIGKILL');
    fs.rmSync(root,{recursive:true,force:true});
  }
});
