import {readSessionChangeImpact,sessionChangeMessage} from './session-change';
import {BuiltinConnections} from './builtin-connections';
import {Fragment,useEffect,useRef,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {observer} from 'mobx-react-lite';
import {toast} from 'sonner';
import {ArrowRight,Blocks,ChevronDown,ChevronRight,FileArchive,FileText,FolderOpen,Info,KeyRound,MoreHorizontal,Plus,Puzzle,RefreshCw,Search,Settings,Sparkles,Terminal,TriangleAlert} from 'lucide-react';
import type {ApplicationConnection,ApplicationProvider} from '@shared/application-connections';
import {applicationConnectionSummary} from '@shared/application-provider-metadata';
import {navigation} from '@renderer/core/navigation';
import {rpc} from '@renderer/lib/ipc';
import {useProjectList} from '@renderer/lib/hooks/useProjects';
import appIcon from '../../../assets/branding/app-icon.png';
import {SkillsWorkspace} from '../skills/workspace';
import {unwrap,useApplicationAction,useCatalog,useConnections,usePluginCatalog,type CatalogItem} from './api';
import {AppDialog,AppEmpty,IconButton,useApplicationMenu,connectionState} from './controls';
import {PluginManager,type PluginManagerHandle} from './plugin-manager';
import {PluginConnectionsView} from './plugin-connections';
import {PluginPages} from './plugin-panel';
import {MailDrafts} from './mail-panel';
import {PluginIcon,pluginAccent} from './plugin-icon';
import './style.css';
import '../agents/style.css';
import './plugin-workspace.css';

type External=NonNullable<ReturnType<typeof usePluginCatalog>['data']>[number];
type Entry={id:string;name:string;description:string;version:string|null;publisher:string;enabled:boolean;paused:boolean;builtin:CatalogItem|null;external:External|null;examples:{title:string;prompt:string}[];capabilities:{id:string;title:string;write:boolean}[];skills:string[]};
const entryPageTitle=(p:Entry)=>p.id==='mail'?'草稿':p.external?.panels.length===1?p.external.panels[0].title:'插件页面';
const builtinExamples:Record<string,string[]>={mail:['整理最近 3 天客户邮件里待我回复的问题','根据这封投诉邮件起草一封礼貌、明确的回复'],browser:['打开测试环境登录页，复现用户反馈的按钮无响应']};
function builtinEntry(app:CatalogItem):Entry{return{id:app.appId,name:app.displayName,description:app.description,version:app.version??null,publisher:'WillYou',enabled:app.added&&app.enabled,paused:false,builtin:app,external:null,examples:(builtinExamples[app.appId]??[]).map(prompt=>({title:prompt,prompt})),capabilities:app.tools.map(t=>({id:t.name,title:t.name,write:!t.readOnly})),skills:app.skills.map(s=>s.id)};}
function externalEntry(p:External):Entry{return{id:p.appId,name:p.displayName,description:p.description,version:p.version,publisher:p.author?.name??'未提供',enabled:p.enabled,paused:p.paused,builtin:null,external:p,examples:p.examples??[],capabilities:p.capabilities.map(c=>({id:c.id,title:c.title,write:c.semantics!=='read'})),skills:p.skills.map(s=>s.id)};}
function Mark({entry,size=36}:{entry:Entry;size?:number}){return <span className={'m10-appmark tile'+(size===60?' large':'')} style={{width:size,height:size,flex:`0 0 ${size}px`}}><PluginIcon id={entry.id} name={entry.name} size={size} images={entry.external?.icons}/></span>;}
function EntryMenu({entry,detail=false,busy,onDetail,onToggle,manager}:{entry:Entry;detail?:boolean;busy:boolean;onDetail():void;onToggle():void;manager:React.RefObject<PluginManagerHandle|null>}){
 const[open,setOpen]=useState(false);useApplicationMenu(open?'plugin-'+entry.id:null,()=>setOpen(false));
 const act=(fn:()=>void)=>{setOpen(false);fn();};
 return <div className="m10-menu-wrap"><IconButton icon={MoreHorizontal} label={detail?'插件更多操作':entry.name+' 更多操作'} expanded={open} disabled={busy} onClick={()=>setOpen(!open)}/>{open&&<div className="m10-menu" role="menu">{!detail&&<button role="menuitem" onClick={()=>act(onDetail)}>查看详情</button>}<button role="menuitem" onClick={()=>act(onToggle)}>{entry.enabled?'停用':'启用'}</button>{entry.external&&<><button role="menuitem" onClick={()=>act(()=>manager.current?.update(entry.id))}>更新…</button><button className="danger" role="menuitem" onClick={()=>act(()=>manager.current?.uninstall(entry.id))}>卸载…</button></>}</div>}</div>;
}

export const ApplicationsWorkspace=observer(function ApplicationsWorkspace(){
 const catalog=useCatalog(),external=usePluginCatalog(),action=useApplicationAction(),projects=useProjectList();
 const discovered=useQuery({queryKey:['managed-capabilities'],queryFn:()=>rpc.capabilities.managedList(),refetchInterval:5000});
 const page=navigation.applicationPage,manager=useRef<PluginManagerHandle>(null),content=useRef<HTMLDivElement>(null),search=useRef<HTMLInputElement>(null);
 const[query,setQuery]=useState(''),[filter,setFilter]=useState<'all'|'enabled'|'disabled'>('all'),[adding,setAdding]=useState(false),[notice,setNotice]=useState('');
 const entries=[...(catalog.data??[]).filter(a=>a.appId==='mail'||a.appId==='browser').map(builtinEntry),...(external.data??[]).filter(p=>p.installed).map(externalEntry)];
 const path=page.startsWith('plugin:')?page.slice(7).split('/'):[page],selected=entries.find(p=>p.id===path[0]),subpage=path[1];
 const isCatalog=page==='catalog'||page==='activity'||page==='projects',loading=catalog.isPending||external.isPending,error=catalog.error??external.error;
 const open=(p:Entry,sub?:string)=>navigation.openApplications(`plugin:${p.id}${sub?'/'+sub:''}`);
 useApplicationMenu(adding?'add-plugin':null,()=>setAdding(false));
 useEffect(()=>{setAdding(false);setQuery('');setNotice('');content.current?.scrollTo?.(0,0);},[page]);
 useEffect(()=>{if(navigation.currentViewId==='apps'&&page==='projects'&&navigation.currentProjectId)navigation.openProject(navigation.currentProjectId,'applications');},[page,navigation.currentViewId,navigation.currentProjectId]);
 const refreshing=useRef(false);
 const refresh=async()=>{
  if(refreshing.current)return;
  refreshing.current=true;setNotice('');const originPage=page;
  try{
   const results=await Promise.all([catalog.refetch(),external.refetch()]);
   if(navigation.currentViewId==='apps'&&navigation.applicationPage===originPage)setNotice(results.some(result=>result.error)?'插件状态读取未完成，请重试':'插件状态已刷新');
  }catch{
   if(navigation.currentViewId==='apps'&&navigation.applicationPage===originPage)setNotice('插件状态读取未完成，请重试');
  }finally{refreshing.current=false;}
 };
 const toggle=async(p:Entry)=>{setNotice('');let effect='';const ok=await action.run('toggle-'+p.id,async()=>{const impact=await readSessionChangeImpact({kind:'plugin',appId:p.id});if(p.external)unwrap(await rpc.applications.pluginSetEnabled(p.id,!p.enabled,p.external.revision));else if(p.builtin){if(!p.builtin.added)unwrap(await rpc.applications.setAdded(p.builtin.appId,true,p.builtin.revision));else unwrap(await rpc.applications.setEnabled(p.builtin.appId,!p.enabled,p.builtin.revision));}effect=sessionChangeMessage(p.enabled?'plugin-off':'plugin-on',impact);});if(ok)toast.success(p.name+(p.enabled?' 已停用：':' 已启用：')+effect+(p.enabled?'；连接与数据保留':''));};
 const menu=(p:Entry,detail=false)=><EntryMenu entry={p} detail={detail} busy={!!action.busy} onDetail={()=>open(p)} onToggle={()=>void toggle(p)} manager={manager}/>;
 const shown=(p:Entry)=>(p.name+' '+p.description).toLowerCase().includes(query.trim().toLowerCase())&&(filter==='all'||(filter==='enabled'?p.enabled:!p.enabled));
 const groups:[string,Entry[]][]=[['内置',entries.filter(p=>p.builtin&&shown(p))],['外部插件',entries.filter(p=>p.external&&shown(p))]];
 const currentProjectId=projects.data?.find(p=>p.id===navigation.currentProjectId)?.id??null;
 return <section className="m10-shell m13-shell" aria-label="插件工作区"><aside className="m10-sidebar">
   <div className="m10-sidebar-title"><h2>自定义</h2><IconButton icon={Search} label="搜索插件目录" onClick={()=>{navigation.openApplications();requestAnimationFrame(()=>search.current?.focus());}}/></div>
   <button className={'m10-nav '+(page!=='skills'?'selected':'')} onClick={()=>navigation.openApplications()}><Puzzle size={17}/>插件</button>
   <button className={'m10-nav '+(page==='skills'?'selected':'')} onClick={()=>navigation.openApplications('skills')}><Blocks size={17}/>技能{!!discovered.data?.newCount&&<span className="m13-nav-dot" aria-label={'发现 '+discovered.data.newCount+' 个新技能'}/>}</button>
   <div className="m10-sidebar-label">已安装</div>
   {entries.map(p=><Fragment key={p.id}><button className={'m10-nav installed '+(selected?.id===p.id&&!subpage?'selected ':'')+(!p.enabled?'m13-disabled':'')} onClick={()=>open(p)}><Mark entry={p} size={16}/><span title={p.name}>{p.name}</span>{!p.enabled&&<small className="m13-nav-note">已停用</small>}</button>{selected?.id===p.id&&(p.id==='mail'||!!p.external?.panels.length)&&<button className={'m10-nav m13-nav-child '+(subpage?'selected ':'')+(!p.enabled?'m13-disabled':'')} onClick={()=>open(p,p.id==='mail'?'drafts':'work')}><FileText size={16}/>{entryPageTitle(p)}</button>}</Fragment>)}
   <div className="m10-sidebar-bottom"><img src={appIcon} alt=""/><span>WillYou</span></div>
 </aside><div className="m10-main">
   {selected&&page!=='skills'&&<div className="m13-detail-bar"><nav className="m13-crumb" aria-label="位置"><button onClick={()=>navigation.openApplications()}>插件</button><ChevronRight size={14}/>{subpage?<><button onClick={()=>open(selected)}>{selected.name}</button><ChevronRight size={14}/><span>{entryPageTitle(selected)}</span></>:<span title={selected.name}>{selected.name}</span>}</nav></div>}
   <div ref={content} className={'m10-content m10-catalog-content m13-content'+(selected&&page!=='skills'?' detail':'')}>
     {page==='skills'?<SkillsWorkspace/>:<>
       {isCatalog&&<><header className="m10-page-head"><div><h1>插件</h1><p>安装插件，让 Agent 在你的业务系统中协同工作。新增插件不需要重装 WillYou。</p></div><div className="m10-head-actions"><label className="m10-search"><Search size={15}/><input ref={search} className="m13-search-input" aria-label="搜索插件" placeholder="搜索插件" value={query} onChange={e=>setQuery(e.target.value)}/></label><IconButton icon={RefreshCw} label="重新读取插件" disabled={catalog.isFetching||external.isFetching} onClick={refresh}/><div className="m10-menu-wrap"><button className="m10-button primary m13-add" aria-expanded={adding} disabled={!!action.busy} onClick={()=>setAdding(!adding)}>添加<ChevronDown size={16}/></button>{adding&&<div className="m10-menu" role="menu"><button role="menuitem" onClick={()=>{setAdding(false);manager.current?.choose('directory');}}><FolderOpen size={15}/>从本地文件夹安装…</button><button role="menuitem" onClick={()=>{setAdding(false);manager.current?.choose('zip');}}><FileArchive size={15}/>从 .zip 文件安装…</button></div>}</div></div></header>
         <div className="m10-tabs" role="tablist" aria-label="插件筛选">{([['all','全部'],['enabled','已启用'],['disabled','已停用']] as const).map(([id,label])=><button role="tab" key={id} aria-selected={filter===id} onClick={()=>setFilter(id)}>{label}</button>)}</div>
         {loading?<AppEmpty loading title="正在读取插件" text="正在读取本机插件与当前状态。"/>:error?<AppEmpty error title="插件暂时无法加载" text={error.message} action="重试" onAction={refresh}/>:<>{groups.map(([title,list])=>list.length>0&&<section key={title} className="m13-group"><h2 className="m10-section-title">{title}<ChevronRight size={14}/></h2><div className="m10-catalog-grid">{list.map(p=><article className="m10-catalog-item" key={p.id}><button className="m10-catalog-open" onClick={()=>open(p)}><Mark entry={p}/><span><strong title={p.name}>{p.name}</strong><small>{!p.enabled?'已停用 · ':p.paused?'进程异常 · ':''}{p.description}</small></span></button>{menu(p)}</article>)}</div></section>)}{groups.every(([,list])=>!list.length)&&<AppEmpty title="没有匹配的插件" text="试试其他关键词，或切换到“全部”。"/>}</>}
       </>}
       {!isCatalog&&(loading?<AppEmpty loading title="正在读取插件" text="正在读取当前版本与配置。"/>:error?<AppEmpty error title="插件暂不可用" text={error.message} action="重试" onAction={refresh}/>:selected?subpage?<div className="m13-detail">{!selected.enabled?<AppEmpty title={selected.name+'插件已停用'} text="启用后可继续使用；连接、项目设置与历史数据保留。" action="启用" onAction={()=>void toggle(selected)}/>:selected.external?<PluginPages key={selected.id+':'+selected.external.hash} plugin={selected.external} onNavigate={()=>{if(navigation.currentViewId==='apps')open(selected);}}/>:selected.id==='mail'?<MailDrafts projectId={currentProjectId}/>:null}</div>:<PluginDetail entry={selected} menu={menu(selected,true)} onEnable={()=>void toggle(selected)} busy={!!action.busy} onSubpage={()=>open(selected,selected.id==='mail'?'drafts':'work')} onRestart={()=>void action.run('restart',async()=>{unwrap(await rpc.applications.pluginRestart(selected.id));})}/>:<AppEmpty title="插件不存在或已卸载" text="请返回插件目录查看当前已安装的插件。" action="返回插件" onAction={()=>navigation.openApplications()}/>)}
       {notice&&<p className="m13-change-notice" role="status">{notice}</p>}{action.error&&<p className="m13-alert danger" role="alert">{action.error}</p>}
     </>}
     <PluginManager ref={manager} query="" headless onInstalled={appId=>navigation.openApplications(`plugin:${appId}`)}/>
   </div>
 </div></section>;
});

function PluginDetail({entry:p,menu,onEnable,busy,onSubpage,onRestart}:{entry:Entry;menu:React.ReactNode;onEnable():void;busy:boolean;onSubpage():void;onRestart():void}){
 const hasConnections=p.builtin?!!p.builtin.providers.length:!!p.external?.providers?.length;
 const subpage=p.id==='mail'||p.external?.panels.length?entryPageTitle(p):null;
 return <div className="m13-detail"><div className="m13-detail-head"><Mark entry={p} size={60}/><div className="m13-detail-title"><h1>{p.name}{p.builtin&&<span className="m13-pill">内置</span>}</h1><p><span className={'m13-state '+(p.enabled?'on':'off')}>{p.enabled?'已启用':'已停用'}</span> · 版本 {p.version??'—'} · 由 {p.publisher} 发布</p></div><div className="m13-detail-actions">{menu}{subpage&&<button className="m10-button secondary" disabled={!p.enabled} title={p.enabled?'':'插件已停用'} onClick={onSubpage}><FileText size={15}/>{subpage}</button>}{hasConnections&&<button className="m10-button secondary" onClick={()=>document.getElementById('m13-connections')?.scrollIntoView({block:'start'})}><Settings size={15}/>管理</button>}{p.enabled?<button className="m10-button primary m13-try" disabled={p.paused||!p.examples.length} onClick={()=>navigation.preparePluginTask(p.examples[0].prompt)}><Sparkles size={15}/>立即试用</button>:<button className="m10-button primary m13-try" disabled={busy} onClick={onEnable}>启用</button>}</div></div>
   {!p.enabled&&<div className="m13-alert warn"><Info size={16}/><div><strong>已停用</strong><p>运行中的会话不能再调用它，新建或恢复的会话不再加载它的工具与 Skill；连接、项目设置都保留。</p></div></div>}
   {p.paused&&<div className="m13-alert danger"><TriangleAlert size={16}/><div><strong>插件进程异常退出</strong><p>WillYou 已暂停调用它，不影响其他插件和正在运行的终端。</p></div><button className="m10-button secondary" disabled={busy} onClick={onRestart}>重新启动</button></div>}
   {p.examples.length>0&&<div className="m13-hero">{p.examples.map((ex,i)=><button className="m13-example" key={i} title={ex.title} disabled={!p.enabled||p.paused} onClick={()=>navigation.preparePluginTask(ex.prompt)}><Mark entry={p} size={14}/><span><b style={{color:pluginAccent(p.id)}}>{p.name}</b> {ex.prompt}</span><ArrowRight size={16}/></button>)}</div>}
   <p className="m13-desc">{p.description}</p><section className="m13-section"><h2>能力 <span>{p.capabilities.length}</span></h2>{p.capabilities.map(c=><div className="m13-row" key={c.id}><span className="m13-rowicon"><Terminal size={18}/></span><span>{c.title}<small>{c.write?'会改变页面或外部系统的状态':'只读取，不改变页面或外部系统'}</small></span><span className={'m13-pill '+(c.write?'warn':'muted')}>{c.write?'写入':'读取'}</span></div>)}{p.capabilities.some(c=>c.write)&&<p className="m13-hint">读写分类以插件声明为准，写入类能力按 WillYou 的审批规则执行。</p>}</section>
   {p.skills.length>0&&<section className="m13-section"><h2>Skill <span>{p.skills.length}</span></h2>{p.skills.map(s=><div className="m13-row" key={s}><span className="m13-rowicon"><Sparkles size={18}/></span><span>{s}<small>随插件安装、更新和卸载</small></span></div>)}</section>}
   {hasConnections&&<section className="m13-section" id="m13-connections"><h2>连接</h2>{p.external?.hash?<PluginConnectionsView key={p.external.hash} inline target={{appId:p.id,packageHash:p.external.hash}}/>:p.builtin?<BuiltinConnections app={p.builtin}/>:null}</section>}
   <section className="m13-section"><h2>在项目中使用</h2><p className="m13-hint m13-plain">插件装好后所有项目默认可用。要在某个项目关闭它，或为某个项目单独选择连接，请到该项目的“插件”分区。</p></section>
   <section className="m13-section"><h2>信息</h2><dl className="m13-info"><dt>功能</dt><dd>{[...new Set(p.capabilities.map(c=>c.write?'写入':'读取'))].join('、')||'—'}</dd><dt>开发者</dt><dd>{p.publisher}</dd>{p.external?.category&&<><dt>类别</dt><dd>{p.external.category}</dd></>}<dt>版本</dt><dd>{p.version??'—'}</dd><dt>来源</dt><dd>{p.builtin?'内置，随 WillYou 升级，可停用、不可卸载':<code>{p.external?.packageDirectory}</code>}</dd>{p.external&&<><dt>插件接口</dt><dd>{p.external.hostApi}</dd><dt>权限</dt><dd><ul>{p.external.permissions.map(x=><li key={x}>{x}</li>)}</ul><span className="m13-hint">在独立进程中运行，不能读写 WillYou 数据目录与密钥。</span></dd><dt>数据目录</dt><dd><code>{p.external.dataDirectory}</code></dd></>}</dl></section>
 </div>;
}
