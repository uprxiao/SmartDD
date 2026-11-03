import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const [directory]=process.argv.slice(2);
if(!directory?.startsWith('/private/tmp/willyou-m12-s1-'))throw Error('Private S1 directory required');
const raw=JSON.parse(await readFile(join(directory,'result.json'),'utf8'));
const stale=entry=>entry?.raw?.code===2&&entry.parsed?.error?.code==='BROWSER_STALE_REF'&&entry.parsed.error.effectState==='not-started';
const unchanged=(a,b)=>a?.url===b?.url&&a?.observed?.value==='recovery-preserved'&&b?.observed?.value==='recovery-preserved';
const checks={
  oldDaemonActuallyStopped:raw.killed?.state==='stopped'&&raw.killed.pid===raw.before?.a?.pid,
  oldRefAfterKillRejected:stale(raw.oldAfterKill),
  deathRebuiltAutomatically:raw.recovered?.state==='running'&&raw.recovered.pid!==raw.before?.a?.pid,
  noClickOrPageLossAfterDeath:raw.recovered?.observed?.hits?.length===0&&unchanged(raw.before?.a,raw.recovered),
  newSnapshotAfterDeath:raw.rebuiltSnapshot?.raw?.code===0&&raw.rebuiltSnapshot.parsed.data.refs.some(ref=>ref.available),
  threeTimeouts:raw.timeouts?.length===3&&raw.timeouts.every(row=>row.timeout.raw.code===2&&row.timeout.parsed.error.code==='BROWSER_TIMEOUT'&&row.timeout.parsed.error.effectState==='read-only'),
  thirdTimeoutRebuilds:raw.timeouts?.[2]?.state?.state==='running'&&raw.timeouts[2].state.pid!==raw.afterSnapshot?.a?.pid,
  timeoutInvalidatesRefs:stale(raw.oldAfterTimeouts),
  otherPageUnaffected:raw.before?.b?.pid===raw.after?.b?.pid&&raw.otherClick?.raw?.code===0&&raw.after?.b?.observed?.hits?.length===1,
  ordinaryCommandWorks:raw.finalClick?.raw?.code===0&&raw.after?.a?.observed?.hits?.length===1&&unchanged(raw.before?.a,raw.after?.a),
  cleanup:raw.hostExit?.code===0&&raw.cleanup?.helpers?.length===2&&raw.cleanup.helpers.every(helper=>helper.daemonState==='stopped'&&helper.clientStopped&&helper.socketFilesRemoved),
};
const verdict={at:new Date().toISOString(),case:'M12-T059',layer:'I',boundary:'real CLI/helper sessions; kernel-confirmed kill of owned private PID; three genuine native wait timeouts; no response stubs',checks,passed:!raw.failure&&Object.values(checks).every(Boolean)};
await writeFile(join(directory,'adjudication.json'),JSON.stringify(verdict,null,2)+'\n');console.log(JSON.stringify(verdict));
