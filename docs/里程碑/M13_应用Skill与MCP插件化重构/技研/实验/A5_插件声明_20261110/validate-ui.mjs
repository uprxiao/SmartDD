// 声明式界面语义校验（技研）：所有字段路径按能力 Schema 解析，模板只允许已知作用域。
import {readFileSync} from 'node:fs';import {join} from 'node:path';
export function loadPlugin(dir){const m=JSON.parse(readFileSync(join(dir,'.willyou-plugin/plugin.json'),'utf8'));const defs={};for(const f of m.schemas||[]){const s=JSON.parse(readFileSync(join(dir,f),'utf8'));defs[s.$id]=s;}
 const cap={};for(const[id,c]of Object.entries(m.capabilities)){cap[id]={input:JSON.parse(readFileSync(join(dir,c.input),'utf8')),output:JSON.parse(readFileSync(join(dir,c.output),'utf8'))};}return {m,defs,cap};}
const KNOWN={panel:['list'],section:['fields','resource','resourceList'],action:['insertTerminal','openUrl'],scopes:['tab','row','value','connection']};
export function validate({m,defs,cap}){const errs=[];const deref=s=>s&&s.$ref?defs[s.$ref]:s;
 const at=(schema,path)=>{let s=deref(schema);for(const seg of path.split('.').filter(Boolean)){if(!s)return null;s=deref(s);if(s.oneOf)s=deref(s.oneOf.find(x=>x.type!=='null'))??s;if(s.type==='array'||s.items){s=deref(s.items);}s=s?.properties?.[seg]!==undefined?deref(s.properties[seg]):(s?.type==='object'&&!s.properties?{}:null);}return s;};
 const isArray=(schema,path)=>{const parent=path.split('.').slice(0,-1).join('.'),leaf=path.split('.').pop();let s=at(schema,parent);s=deref(s?.properties?.[leaf]);return !!s&&(s.type==='array'||!!s.items);};
 const itemProps=(schema,path)=>{const parent=path.split('.').slice(0,-1).join('.'),leaf=path.split('.').pop();const arr=deref(at(schema,parent)?.properties?.[leaf]);return deref(arr?.items)?.properties??null;};
 const tpl=(s,where,ctx)=>{for(const mm of String(s).matchAll(/\{([a-z]+)\.([A-Za-z0-9_.]+)\}/g)){if(!KNOWN.scopes.includes(mm[1]))errs.push(`${where}: 未知模板作用域 ${mm[1]}`);else if(ctx[mm[1]]&&!ctx[mm[1]](mm[2]))errs.push(`${where}: 模板字段不存在 ${mm[1]}.${mm[2]}`);}};
 for(const p of m.ui?.panels||[]){const w='panel '+p.id;if(!KNOWN.panel.includes(p.kind))errs.push(w+': 未知 kind '+p.kind);const c=cap[p.source?.capability];if(!c){errs.push(w+': 能力不存在');continue;}
  if(!isArray(c.output,p.source.items))errs.push(w+': items 不是数组 '+p.source.items);const props=itemProps(c.output,p.source.items)||{};
  for(const col of p.columns)if(!(col.field in props))errs.push(`${w}: 列字段不存在 ${col.field}`);if(!(p.rowKey in props))errs.push(w+': rowKey 不存在');
  const pg=p.source.pagination;if(pg){if(!c.input.properties?.[pg.inputField])errs.push(w+': 分页输入字段不存在 '+pg.inputField);if(!at(c.output,pg.nextField))errs.push(w+': 分页输出字段不存在 '+pg.nextField);}
  const pt=p.source.partial;if(pt){if(!at(c.output,pt.completeField))errs.push(w+': completeField 不存在');if(!isArray(c.output,pt.problemsField))errs.push(w+': problemsField 不是数组');}
  if(p.source.presentationField&&!at(c.output,p.source.presentationField))errs.push(w+': presentationField 不存在');
  for(const t of p.tabs||[])for(const[k,v]of Object.entries(t.input)){const ps=c.input.properties?.[k];if(!ps)errs.push(`${w} tab ${t.id}: 输入字段不存在 ${k}`);else if(ps.enum&&!ps.enum.includes(v))errs.push(`${w} tab ${t.id}: 取值不在枚举 ${k}=${v}`);}
  tpl(p.subtitle||'',w+' subtitle',{connection:x=>x.startsWith('summary.')&&m.providers.some(pr=>pr.summaryFields.includes(x.slice(8)))});
  for(const[did,d]of Object.entries(p.details||{})){const dw=`${w} detail ${did}`;const dc=cap[d.source.capability];if(!dc){errs.push(dw+': 能力不存在');continue;}
   const ctx={tab:x=>x==='title'||(x.startsWith('input.')&&!!c.input.properties?.[x.slice(6)]),row:x=>x in props,value:x=>!!at(dc.output,x),connection:()=>true};
   tpl(d.titleTemplate,dw+' title',ctx);for(const[k,v]of Object.entries(d.source.input)){if(!dc.input.properties?.[k])errs.push(`${dw}: 输入字段不存在 ${k}`);tpl(v,`${dw} input ${k}`,ctx);}
   for(const s of d.sections){if(!KNOWN.section.includes(s.kind))errs.push(dw+': 未知 section '+s.kind);if(!at(dc.output,s.from))errs.push(`${dw}: section from 不存在 ${s.from}`);
    if(s.read&&!cap[s.read]?.input.required?.includes('resource'))errs.push(`${dw}: read 能力不接受 resource ${s.read}`);
    if(s.kind==='resourceList'){const ip=itemProps(dc.output,s.from)||{};for(const f of [s.nameField,s.resourceField])if(!(f in ip))errs.push(`${dw}: 附件字段不存在 ${f}`);}}
   for(const a of d.actions||[]){if(!KNOWN.action.includes(a.kind))errs.push(dw+': 未知动作 '+a.kind);for(const v of Object.values(a.payload||{}))tpl(v,dw+' action '+a.kind,ctx);}}}
 return errs;}
