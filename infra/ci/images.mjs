import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const DIGEST = /^sha256:[a-f0-9]{64}$/;
export function builtImages(owner, api, app) {
  if (typeof owner !== 'string' || !/^[a-z0-9-]+$/.test(owner) || !DIGEST.test(api ?? '') || !DIGEST.test(app ?? '')) {
    throw Error('Production requires the exact digests returned by trusted builds');
  }
  return {OREN_API_IMAGE:`ghcr.io/${owner}/oren-api@${api}`, OREN_APP_IMAGE:`ghcr.io/${owner}/oren-app@${app}`};
}
export function recordedImages(owner, text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length !== 2) throw Error('Invalid verified deployment record');
  const values = Object.fromEntries(lines.map(line => {
    const index = line.indexOf('=');
    if (index < 1) throw Error('Invalid verified deployment record');
    return [line.slice(0,index),line.slice(index+1)];
  }));
  const apiPrefix=`ghcr.io/${owner}/oren-api@`, appPrefix=`ghcr.io/${owner}/oren-app@`;
  if (!values.OREN_API_IMAGE?.startsWith(apiPrefix) || !values.OREN_APP_IMAGE?.startsWith(appPrefix)) throw Error('Unexpected image repository');
  return builtImages(owner, values.OREN_API_IMAGE.slice(apiPrefix.length), values.OREN_APP_IMAGE.slice(appPrefix.length));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [, , owner, api, app] = process.argv;
    const images=api==='--record'?recordedImages(owner,readFileSync(0,'utf8')):builtImages(owner,api,app);
    for (const [key,value] of Object.entries(images)) console.log(`${key}=${value}`);
  } catch (error) { console.error(error.message); process.exitCode=1; }
}
