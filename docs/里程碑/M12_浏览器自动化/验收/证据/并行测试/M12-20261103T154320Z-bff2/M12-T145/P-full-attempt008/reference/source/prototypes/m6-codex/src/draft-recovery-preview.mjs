import{draftTargetFixture}from'./mail-draft-target-fixtures.mjs';
export const isPublicDraftFixture=value=>value==='m10-review'||value==='m10-review-long'||!!draftTargetFixture(value);
// Rebuild only fixed public fixtures. Never substitute current content for an unknown old revision.
export function resolveDemoActivityDraft(data,target){
 const bad=reason=>({ok:false,reason});
 if(!target||target.kind!=='draft'||!(/^[a-zA-Z0-9_-]{1,120}$/.test(target.activityId))||!Number.isSafeInteger(target.revision)||target.revision<1)return bad('原记录未保留有效草稿修订，未打开当前修订代替。');
 const record=data.activity?.find(r=>r.id===target.activityId),current=data.drafts?.find(d=>d.project===target.project&&d.id===target.draftId);
 if(!record||record.app!=='mail'||record.project!==target.project||record.draftId!==target.draftId||record.revision!==target.revision||!current||!Number.isSafeInteger(current.revision)||current.revision<target.revision)return bad('原记录与项目、草稿或修订身份不符，未打开其他草稿。');
 const historical=target.revision<current.revision,fixture=historical?record.draftFixture:current.fixture;
 if(!isPublicDraftFixture(fixture))return bad('原修订的固定示例资料未保留，不能用当前修订内容替代。');
 if(record.category==='write'&&!['success','failed','unknown','sending'].includes(record.status))return bad('原发送状态不可用，未替换为其他结果。');
 if(!historical&&record.category==='write'&&record.status!==current.status)return bad('原发送状态与草稿修订不符，未替换为其他结果。');
 return{ok:true,historical,currentRevision:current.revision,draft:historical?{...current,revision:target.revision,fixture,status:record.category==='write'?record.status:'draft',senderId:record.category==='write'?record.connectionId:current.senderId,at:record.at}:{...current}};
}
