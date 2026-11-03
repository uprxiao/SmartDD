import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const [directory] = process.argv.slice(2);
if (!directory?.startsWith('/private/tmp/willyou-m12-s1-')) throw Error('Private S1 evidence directory required');
const raw = JSON.parse(await readFile(join(directory,'result.json'),'utf8'));
const control = raw.boundControl, clone = raw.boundClone;
const checks = {
  rawSequenceComplete: !raw.failure && raw.steps?.length === 4,
  controlGuardClear: control?.action?.guard?.connected === true && control.action.guard.blocked.length === 0,
  controlClickObserved: JSON.stringify(control?.observed?.state?.hits) === '["action"]',
  controlPageCaptureObserved: JSON.stringify(control?.observed?.state?.windowHits) === '["action"]',
  cloneGuardBlocked: clone?.action?.guard?.connected === false && clone.action.guard.accepted.length === 0 && clone.action.guard.blocked.includes('click'),
  cloneClickAbsent: clone?.observed?.state?.hits?.length === 0,
  cloneEarlierPageCaptureAbsent: clone?.observed?.state?.windowHits?.length === 0,
  controlFillObserved:raw.boundControlFill?.observed?.state?.value==='new-value'&&raw.boundControlFill?.action?.guard?.blocked?.length===0,
  cloneFillUnchanged:raw.boundCloneFill?.observed?.state?.value==='preserve',
  cloneFillRejected:raw.boundCloneFill?.action?.guard?.connected===false&&raw.boundCloneFill.action.guard.accepted.length===0&&(raw.boundCloneFill.action.error?.code==='BROWSER_STALE_REF'||raw.boundCloneFill.action.guard.blocked.length>0),
  helperStopped: raw.cleanup?.helperCleanup?.daemonState === 'stopped' && raw.cleanup.helperCleanup.clientStopped === true,
  socketFilesRemoved: raw.cleanup?.helperCleanup?.socketFilesRemoved === true,
  hostExited: raw.hostExit?.code === 0 && raw.hostExit.signal === null,
};
const adjudication = { at:new Date().toISOString(), boundary:'I preflight only: real production proxy/helper and synthetic page; not a complete formal case', checks, passed:Object.values(checks).every(Boolean) };
await writeFile(join(directory,'adjudication.json'),JSON.stringify(adjudication,null,2)+'\n');
console.log(JSON.stringify(adjudication));
