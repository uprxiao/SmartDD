import {useEffect,useId,useMemo,useState} from 'react';
import {useInfiniteQuery,useQuery} from '@tanstack/react-query';
import type {PluginPanel,PluginUiRead} from '@shared/plugins';
import {isPluginFieldPath} from '@shared/plugins';
import {pluginListView,pluginPanelInput,pluginUiField,resolvePluginUiTemplate,type PluginUiScopes} from '@shared/plugin-ui';
import {rpc} from '@renderer/lib/ipc';
import {useProjectList} from '@renderer/lib/hooks/useProjects';
import {AppDialog,AppEmpty} from './controls';
import {applicationTimeText} from '@shared/application-time';
import {unwrap} from './api';
import {PluginActionButton} from './plugin-actions';
import {assemblePluginResource} from './plugin-resources';

type PageIdentity=Pick<PluginUiRead,'projectId'|'appId'|'panelId'|'packageHash'>;
type ReadReply=Extract<Awaited<ReturnType<typeof rpc.applications.pluginRead>>,{ok:true}>['value'];
const plain=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const text=(v:unknown):string=>v===null||v===undefined?'—':typeof v==='object'?JSON.stringify(v):String(v);
const allowsPreview=(resource:unknown,allowed:readonly string[]|undefined)=>{
  if(!allowed)return true;const raw=pluginUiField(resource,'mediaType');if(typeof raw!=='string')return false;const mime=raw.split(';')[0].trim().toLowerCase();
  return allowed.some(pattern=>pattern.toLowerCase()===mime||pattern.endsWith('/*')&&mime.startsWith(pattern.slice(0,-1).toLowerCase()));
};
function withCursor(input:Record<string,unknown>,path:string,cursor:string):Record<string,unknown>{
  if(!isPluginFieldPath(path))throw new Error('分页字段路径无效');const value=structuredClone(input);let at=value;const parts=path.split('.');
  for(const key of parts.slice(0,-1)){if(at[key]===undefined)at[key]={};if(!plain(at[key]))throw new Error('分页字段不是对象');at=at[key];}at[parts.at(-1)!]=cursor;return value;
}
export async function readPluginUi(base:PageIdentity,capability:string,input:Record<string,unknown>,signal:AbortSignal,connectionScope?:string){
  if(signal.aborted)throw new DOMException('页面读取已取消','AbortError');
  const requestId=crypto.randomUUID(),cancel=()=>{void rpc.applications.pluginCancelRead(requestId).catch(()=>{});};signal.addEventListener('abort',cancel,{once:true});
  try{const result=unwrap(await rpc.applications.pluginRead({...base,capability,input,requestId,...(connectionScope?{connectionScope}:{})}));if(signal.aborted)throw new DOMException('页面读取已取消','AbortError');return result;}
  finally{signal.removeEventListener('abort',cancel);}
}
function cell(value:unknown,enumPath:string|undefined,presentation:unknown,format?:string):string {
  const choices=enumPath?pluginUiField(presentation,enumPath):undefined;if(plain(choices)&&Object.hasOwn(choices,String(value)))return text(choices[String(value)]);
  return format==='datetime'&&typeof value==='string'?applicationTimeText(value):text(value);
}
function PartialNotice({source,value}:{source:PluginPanel['source'];value:unknown}){
  const partial=source.partial;if(!partial||pluginUiField(value,partial.completeField)!==false)return null;
  const path=partial.problemsField??partial.missingField,missing=path?pluginUiField(value,path):[];
  return <p role="alert" className="m10-note">结果尚不完整：{Array.isArray(missing)?missing.map(p=>plain(p)?text(p.code):text(p)).join('、'):'来源未提供说明'}</p>;
}
function ResourceContent({value}:{value:unknown}){
  const decoded=useMemo(()=>{
    try{
      if(!plain(value)||typeof value.mediaType!=='string'||typeof value.data!=='string'||!['utf8','base64'].includes(String(value.encoding)))throw new Error('资源返回格式无效');
      const mime=value.mediaType.split(';')[0].trim().toLowerCase(),bytes=value.encoding==='base64'?Uint8Array.from(atob(value.data),c=>c.charCodeAt(0)):new TextEncoder().encode(value.data);
      if(['image/png','image/jpeg','image/gif','image/webp','image/avif','application/pdf'].includes(mime)){
        if(value.encoding!=='base64')throw new Error('二进制预览需要 base64 内容');return{mime,bytes,truncated:value.truncated===true};
      }
      if(!/^(text\/|application\/(json|xml|javascript)$)/i.test(mime))throw new Error('该资源不是支持的预览类型');
      let content=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
      if(mime==='text/html'){const doc=new DOMParser().parseFromString(content,'text/html');doc.querySelectorAll('script,style,iframe,object,embed').forEach(e=>e.remove());content=doc.body.textContent??'';}
      return{mime,content,truncated:value.truncated===true};
    }catch(error){return{error:error instanceof Error?error.message:'资源无法解码'};}
  },[value]);
  const [url,setUrl]=useState<string|null>(null);
  useEffect(()=>{if(!decoded.bytes||decoded.truncated){setUrl(null);return;}const next=URL.createObjectURL(new Blob([decoded.bytes],{type:decoded.mime}));setUrl(next);return()=>URL.revokeObjectURL(next);},[decoded]);
  if(decoded.error)return <p role="alert">{decoded.error}</p>;
  if(decoded.bytes&&decoded.truncated)return <p role="alert">附件尚不完整，未打开二进制预览。</p>;
  return <>{decoded.bytes?url?decoded.mime==='application/pdf'?<iframe className="m13-plugin-pdf" title="PDF 附件预览" sandbox="" referrerPolicy="no-referrer" src={url}/>:<img className="m13-plugin-image" alt="插件附件预览" src={url}/>:<p role="status">正在准备附件预览…</p>:<pre>{decoded.content}</pre>}{decoded.truncated&&<p role="alert">来源仅返回了部分内容。</p>}</>;
}
function PluginResource({base,capability,resource,connectionScope}:{base:PageIdentity;capability:string;resource:unknown;connectionScope:string}){
  const [open,setOpen]=useState(false),query=useQuery({queryKey:['applications','plugin-resource',base,capability,resource,connectionScope],enabled:open,retry:false,gcTime:0,refetchOnWindowFocus:false,queryFn:async({signal})=>({value:await assemblePluginResource(resource,async offset=>(await readPluginUi(base,capability,{resource,...(offset===undefined?{}:{offset,length:131072})},signal,connectionScope)).value,signal)})});
  return <div className="m10-resource-view"><button className="m10-button secondary" onClick={()=>setOpen(!open)} aria-expanded={open}>{open?'收起内容':'读取内容'}</button>{open&&(query.isPending||query.isRefetching?<p role="status">正在核对原资源…</p>:query.error?<AppEmpty error title="内容读取未完成" text={query.error.message} action="重试" onAction={()=>void query.refetch()}/>:query.data&&<ResourceContent value={query.data.value}/>)}</div>;
}
function PluginDetail({base,panel,row,tab,origin,rowIndex,onClose,onNavigate}:{base:PageIdentity;panel:PluginPanel;row:unknown;tab:unknown;origin:ReadReply;rowIndex:number;onClose():void;onNavigate?():void}){
  const detail=panel.details[panel.onRowOpen!.detail],scopes:PluginUiScopes={tab,row,connection:{summary:origin.connectionSummary}};
  const query=useQuery({queryKey:['applications','plugin-detail',base,row,tab,origin.connectionScope],retry:false,gcTime:0,refetchOnWindowFocus:false,queryFn:({signal})=>readPluginUi(base,detail.source.capability,resolvePluginUiTemplate(detail.source.input??{},scopes) as Record<string,unknown>,signal,origin.connectionScope)});
  let title='详情';if(query.data){try{title=text(resolvePluginUiTemplate(detail.titleTemplate,{...scopes,value:query.data.value,connection:{summary:query.data.connectionSummary}}));}catch{/* Show the read failure in the content, never execute a template. */}}
  const value=query.data?.value;
  return <AppDialog title={title} wide onClose={onClose}>{query.isPending||query.isRefetching?<p role="status">正在核对原对象…</p>:query.error?<AppEmpty error title="详情读取未完成" text={query.error.message} action="重试" onAction={()=>void query.refetch()}/>:query.data&&<div className="m10-object-detail"><PartialNotice source={detail.source} value={value}/>{detail.sections.map((section,i)=>{
    const data=pluginUiField(value,section.from);return <section key={i}>{section.title&&<h3>{section.title}</h3>}{section.kind==='fields'?<dl className="m13-plugin-fields">{plain(data)?Object.entries(data).map(([key,v])=>{const labels=section.labels?pluginUiField(value,section.labels):undefined,enums=section.enums?pluginUiField(value,section.enums):undefined;return <div key={key}><dt>{plain(labels)&&Object.hasOwn(labels,key)?text(labels[key]):key}</dt><dd>{cell(v,key,enums)}</dd></div>;}):<p>来源未提供字段。</p>}</dl>:section.kind==='resource'?data&&section.read?<PluginResource base={base} capability={section.read} resource={data} connectionScope={query.data!.connectionScope}/>:<p>来源未提供内容。</p>:Array.isArray(data)?data.map((file,j)=>{const name=section.nameField?pluginUiField(file,section.nameField):undefined,resource=section.resourceField?pluginUiField(file,section.resourceField):file,canPreview=allowsPreview(resource,section.preview);return <div key={j}><p>{text(name??'附件')}</p>{section.read&&resource&&canPreview?<PluginResource base={base} capability={section.read} resource={resource} connectionScope={query.data!.connectionScope}/>:<p className="m10-muted">此附件不提供文字预览。</p>}</div>;}):<p>来源未提供附件。</p>}</section>;
  })}</div>}<footer className="m10-dialog-actions">{query.data?.actionReceipt&&origin.actionReceipt&&detail.actions.map((action,i)=><PluginActionButton key={i} title={action.title} request={{receiptId:query.data!.actionReceipt!,actionIndex:i,detailId:panel.onRowOpen!.detail,row:{receiptId:origin.actionReceipt!,index:rowIndex,...(plain(tab)&&typeof tab.id==='string'?{tabId:tab.id}:{})}}} onDone={(close,navigate)=>{if(close)onClose();if(navigate)onNavigate?.();}}/>)}<button className="m10-button secondary" onClick={onClose}>关闭</button></footer></AppDialog>;
}
function PanelData({base,panel,context,onNavigate}:{base:PageIdentity;panel:PluginPanel;context:{connectionScope:string;connectionSummary:Record<string,unknown>};onNavigate?():void}){
  const [tabId,setTabId]=useState(panel.tabs[0]?.id??''),[selected,setSelected]=useState<{row:unknown;origin:ReadReply;rowIndex:number}|null>(null),opening=useId(),tab=panel.tabs.find(t=>t.id===tabId);
  const query=useInfiniteQuery({queryKey:['applications','plugin-panel',base,tabId,opening],initialPageParam:null as {cursor:string;scope:string}|null,retry:false,gcTime:0,refetchOnWindowFocus:false,
    queryFn:async({pageParam,signal})=>{const input=pluginPanelInput(panel,{tab,connection:{summary:context.connectionSummary}});const reply=await readPluginUi(base,panel.source.capability,pageParam&&panel.source.pagination?withCursor(input,panel.source.pagination.inputField,pageParam.cursor):input,signal,pageParam?.scope??context.connectionScope);return{reply,view:pluginListView(panel,reply.value)};},
    getNextPageParam:last=>last.view.nextCursor?{cursor:last.view.nextCursor,scope:last.reply.connectionScope}:undefined});
  const rows=query.data?.pages.flatMap(p=>p.view.rows.map((row,index)=>({...row,rowIndex:index,origin:p.reply,presentation:p.view.presentation})))??[];
  let subtitle:string|undefined;if(panel.subtitle){try{subtitle=text(resolvePluginUiTemplate(panel.subtitle,{connection:{summary:context.connectionSummary}}));}catch{subtitle='来源未提供完整的连接说明';}}
  return <section className="m13-plugin-panel" aria-label={panel.title}><header className="m10-section-heading"><div><h3>{panel.title}</h3>{subtitle&&<p>{subtitle}</p>}</div>{panel.refresh&&<button className="m10-button secondary" disabled={query.isFetching} onClick={()=>{setSelected(null);void query.refetch();}}>刷新</button>}</header>
    {!!panel.tabs.length&&<div role="tablist" aria-label={panel.title}>{panel.tabs.map(t=><button role="tab" aria-selected={tabId===t.id} key={t.id} onClick={()=>{setSelected(null);setTabId(t.id);}}>{t.title}</button>)}</div>}
    {query.isPending||query.isRefetching?<p role="status">正在读取插件数据…</p>:query.error&&!query.isFetchNextPageError?<AppEmpty error title="插件数据读取未完成" text={query.error.message} action="重试" onAction={()=>void query.refetch()}/>:<>{query.data?.pages.map((p,i)=><PartialNotice key={i} source={panel.source} value={p.reply.value}/>)}{rows.length?<div className="m13-plugin-table-scroll"><table><thead><tr>{panel.columns.map(c=><th key={c.field} style={c.width?{width:c.width}:undefined}>{c.title}</th>)}{!!panel.rowActions.length&&<th>操作</th>}</tr></thead><tbody>{rows.map((row,i)=><tr key={i}>{panel.columns.map((c,j)=><td key={c.field}>{j===0&&panel.onRowOpen?<button className="m13-plugin-row-link" onClick={()=>setSelected({row:row.value,origin:row.origin,rowIndex:row.rowIndex})}>{cell(pluginUiField(row.value,c.field),c.enum,pluginUiField(row.presentation,'choices')??row.presentation,c.format)}</button>:<span className={c.format==='badge'?'m10-badge':undefined}>{cell(pluginUiField(row.value,c.field),c.enum,pluginUiField(row.presentation,'choices')??row.presentation,c.format)}</span>}</td>)}{!!panel.rowActions.length&&<td>{row.origin.actionReceipt&&panel.rowActions.map((action,j)=><PluginActionButton key={j} title={action.title} request={{receiptId:row.origin.actionReceipt!,actionIndex:j,row:{receiptId:row.origin.actionReceipt!,index:row.rowIndex,...(tab?{tabId:tab.id}:{})}}} onDone={(close,navigate)=>{if(close||navigate)onNavigate?.();}}/>)}</td>}</tr>)}</tbody></table></div>:<p>当前列表为空。</p>}
    {query.isFetchNextPageError&&<p role="alert">下一页未读取完成：{query.error.message}</p>}{query.hasNextPage&&<button className="m10-button secondary" disabled={query.isFetchingNextPage} onClick={()=>void query.fetchNextPage()}>{query.isFetchingNextPage?'正在读取…':query.isFetchNextPageError?'重试下一页':'加载更多'}</button>}</>}
    {selected&&panel.onRowOpen&&<PluginDetail key={JSON.stringify([selected.row,selected.origin.connectionScope])} base={base} panel={panel} row={selected.row} tab={tab} origin={selected.origin} rowIndex={selected.rowIndex} onNavigate={onNavigate} onClose={()=>setSelected(null)}/>}
  </section>;
}
function AuthorizedPanel({base,panel,onNavigate}:{base:PageIdentity;panel:PluginPanel;onNavigate?():void}){
  const query=useQuery({queryKey:['applications','plugin-page-context',base],queryFn:async()=>unwrap(await rpc.applications.pluginPageContext(base)),retry:false,gcTime:0,refetchOnWindowFocus:false});
  if(query.isPending||query.isRefetching)return <p role="status">正在核对项目连接…</p>;
  if(query.error)return <AppEmpty error title="插件项目连接不可用" text={query.error.message} action="重试" onAction={()=>void query.refetch()}/>;
  return <PanelData key={query.data.connectionScope} base={base} panel={panel} context={query.data} onNavigate={onNavigate}/>;
}
/** Runs only declarative, validated read capabilities; plugin code never enters the renderer. */
export function PluginPages({plugin,onNavigate}:{plugin:{appId:string;hash:string|null;enabled:boolean;panels:PluginPanel[]};onNavigate?():void}){
  const projects=useProjectList(),[projectId,setProjectId]=useState(''),[panelId,setPanelId]=useState(plugin.panels[0]?.id??'');
  if(!plugin.enabled)return <p role="status">插件已停用，页面不可读取数据或执行动作。</p>;
  if(!plugin.hash)return null;const panel=plugin.panels.find(p=>p.id===panelId)??plugin.panels[0];
  return <div className="m13-plugin-pages"><label>项目<select aria-label="插件数据项目" value={projectId} onChange={e=>setProjectId(e.target.value)}><option value="">选择项目</option>{projects.data?.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>{projects.error&&<p role="alert">项目读取失败：{projects.error.message}</p>}{plugin.panels.length>1&&<label>页面<select aria-label="插件页面" value={panel?.id??''} onChange={e=>setPanelId(e.target.value)}>{plugin.panels.map(p=><option key={p.id} value={p.id}>{p.title}</option>)}</select></label>}
    {projectId&&projects.data?.some(p=>p.id===projectId)&&panel?<AuthorizedPanel key={JSON.stringify([projectId,plugin.appId,plugin.hash,panel.id])} base={{projectId,appId:plugin.appId,packageHash:plugin.hash,panelId:panel.id}} panel={panel} onNavigate={onNavigate}/>:<p>选择项目后读取该项目的插件数据。</p>}</div>;
}
