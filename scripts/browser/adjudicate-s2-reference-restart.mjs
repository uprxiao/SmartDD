import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const root=process.argv[2],bytes=await readFile(join(root,'result.json')),r=JSON.parse(bytes),a=r.phases.first,b=r.phases.second;
const epoch=ref=>/s(\d+)e\d+$/.exec(ref??'')?.[1];
const checks={sameEpoch:!!a?.savedRef&&epoch(a.savedRef)===epoch(b?.freshRef),differentReferenceScope:a?.savedRef!==b?.freshRef,twoSeparateHosts:!!a&&!!b&&a.hostPid!==b.hostPid&&a.ready.runId!==b.ready.runId,twoSeparatePages:!!a&&!!b&&a.pageId!==b.pageId,oldOwnerClosed:a?.hostExit?.code===0,foreignRefRejected:b?.oldClick?.raw.code===2&&b.oldClick.parsed?.error?.code==='BROWSER_STALE_REF'&&b.oldClick.parsed.error.effectState==='not-started',noDeliveryToNewNode:b?.afterOld?.hits.length===0,newReferenceUsable:b?.freshClick?.raw.code===0&&JSON.stringify(b?.afterFresh?.hits)==='["action"]',cleanup:[a,b].every(p=>p?.hostExit?.code===0&&p.cleanup?.helpers?.every(h=>['stopped','absent'].includes(h.daemonState)&&h.clientStopped&&h.socketFilesRemoved))};
const verdict={at:new Date().toISOString(),sourceSha256:createHash('sha256').update(bytes).digest('hex'),scope:'M12 R03.2/T051 cross-process page identity supplement',checks,oldRef:a?.savedRef,newRef:b?.freshRef,passed:!a?.failure&&!b?.failure&&Object.values(checks).every(Boolean)};await writeFile(join(root,'adjudication.json'),JSON.stringify(verdict,null,2)+'\n');console.log(JSON.stringify(verdict));if(!verdict.passed)process.exitCode=1;
