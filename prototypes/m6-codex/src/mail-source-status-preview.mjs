// Fixed synthetic display data only. This module never reads files or calls IPC.
// The native App owns real scan counts and results; these numbers are prototype fixtures.
export function previewMailSourceResult(snapshot,checkedAt,lastSuccessfulRefreshAt=null){
 if(!snapshot.ready||!snapshot.range||snapshot.diagnostic.state==='failed')return{status:null,error:snapshot.scene==='unsupported'?'Foxmail来源忙碌、不可读或格式不支持':(snapshot.diagnostic.title??'本机来源检查失败')+'：'+snapshot.diagnostic.reason.replace(/。+$/u,'')};
 const partial=snapshot.diagnostic.state==='partial',complete=!partial;
 return{error:'',status:{query:{range:{days:snapshot.range.days,startDate:snapshot.range.from,endDate:snapshot.range.through,timeZone:snapshot.range.timezone},nextCursor:null,complete,matched:partial||snapshot.scene==='empty'?0:2,checkedAt,problems:partial?[{code:'INCOMPLETE_RESULT',objectId:null}]:[]},refresh:{scanned:2,total:2,finished:true,problemCount:partial?3:0,lastSuccessfulRefreshAt:complete?checkedAt:lastSuccessfulRefreshAt}}};
}
