import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const [directory]=process.argv.slice(2);
if(!directory?.startsWith('/private/tmp/willyou-m12-s1-'))throw Error('Private S1 directory required');
const raw=JSON.parse(await readFile(join(directory,'result.json'),'utf8'));
const observations=(raw.races??[]).map(row=>{
  const error=row.action?.parsed?.error,prepared=row.point==='pre-input'&&row.target==='textbox';
  // pre-input injection is an additional execution-phase probe: focus/selection has already
  // run. R02.9 permits conservative unknown here. Formal before-arm/post-arm cases require 2.
  const failureState=prepared
    ? (row.action.raw.code===2&&error?.effectState==='not-started'||row.action.raw.code===5&&error?.effectState==='unknown')
    : row.action.raw.code===2&&error?.effectState==='not-started';
  return {kind:row.kind,target:row.target,point:row.point,mode:row.mode,checks:{
    stale:error?.code==='BROWSER_STALE_REF',failureState,
    zeroClicks:row.before?.state?.[row.kind]?.hits===0&&row.after?.state?.[row.kind]?.hits===0,
    clonePreserved:row.target!=='textbox'||row.mutation?.before?.value===row.expected&&row.mutation?.after?.value===row.expected&&row.after?.state?.[row.kind]?.value===row.expected,
    trueFrame:row.kind!=='frame'||row.before?.sessions?.some(session=>session.type==='iframe')&&new URL(row.before.state.frame.origin).hostname==='localhost',
    closedRoot:row.kind!=='shadow'||row.before?.state?.closed===true,
    sentInputBlocked:row.point!=='pre-input'||!(row.guard?.result?.value?.accepted??[]).some(kind=>['beforeinput','input','click'].includes(kind)),
  }};
});
const expected=new Set();for(const kind of ['frame','shadow']){for(const target of ['button','textbox'])for(const point of ['before-arm','post-arm','pre-input'])expected.add([kind,target,point,'clone'].join('/'));expected.add([kind,'button','post-arm','fresh'].join('/'));}
const seen=new Set(observations.map(row=>[row.kind,row.target,row.point,row.mode].join('/')));
const checks={allFourteenCases:expected.size===seen.size&&[...expected].every(key=>seen.has(key))&&observations.length===14,allCases:observations.every(row=>Object.values(row.checks).every(Boolean)),cleanup:raw.hostExit?.code===0&&raw.cleanup?.helpers?.length===1&&raw.cleanup.helpers.every(helper=>helper.daemonState==='stopped'&&helper.clientStopped&&helper.socketFilesRemoved)};
const verdict={at:new Date().toISOString(),case:'M12-T051',layer:'I',boundary:'nested portion only; main-frame matrix remains separately required; late pre-input fill probe occurs after host focus/selection and may conservatively be unknown',observations,checks,passed:!raw.failure&&Object.values(checks).every(Boolean)};
await writeFile(join(directory,'adjudication.json'),JSON.stringify(verdict,null,2)+'\n');console.log(JSON.stringify(verdict));
