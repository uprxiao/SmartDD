import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const [directory]=process.argv.slice(2);
if(!directory?.startsWith('/private/tmp/willyou-m12-s1-'))throw Error('Private S1 directory required');
const raw=JSON.parse(await readFile(join(directory,'result.json'),'utf8'));
const methods=['Target.createTarget','Target.attachToTarget','Target.setDiscoverTargets','Browser.close'];
const checks={
 singlePageDiscovery:raw.listA?.length===1&&raw.listB?.length===1&&raw.listA[0].id!==raw.listB[0].id,
 allFourMethodsDenied:raw.denials?.length===4&&raw.denials.every((row,index)=>row.request.method===methods[index]&&row.response.error?.code===-32000&&!row.response.result),
 foreignTargetIsReal:raw.denials?.[1]?.request.params.targetId===raw.listB?.[0]?.id,
 zeroForwarding:raw.before?.forwarded?.length===0&&raw.after?.forwarded?.length===0,
 parkedThroughout:raw.before?.parked===true&&raw.after?.parked===true,
 hostUnchanged:JSON.stringify(raw.before?.host)===JSON.stringify(raw.after?.host)&&raw.after?.host?.destroyed===false,
 pagesUnchanged:raw.before?.pages?.length===2&&JSON.stringify(raw.before.pages)===JSON.stringify(raw.after?.pages)&&raw.after.pages.every(page=>!page.destroyed),
 nativeHelperStillWorks:raw.control?.raw?.code===0&&raw.effectA?.hits?.length===1&&raw.effectB?.hits?.length===0,
 socketsClosed:raw.clientSocketsClosed===true,
 cleanup:raw.hostExit?.code===0&&raw.cleanup?.helpers?.length===2&&raw.cleanup.helpers.every(helper=>helper.daemonState==='stopped'&&helper.clientStopped&&helper.socketFilesRemoved),
};
const verdict={at:new Date().toISOString(),case:'M12-T112',layer:'I',boundary:'actual parked pages/proxy/helper/CLI; read-only debugger forwarding observer; no denial stubs; direct-page patched helper uses the same strict endpoint',checks,passed:!raw.failure&&Object.values(checks).every(Boolean)};
await writeFile(join(directory,'adjudication.json'),JSON.stringify(verdict,null,2)+'\n');console.log(JSON.stringify(verdict));
