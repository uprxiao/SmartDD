import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
const root=process.argv[2],bytes=await readFile(join(root,'result.json')),r=JSON.parse(bytes),l=r.lifecycle;
const cleanup=JSON.parse(await readFile(join(root,'process-cleanup-verification.json'),'utf8'));
const clean=r.cleanup?.closed===true&&r.hostExit?.code===0&&Object.values(cleanup.pids).every(value=>value==='absent')&&Object.values(cleanup.ports).every(value=>value==='absent');
const account=(value,name)=>value?.local===name&&value?.cookie?.split(/;\s*/).includes('account='+name);
const checks={
  completed:r.stage==='complete'&&!r.failure,cleanup:clean,
  rawTransport:r.steps.every(step=>{try{return isDeepStrictEqual(JSON.parse(step.raw.stdout),step.parsed);}catch{return false;}}),
  callerOwned:l?.profile.owner.id===r.ready.taskId,
  isolatedPrecondition:account(l?.projectBefore,'project-qa')&&account(l?.isolatedBefore,'task-qa2'),
  useDefault:account(l?.afterDefault,'project-qa')&&l.shows[0].result.profileId===l.default,
  stablePageIdentity:l?.shows.every(value=>value.result.browserPageId===l.page.pageId),
  oldRefRefused:l?.oldRefRefusal.raw.code===2&&l.oldRefRefusal.parsed.error?.code==='BROWSER_STALE_REF',
  setRestoresLogin:account(l?.afterSet,'task-qa2')&&l.shows[1].result.profileId===l.profile.id&&account(l.projectAfterSet,'project-qa'),
  deleteRebinds:l?.afterDeletePages.length===2&&l.afterDeletePages.every(value=>account(value,'project-qa')),
  deleteClearsCookies:l?.afterDelete.cookies.length===0,
  deleteForgets:l?.afterDelete.profilePresent===false&&l.listAfterDelete.result.profiles.every(value=>value.id!==l.profile.id),
  dormantAndClosedRebound:l?.afterDelete.saved.tabs.some(value=>value.id===l.prepared.dormantId&&value.profileId===l.default)&&l.afterDelete.saved.closed.some(value=>value.id===l.prepared.closedId&&value.profileId===l.default)&&[...l.afterDelete.saved.tabs,...l.afterDelete.saved.closed].every(value=>value.profileId!==l.profile.id),
  noLiveOldPartition:l?.afterDelete.pages.every(value=>value.profileId!==l.profile.id),
  projectNotDeletable:l?.afterProjectDeleteRefusal.raw.code===2&&l.afterProjectDeleteRefusal.parsed.error?.code==='INVALID_INPUT',
  foreignIdsRefused:l?.foreignRefusals.length===4&&l.foreignRefusals.every(value=>value.raw.code===2&&value.parsed.error?.code==='SCOPE_DENIED'),
  taskSet:l?.finalTabs.tabs.filter(value=>value.kind==='tab').every(value=>value.profileId===l.default),
};
const result={at:new Date().toISOString(),layer:'I',sourceSha256:createHash('sha256').update(bytes).digest('hex'),status:Object.values(checks).every(Boolean)?'passed-subset':'failed',checks,formalCases:{'M12-T075':'partial: clone/login-state and native cross-scope clone missing','M12-T079':'partial: packaged App/restart/delete-project/task-finished remain'},failure:r.failure};
await writeFile(join(root,'adjudication.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
