import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const [directory]=process.argv.slice(2);
if(!directory?.startsWith('/private/tmp/willyou-m12-s1-'))throw Error('Private S1 directory required');
const raw=JSON.parse(await readFile(join(directory,'result.json'),'utf8'));
let records;try{records=JSON.parse(raw.contract?.raw?.stdout??'null');}catch{}
const text=Array.isArray(records)?records[0]?.error:null;
const checks={
  originallyValidRef:raw.validSnapshot?.parsed?.data?.refs?.some(ref=>ref.ref.endsWith(raw.nativeRef?.slice(1))&&ref.role==='button'&&ref.name==='Action'&&ref.available),
  invalidatedBySnapshot:raw.emptySnapshot?.raw?.code===0&&raw.emptySnapshot?.parsed?.data?.refs?.length===0,
  rawFailureSaved:Array.isArray(records)&&records.length===1&&records[0].success===false&&typeof text==='string',
  exactVersionErrorContract:typeof text==='string'&&/unknown ref|ref not found|element not found: @e/i.test(text),
  hostMapsStale:raw.contract?.mapped?.code==='BROWSER_STALE_REF',
  pinnedVersion:raw.contract?.version==='0.27.3'&&raw.contract?.pinnedSha256==='589edd78eaec9dcadcd9fb9a4ca080cb1ae5a27a99e02c531fdb7c68e7083723'&&raw.contract.pinnedSha256===raw.contract.actualSha256,
  noClick:raw.observed?.hits?.length===0&&!raw.contract?.raw?.timedOut&&raw.contract?.raw?.signal===null,
  cleanup:raw.hostExit?.code===0&&raw.cleanup?.helpers?.length===1&&raw.cleanup.helpers.every(helper=>helper.daemonState==='stopped'&&helper.clientStopped&&helper.socketFilesRemoved),
};
const verdict={at:new Date().toISOString(),case:'M12-T052',layer:'I',boundary:'fixed official arm64 binary, real page/session and raw batch stdout; host mapping invoked separately; no mocked errors',rawError:text,checks,passed:!raw.failure&&Object.values(checks).every(Boolean)};
await writeFile(join(directory,'adjudication.json'),JSON.stringify(verdict,null,2)+'\n');console.log(JSON.stringify(verdict));
