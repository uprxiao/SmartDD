import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const root=process.argv[2],bytes=await readFile(join(root,'result.json')),r=JSON.parse(bytes),cleanup=JSON.parse(await readFile(join(root,'process-cleanup-verification.json'),'utf8'));
const clean=r.appClosed===true&&r.fixtureServerClosed===true&&Object.values(cleanup.pids).every(value=>value==='absent')&&Object.values(cleanup.ports).every(value=>value==='absent');
const g=r.settingsGeometry,inside=g&&g.dialog.x>=g.workspace.x-1&&g.dialog.y>=g.workspace.y-1&&g.dialog.x+g.dialog.width<=g.workspace.x+g.workspace.width+1&&g.dialog.y+g.dialog.height<=g.workspace.y+g.workspace.height+1;
const scoped=g&&['x','y','width','height'].every(key=>Math.abs(g.scrim[key]-g.workspace[key])<=1);
const cases={
  'M12-T021':{layer:'A',executed:r.findInput!==undefined,checks:{cleanup:clean,actualPackagedInput:r.settingsFind===true&&r.layer.startsWith('A real packaged UI'),findSequence:r.find?.length===3&&r.find.every((value,index)=>value.taskId===r.taskIds[0]&&value.activeId===r.find[0].activeId&&value.find.total===5&&value.find.active===[1,2,1][index]),countText:/第\s*1\s*\/\s*5\s*个/.test(r.findText??''),nativeFocus:r.findFocused===true,completedSegment:r.checks?.some(value=>value.name.startsWith('M12-T021 A:')&&value.passed===true)}},
  'M12-T022-subset':{layer:'A',checks:{cleanup:clean,filesPrepared:r.artifactFiles?.length===2&&r.artifactFiles.every(value=>value.bytes>0),actualByteCount:r.beforeSettings?.artifactBytes===r.artifactFiles?.reduce((sum,value)=>sum+value.bytes,0),searchChoice:r.pendingPreferences?.searchEngine==='kagi',identityPending:r.pendingPreferences?.identity==='clean'&&r.pendingPreferences?.pendingIdentity==='native',actualClear:r.afterArtifactClear?.artifactBytes===0&&r.remainingArtifactTasks?.length===0,confirmation:r.cleanupWarning?.includes('确认清理')&&r.cleanupWarning?.includes('系统“下载”目录不受影响')},missing:['search navigation','restart and native CLI identity','actual system Downloads unchanged check']},
  'M12-T026-settings-subset':{layer:'A',checks:{cleanup:clean,scopedScrim:scoped,dialogInside:inside,originalPageScreenshot:g?.preview===true,realPtyInput:!!r.terminalMarker?.line?.startsWith('m12-settings-'),pageResumed:r.settingsPartial?.terminalInput===true},missing:['other original dialogs','actual narrow-pane drag scenario']},
};
cases['M12-T022-subset'].executed=r.beforeSettings!==undefined;
cases['M12-T022-subset'].checks.actualByteCount=Number.isFinite(r.beforeSettings?.artifactBytes)&&r.beforeSettings.artifactBytes===r.artifactFiles?.reduce((sum,value)=>sum+value.bytes,0);
cases['M12-T026-settings-subset'].executed=r.settingsGeometry!==undefined;
for(const value of Object.values(cases)){value.checks=Object.fromEntries(Object.entries(value.checks).map(([key,check])=>[key,Boolean(check)]));value.status=!value.executed?'not-executed':Object.values(value.checks).every(Boolean)?value.missing?.length?'partial':'passed':r.status==='deferred-focus-loss'?'partial-deferred-focus-loss':'failed';}
const result={at:new Date().toISOString(),sourceSha256:createHash('sha256').update(bytes).digest('hex'),asarSha256:r.asarSha256,cases,driverStatus:r.status,driverFailure:r.error};
await writeFile(join(root,'adjudication.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(Object.fromEntries(Object.entries(cases).map(([id,value])=>[id,{status:value.status,checks:value.checks}]))));