// headless view model
export function viewModel(m,tabId,listOut,detailOut){const p=m.ui.panels[0],tab=p.tabs.find(t=>t.id===tabId),pres=listOut[p.source.presentationField]||{};
 const enumText=(f,v)=>pres.choices?.[f]?.[v]??v;const rows=listOut.items.map(r=>Object.fromEntries(p.columns.map(c=>[c.title,c.enum?enumText(c.enum,r[c.field]):r[c.field]])));
 const d=p.details.object,dp=detailOut.presentation||{};const fill=(s,ctx)=>String(s).replace(/\{([a-z]+)\.([A-Za-z0-9_.]+)\}/g,(_,sc,path)=>path.split('.').reduce((o,k)=>o?.[k],ctx[sc])??'');
 const ctx={tab,row:listOut.items[0],value:detailOut};
 return {panelTitle:p.title,tabs:p.tabs.map(t=>t.title),rows,hasMore:listOut.nextCursor!=null,nextInput:{...tab.input,cursor:listOut.nextCursor},partialNotice:!listOut.complete||listOut.problems.length?`部分结果未完成（${listOut.problems.length} 项问题）`:null,
  detail:{title:fill(d.titleTemplate,ctx),fields:Object.entries(detailOut.fields).map(([k,v])=>({label:dp.labels?.[k]??k,text:dp.choices?.[k]?.[v]??String(v)})),resources:d.sections.filter(s=>s.kind==='resource').map(s=>({title:s.title,present:!!detailOut[s.from]})),attachments:detailOut.attachments.map(a=>({name:a[d.sections.find(s=>s.kind==='resourceList').nameField],previewable:/^(image|text)\//.test(a.resource.mediaType)||a.resource.mediaType==='application/pdf'})),
   incomplete:detailOut.complete?null:'缺少：'+detailOut.missing.join('、'),actions:d.actions.map(a=>({kind:a.kind,title:a.title,payload:Object.fromEntries(Object.entries(a.payload).map(([k,v])=>[k,v.match(/^\{[a-z]+\.[A-Za-z0-9_.]+\}$/)?v.slice(1,-1).split('.').slice(1).reduce((o,kk)=>o?.[kk],ctx[v.slice(1).split('.')[0]]):fill(v,ctx)]))}))}};}
