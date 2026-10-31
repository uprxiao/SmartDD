// Only whitelisted synthetic file-state metadata is persisted; never real packages/tasks.
export const VERSION_PREVIEW_SCENES=['tasks','unused','history','deleted','unknown','publication-staged','publication-verified','publication-recovery','publication-ready','cleanup-complete','cleanup-partial','cleanup-occupied','cleanup-unknown'];
export function normalizeVersionPreview(value,packages){return Object.fromEntries(['zentao','mail'].map(app=>{const v=value?.[app],scene=VERSION_PREVIEW_SCENES.includes(v?.scene)?v.scene:'tasks';const removed=[...new Set((Array.isArray(v?.removed)?v.removed:[]).filter(k=>k==='unused:1.0.0'||k==='publication-ready:0.9.0'||k==='cleanup-complete:0.9.0'||/^tasks:1\.[01]\.0$/.test(k)&&k!=='tasks:'+packages[app]))];const restored=[...new Set((Array.isArray(v?.restored)?v.restored:[]).filter(k=>k==='cleanup-complete:0.9.0'))];return[app,{scene,removed,...(restored.length?{restored}:{})}]}));}
export function versionPreviewRows(data,tasks,appId,retention){
 if(!['zentao','mail'].includes(appId))return [];
 const state=normalizeVersionPreview(data.versionPreview,data.packages??{mail:'1.0.0',zentao:'1.0.0'})[appId],scene=state.scene,demo=scene!=='tasks',current=demo?'1.1.0':data.packages?.[appId]??'1.0.0',publicationScene=scene.startsWith('publication-'),cleanupScene=scene.startsWith('cleanup-'),versions=publicationScene||cleanupScene?['0.9.0','1.1.0']:demo?['1.0.0','1.1.0']:[...new Set([...(data.installedVersions?.[appId]??['1.0.0']),current])];
 return versions.map(version=>{const fixed=version===current;let references=[],unknown=false;
  if(!demo){const r=retention(data,tasks,appId,version);references=[...new Map(r.references.map(t=>[t.id,t])).values()].map(t=>({taskId:t.id,title:t.deleted?null:t.title,runner:t.runner??'codex',deleted:!!t.deleted,openable:!t.deleted&&tasks.some(x=>x.id===t.id)}));unknown=tasks.some(t=>!t.integrationSnapshot);}
  else if(!fixed&&scene==='history'){const t=tasks.find(t=>t.status!=='running');references=[{taskId:t?.id??'preview-history',title:t?.title??'原会话 · 合成示例',runner:t?.runner??'codex',deleted:false,openable:!!t}];}
  else if(!fixed&&scene==='deleted')references=[{taskId:'preview-deleted',title:null,runner:'codex',deleted:true,openable:false}];
  if(scene==='unknown')unknown=true;
  const reasons=[fixed&&'新会话默认版本',references.some(r=>!r.deleted)&&'历史会话引用',references.some(r=>r.deleted)&&'已删除任务保留的原生历史引用',unknown&&'历史资源保留原因待核查'].filter(Boolean),key=scene+':'+version,removed=state.removed.includes(key),restored=state.restored?.includes(key)??false,blocked=reasons.length>0;
  const phase=cleanupScene&&!fixed&&!restored?'deleting':publicationScene&&!fixed?({'publication-staged':'staged','publication-verified':'verified','publication-recovery':'recovery-required','publication-ready':'ready'})[scene]:'ready',missing=phase!=='ready';if(missing)reasons.push('版本完整性待恢复','版本发布或清理尚未完成');
  return{key,appId,version,scene,defaultForNewSessions:fixed,state:removed?'removed':phase,publication:{state:({staged:'preparing',verified:'verified','recovery-required':'failed',ready:'committed',deleting:'committed'})[phase],errorCode:phase==='recovery-required'?'INSTALL_FAILED':null,updatedAt:'2026-10-28T00:00:00.000Z'},sessionRefCount:references.filter(r=>!r.deleted).length,tombstoneRefCount:references.filter(r=>r.deleted).length,activeRunCount:scene==='tasks'?references.filter(r=>!r.deleted&&tasks.some(t=>t.id===r.taskId&&t.status==='running')).length:0,references,sourceBytes:removed?0:missing?null:2048,projectionBytes:0,reclaimableBytes:removed||missing?0:2048,integrity:removed?'removed':missing?'missing':unknown?'unknown':'valid',compatibility:unknown?'unknown':'compatible',retentionReasons:reasons,issues:missing?['原版本内容缺失、损坏或归属不符']:unknown?['历史引用未核验，相关版本继续保留。']:[],canCleanup:!removed&&!blocked&&phase==='ready',...(phase==='deleting'?{cleanupRecovery:{operationId:'preview-cleanup:'+appId+':'+scene,planHash:'preview-plan:'+appId+':0.9.0',canCancel:scene==='cleanup-complete',issueCode:({'cleanup-complete':null,'cleanup-partial':'HASH_MISMATCH','cleanup-occupied':'OWNERSHIP_CONFLICT','cleanup-unknown':'RESOURCE_BUSY'})[scene]}}:{})};
 });
}
export function setVersionPreviewScene(data,appId,scene){if(!['zentao','mail'].includes(appId)||!VERSION_PREVIEW_SCENES.includes(scene))return data;const all=normalizeVersionPreview(data.versionPreview,data.packages??{mail:'1.0.0',zentao:'1.0.0'});return{...data,versionPreview:{...all,[appId]:{...all[appId],scene}}};}
export function cleanupVersionPreview(data,tasks,appId,original,retention){
 if(original?.appId!==appId)return{ok:false,state:data,reason:'原版本所属应用已变化，未清理任何数据。'};
 const row=versionPreviewRows(data,tasks,appId,retention).find(r=>r.key===original.key);if(!row||row.scene!==original.scene||!row.canCleanup||row.defaultForNewSessions)return{ok:false,state:data,reason:'占用或演示数据已变化，请重新检查；原版本保留。'};
 const all=normalizeVersionPreview(data.versionPreview,data.packages??{mail:'1.0.0',zentao:'1.0.0'});return{ok:true,state:{...data,versionPreview:{...all,[appId]:{...all[appId],removed:[...new Set([...all[appId].removed,row.key])]}}},removedFileBytes:row.sourceBytes};
}

