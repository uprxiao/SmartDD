import type {ZentaoPresentation} from './application-zentao';

const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const safeKey=(key:string)=>/^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(key)&&!['constructor','prototype','__proto__'].includes(key);
/** Current-server language data, including customized and JSON-array choices. */
export function parseZentaoPresentation(value:unknown,kind:'bug'|'story'):ZentaoPresentation|null{
 if(!record(value))return null;
 const root=record(value[kind])?value:record(value.data)?value.data:null,module=root?.[kind];
 if(!record(module))return null;
 const labels:Record<string,string>={},choices:Record<string,Record<string,string>>={};
 for(const[key,value]of Object.entries(module)){
  if(!safeKey(key))continue;
  if(typeof value==='string'&&value.length>0&&value.length<=256)labels[key]=value;
  if(key.endsWith('List')&&(record(value)||Array.isArray(value))){
   const field=key.slice(0,-4);if(!safeKey(field))continue;
   const entries=Object.entries(value).filter(([k,v])=>k.length<=120&&typeof v==='string'&&v.length<=256);
   if(entries.length>0&&entries.length<=300)choices[field]=Object.fromEntries(entries) as Record<string,string>;
  }
 }
 return Object.keys(labels).length||Object.keys(choices).length?{available:true,labels,choices}:null;
}

const labels:Record<string,string>={id:'编号',project:'项目',product:'产品',module:'模块',execution:'执行',branch:'分支',plan:'计划',story:'研发需求',storyVersion:'需求版本',task:'任务',toTask:'转为任务',toStory:'转为需求',keywords:'关键词',status:'状态',subStatus:'子状态',pri:'优先级',severity:'严重程度',type:'类型',os:'操作系统',browser:'浏览器',hardware:'硬件',found:'发现途径',confirmed:'确认状态',activatedCount:'激活次数',activatedDate:'激活时间',feedbackBy:'反馈人',notifyEmail:'通知邮箱',mailto:'抄送',openedBy:'创建人',openedDate:'创建时间',openedBuild:'影响版本',assignedTo:'指派给',assignedDate:'指派时间',deadline:'截止日期',resolvedBy:'解决人',resolution:'解决方案',resolvedBuild:'解决版本',resolvedDate:'解决时间',closedBy:'关闭人',closedDate:'关闭时间',duplicateBug:'重复Bug',relatedBug:'关联Bug',case:'关联用例',caseVersion:'用例版本',feedback:'反馈',result:'测试结果',repo:'代码仓库',mr:'合并请求',entry:'入口',lines:'代码行数',v1:'版本1',v2:'版本2',repoType:'仓库类型',issueKey:'外部问题编号',testtask:'测试单',lastEditedBy:'最后修改人',lastEditedDate:'最后修改时间',deleted:'已删除',storyStatus:'需求状态',latestStoryVersion:'需求最新版本',linkMRTitles:'关联合并请求',toCases:'关联用例'};
const names:Record<string,string>={project:'projectName',product:'productName',module:'moduleTitle',execution:'executionName',plan:'planName',story:'storyTitle',task:'taskName'};
export function zentaoValueText(value:unknown):string{
 if(value===null||value===undefined||value==='')return '—';
 if(Array.isArray(value))return value.length?value.map(zentaoValueText).join('、'):'—';
 if(record(value)){
  const name=[value.realname,value.name,value.title,value.account].find(v=>typeof v==='string'&&v.trim());
  return typeof name==='string'?name:JSON.stringify(value);
 }
 return typeof value==='boolean'?(value?'是':'否'):String(value);
}
export function zentaoEnumText(key:string,value:unknown,presentation?:ZentaoPresentation):string{
 const choice=presentation?.choices[key],code=typeof value==='number'||typeof value==='string'?String(value):null;
 return code!==null&&choice&&Object.hasOwn(choice,code)?choice[code]||'—':zentaoValueText(value);
}
export function zentaoDisplayFields(fields:Record<string,unknown>,presentation?:ZentaoPresentation):{key:string;label:string;text:string}[]{
 const consumed=new Set(Object.entries(names).filter(([key,name])=>fields[key]!==undefined&&typeof fields[name]==='string'&&String(fields[name]).trim()).map(([,name])=>name));
 return Object.entries(fields).filter(([key])=>key!=='title'&&key!=='preAndNext'&&!consumed.has(key)).map(([key,value])=>{
  const name=fields[names[key]??''],id=record(value)?value.id:value;
  const identifier=(typeof id==='string'||typeof id==='number')&&String(id)!==''&&String(id)!=='0'?String(id):null;
  const resolved=typeof name==='string'&&name.trim()?name+(identifier?'（#'+identifier+'）':''):null;
  return{key,label:presentation?.labels[key]??labels[key]??key,text:resolved??zentaoEnumText(key,value,presentation)};
 });
}
