import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const [directory]=process.argv.slice(2);
if(!directory?.startsWith('/private/tmp/willyou-m12-s1-'))throw Error('Private S1 directory required');
const raw=JSON.parse(await readFile(join(directory,'result.json'),'utf8'));
const snapshot=raw.snapshot?.parsed?.data,locations=raw.locations??[];
const frame=locations.find(row=>row.kind==='frame'),shadow=locations.find(row=>row.kind==='shadow');
const mainUrl=snapshot?.url?new URL(snapshot.url):null;
const oopif=raw.before?.sessions?.find(session=>session.type==='iframe'&&typeof session.id==='string');
const frameOrigin=raw.before?.state?.frame?.origin?new URL(raw.before.state.frame.origin):null;
const successfulFill=row=>!row?.missingRefs&&row?.fill?.raw.code===0&&row.afterFill?.state?.[row.kind]?.value===row.input;
const successfulClick=row=>!row?.missingRefs&&row?.click?.raw.code===0&&row.afterClick?.state?.[row.kind]?.hits===1;
const checks={
  trueCrossSiteOopif:mainUrl?.hostname==='127.0.0.1'&&typeof oopif?.id==='string'&&frameOrigin?.hostname==='localhost'&&frameOrigin.port===mainUrl.port,
  closedRoot:raw.before?.state?.closed===true,
  allExpectedRefs:[['textbox','Frame input'],['button','Frame action'],['textbox','Shadow input'],['button','Shadow action']].every(([role,name])=>snapshot?.refs?.some(ref=>ref.role===role&&ref.name===name&&ref.available===true)),
  frameFill:successfulFill(frame),frameClick:successfulClick(frame),shadowFill:successfulFill(shadow),shadowClick:successfulClick(shadow),
  frameOwnEcho:typeof frame?.afterFill?.state?.frameEcho==='string'&&frame.afterFill.state.frameEcho.includes(frame.input),
  shadowOwnEcho:typeof shadow?.afterFill?.state?.shadowEcho==='string'&&shadow.afterFill.state.shadowEcho.includes(shadow.input),
  cleanup:raw.hostExit?.code===0&&raw.cleanup?.helpers?.length===1&&raw.cleanup.helpers.every(helper=>helper.daemonState==='stopped'&&helper.clientStopped&&helper.socketFilesRemoved),
};
const verdict={at:new Date().toISOString(),case:'M12-T053',layer:'I',boundary:'true cross-site OOPIF and actual closed shadow, real CLI/service/proxy/helper; page event echo, no direct value assignments',checks,passed:!raw.failure&&Object.values(checks).every(Boolean)};
await writeFile(join(directory,'adjudication.json'),JSON.stringify(verdict,null,2)+'\n');console.log(JSON.stringify(verdict));