export function cancelCleanupVersionPreview(data,tasks,appId,original,retention,{occupied=false}={}){
 const denied=reason=>({ok:false,state:data,reason});
 if(original?.appId!==appId)return denied('原版本所属应用已变化，未修改任何演示数据。');
 const row=versionPreviewRows(data,tasks,appId,retention).find(r=>r.key===original.key);
 if(!row||row.scene!==original.scene||!row.cleanupRecovery?.canCancel||row.defaultForNewSessions||row.cleanupRecovery.operationId!==original.cleanupRecovery?.operationId||row.cleanupRecovery.planHash!==original.cleanupRecovery?.planHash)return denied('原操作或版本状态已变化，保留现场，请重新核对。');
 if(occupied)return denied('原路径或暂存目录被其他内容占用，保留双方内容，不覆盖。');
 const all=normalizeVersionPreview(data.versionPreview,data.packages??{mail:'1.0.0',zentao:'1.0.0'});
 return{ok:true,state:{...data,versionPreview:{...all,[appId]:{...all[appId],restored:[...new Set([...(all[appId].restored??[]),row.key])]}}}};
}
export function resetVersionPreviewScene(data,appId){
 if(!['zentao','mail'].includes(appId))return data;
 const all=normalizeVersionPreview(data.versionPreview,data.packages??{mail:'1.0.0',zentao:'1.0.0'}),v=all[appId],restored=(v.restored??[]).filter(k=>!k.startsWith(v.scene+':'));
 return{...data,versionPreview:{...all,[appId]:{scene:v.scene,removed:v.removed.filter(k=>!k.startsWith(v.scene+':')),...(restored.length?{restored}:{})}}};
}
