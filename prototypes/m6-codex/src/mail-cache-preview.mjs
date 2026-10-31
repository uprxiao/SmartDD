// Fixed public statistics for the isolated synthetic preview, never live storage.
export const CACHE_USAGE_SCENES=[['ready','完整统计'],['loading','读取中'],['failed','读取失败'],['incomplete','统计未完成'],['recovered','故障原件保留'],['over-budget','超预算与长数字']];
export const CACHE_USAGE_ERROR='缓存占用统计暂时不可用，请稍后重试';
export function cacheUsagePreview(scene='ready'){
 const value={limit:500000000,actual:{total:12000000,index:2000000,objects:8000000,auxiliary:1000000,staging:1000000},activeLeases:0,overBudget:false,unrecognized:[],recoveryRetainedBytes:scene==='recovered'?1000000:0,storage:{business:{files:{bytes:34000000,complete:true},sharedDatabase:{bytes:56000000,complete:true},drafts:2,sends:3},versions:{items:[{packageHash:'a'.repeat(64),version:'1.0.0',sourceBytes:78000000,projectionBytes:9000000,retentionReasons:['历史会话引用']}]}}};
 if(scene==='incomplete'){value.storage.business.files={bytes:null,complete:false};value.storage.business.sharedDatabase={bytes:null,complete:false};value.storage.versions=null;}
 if(scene==='over-budget'){Object.assign(value,{activeLeases:2,overBudget:true,unrecognized:['synthetic-unknown-file']});Object.assign(value.actual,{total:501000000,objects:497000000});value.storage.business.files.bytes=123456789000000;value.storage.business.sharedDatabase.bytes=987654321000000;value.storage.business.drafts=123456789;value.storage.business.sends=987654321;value.storage.versions.items[0].sourceBytes=123456789000000;value.storage.versions.items[0].projectionBytes=987654321000000;}
 return value;
}
