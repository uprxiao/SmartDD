import {readSessionChangeImpact,sessionChangeMessage} from './session-change';
import {forwardRef,useImperativeHandle,useState} from 'react';
import {toast} from 'sonner';
import {useQuery} from '@tanstack/react-query';
import {FolderOpen,FileArchive,MoreHorizontal,Puzzle,RefreshCw,TriangleAlert} from 'lucide-react';
import {rpc} from '@renderer/lib/ipc';
import {unwrap,useApplicationAction,usePluginCatalog} from './api';
import {AppDialog,AppEmpty,AppSwitch,IconButton,useApplicationMenu} from './controls';
import './plugin-manager.css';
import {PluginPages} from './plugin-panel';
import {PluginConnectionsView} from './plugin-connections';

type Catalog=Extract<Awaited<ReturnType<typeof rpc.applications.pluginCatalog>>,{ok:true}>['value'];
type Review=NonNullable<Extract<Awaited<ReturnType<typeof rpc.applications.pluginChoose>>,{ok:true}>['value']>;
export interface PluginManagerHandle {choose(kind:'directory'|'zip'):void;update(appId:string):void;uninstall(appId:string):void}

/** P1's real install/lifecycle controls. The complete M13 catalog replaces the surrounding old entry in its later phase. */
export const PluginManager=forwardRef<PluginManagerHandle,{query:string;headless?:boolean;onInstalled?(appId:string):void}>(function PluginManager({query,headless=false,onInstalled},ref){
  const catalog=usePluginCatalog();
  const startup=useQuery({queryKey:['applications','plugin-startup'],queryFn:async()=>unwrap(await rpc.applications.pluginStartupStatus()),retry:false});
  const action=useApplicationAction(),[review,setReview]=useState<Review|null>(null),[sourceKind,setSourceKind]=useState<'directory'|'zip'>('directory');
  const [menu,setMenu]=useState<string|null>(null),[removing,setRemoving]=useState<Catalog[number]|null>(null),[deleteData,setDeleteData]=useState(false);
  const [opened,setOpened]=useState<string|null>(null),[configuring,setConfiguring]=useState<Catalog[number]|null>(null);
  const [updating,setUpdating]=useState<Catalog[number]|null>(null);
  useApplicationMenu(menu,()=>setMenu(null));
  const choose=async(kind:'directory'|'zip',target?:string)=>{
    setMenu(null);await action.run('inspect',async()=>{const next=unwrap(await rpc.applications.pluginChoose(kind,target));if(next){setSourceKind(kind);setReview(next);}},()=>false);
  };
  useImperativeHandle(ref,()=>({choose:kind=>{void choose(kind);},update:appId=>{const p=catalog.data?.find(p=>p.appId===appId);if(p)setUpdating(p);},uninstall:appId=>{const p=catalog.data?.find(p=>p.appId===appId);if(p){setDeleteData(false);setRemoving(p);}}}));
  const closeReview=()=>{if(action.busy)return;const old=review;setReview(null);if(old)void rpc.applications.pluginDiscard(old.token);};
  const install=async()=>{if(!review)return;const checked=review,appId=checked.plan.appId;let effect='';const ok=await action.run('install',async()=>{const impact=checked.plan.kind==='update'&&checked.plan.enabled?await readSessionChangeImpact({kind:'plugin',appId}):null;unwrap(await rpc.applications.pluginInstall(checked.token));if(impact)effect=sessionChangeMessage('plugin-update',impact);});setReview(null);if(ok){await catalog.refetch();if(checked.plan.kind==='update')toast.success(`${checked.displayName} 已更新到 ${checked.plan.nextVersion}${checked.plan.enabled?(effect?'；正在执行的调用按旧版完成，之后'+effect:''):'，仍为停用状态'}`);if(checked.plan.kind==='install')toast.success(`${checked.displayName} 已安装`);onInstalled?.(appId);}};
  const uninstall=async()=>{if(!removing)return;let effect='';const name=removing.displayName;const ok=await action.run('uninstall',async()=>{const impact=await readSessionChangeImpact({kind:'plugin',appId:removing.appId});unwrap(await rpc.applications.pluginUninstall(removing.appId,deleteData,removing.revision));effect=sessionChangeMessage('plugin-remove',impact);});if(ok){setRemoving(null);await catalog.refetch();toast.success(`${name} 已卸载；${effect}`);}};
  const items=catalog.data?.filter(p=>(p.displayName+' '+p.description+' '+p.appId).toLowerCase().includes(query.toLowerCase()))??[];
  const openedPlugin=catalog.data?.find(plugin=>plugin.appId===opened);
  return <section className={'m13-plugin-manager'+(headless?' headless':'')} aria-label="插件安装与管理">
    {!headless&&<div className="m10-section-heading"><h2>外部插件</h2><IconButton icon={RefreshCw} label="刷新外部插件" disabled={catalog.isFetching||!!action.busy} onClick={()=>void catalog.refetch()}/></div>}
    {action.error&&<p className="m10-error" role="alert">{action.error}</p>}
    {startup.data?.state==='failed'&&<p className="m10-error" role="alert">{startup.data.message}</p>}
    {action.busy==='inspect'&&<p role="status">正在检查插件包…</p>}
    {!headless&&(catalog.isPending?<p role="status">正在读取外部插件…</p>:catalog.error?<AppEmpty error title="外部插件加载失败" text={catalog.error.message} action="重试" onAction={()=>void catalog.refetch()}/>:items.length?<div className="m10-catalog-grid">{items.map(plugin=><article className="m10-catalog-item" key={plugin.appId}>
      <span className="m10-appmark" aria-hidden="true"><Puzzle size={23}/></span><div className="m13-plugin-copy"><strong>{plugin.displayName}<span className="m10-package-version">v{plugin.version}</span></strong><p>{plugin.description}</p><small>{plugin.skills.length} 个 Skill · {plugin.capabilities.length} 项能力</small>{plugin.paused&&<p role="status">插件进程异常退出，请重新启动。</p>}
      <button className="m10-button secondary" onClick={()=>setConfiguring(plugin)}>配置连接</button><AppSwitch checked={plugin.enabled} label={'启用插件'+plugin.displayName} disabled={!!action.busy} onChange={enabled=>void action.run('enable',async()=>{unwrap(await rpc.applications.pluginSetEnabled(plugin.appId,enabled,plugin.revision));})}/>{plugin.panels.length>0&&<button className="m10-button secondary" onClick={()=>setOpened(plugin.appId)}>打开插件页面</button>}</div>
      <div className="m10-menu-wrap"><IconButton icon={MoreHorizontal} label={'管理插件'+plugin.displayName} disabled={!!action.busy} expanded={menu===plugin.appId} onClick={()=>setMenu(menu===plugin.appId?null:plugin.appId)}/>{menu===plugin.appId&&<div className="m10-menu" role="menu"><button role="menuitem" onClick={()=>void choose('directory',plugin.appId)}>从文件夹更新…</button><button role="menuitem" onClick={()=>void choose('zip',plugin.appId)}>从 .zip 更新…</button>{plugin.paused&&<button role="menuitem" onClick={()=>{setMenu(null);void action.run('restart',async()=>{unwrap(await rpc.applications.pluginRestart(plugin.appId));});}}>重新启动</button>}<button role="menuitem" onClick={()=>{setMenu(null);setDeleteData(false);setRemoving(plugin);}}>卸载…</button></div>}</div>
    </article>)}</div>:<p className="m10-muted">{query?'没有匹配的外部插件':'还没有安装外部插件。通过上方“添加”选择本地文件夹或 .zip 插件包。'}</p>)}
    {!headless&&<p className="m10-muted">启停立即影响新的调用；会话中已加载的工具和 Skill 在重启会话后完全生效。</p>}
    {updating&&<AppDialog title={'更新 '+updating.displayName} onClose={()=>setUpdating(null)}><div className="m13-plugin-review"><p>当前版本 {updating.version}。选择此插件更高版本的本地文件夹或 .zip，检查变化后再更新。</p><button className="m10-button secondary" disabled={!!action.busy} onClick={()=>{const id=updating.appId;setUpdating(null);void choose('directory',id);}}><FolderOpen size={15}/>选择插件文件夹…</button><button className="m10-button secondary" disabled={!!action.busy} onClick={()=>{const id=updating.appId;setUpdating(null);void choose('zip',id);}}><FileArchive size={15}/>选择 .zip 文件…</button></div></AppDialog>}
    {openedPlugin&&<AppDialog title={openedPlugin.displayName} wide onClose={()=>setOpened(null)}>
      {openedPlugin.paused&&<div className="m13-plugin-runtime-notice" aria-label="插件运行状态"><p role="status">插件进程异常退出，请重新启动。</p><button className="m10-button secondary" disabled={!!action.busy} onClick={()=>void action.run('restart',async()=>{unwrap(await rpc.applications.pluginRestart(openedPlugin.appId));})}>{action.busy==='restart'?'正在重新启动…':'重新启动'}</button></div>}
      {action.error&&<p className="m10-error m13-plugin-page-error" role="alert">{action.error}</p>}
      <PluginPages plugin={openedPlugin} onNavigate={()=>setOpened(null)}/>
    </AppDialog>}
    {configuring?.hash&&<PluginConnectionsView target={{appId:configuring.appId,packageHash:configuring.hash}} onClose={()=>setConfiguring(null)}/>}
    {review&&<AppDialog title={(review.plan.kind==='update'?'更新 ':'安装 ')+review.displayName} onClose={closeReview} closingDisabled={!!action.busy} wide>
      <div className="m13-plugin-review"><p>{review.description}</p><dl><dt>来源</dt><dd>{sourceKind==='directory'?<FolderOpen size={15}/>:<FileArchive size={15}/>}本地{sourceKind==='directory'?'文件夹':'压缩包'}</dd><dt>发布者</dt><dd>{review.author?.name??'未提供'}</dd><dt>版本</dt><dd>{review.plan.previousVersion?review.plan.previousVersion+' → ':''}{review.plan.nextVersion}</dd><dt>插件接口</dt><dd>{String(review.hostApi)}</dd></dl>
      {review.plan.kind==='update'&&!review.plan.enabled&&<p>当前已停用，更新后仍保持停用，启用后才会生效。</p>}
      <h3>{review.plan.kind==='update'?'变化清单':'能力'}</h3>{review.plan.kind==='update'?<ul>{[['新增能力',review.plan.addedCapabilities],['删除能力',review.plan.removedCapabilities],['新增 Skill',review.plan.addedSkills],['删除 Skill',review.plan.removedSkills],['不再需要的权限',review.plan.removedPermissions]].map(([label,items])=><li key={String(label)}><strong>{label}</strong>：{(items as string[]).join('、')||'无'}</li>)}</ul>:<ul>{review.capabilities.map(c=><li key={c.id}>{c.title} · {c.semantics==='read'?'读取':'写入，需确认'}</li>)}</ul>}
      {review.plan.kind==='update'&&review.plan.addedPermissions.length>0&&<div className="m13-plugin-consent"><TriangleAlert size={16}/><div><strong>新增权限，点“更新”即表示同意</strong><ul>{review.plan.addedPermissions.map(permission=><li key={permission}>{permission}</li>)}</ul></div></div>}
      {review.plan.breakingCapabilities.length>0&&<p role="alert">老任务调用这些能力会失败：{review.plan.breakingCapabilities.join('、')}</p>}
      {review.plan.kind==='install'&&<><h3>自带 Skill</h3><p>{review.skills.join('、')||'无'}</p><h3>权限</h3><p>{review.permissions.join('、')||'未声明额外权限'}</p></>}
      <p className="m13-plugin-safety">插件独立进程运行，不能读写 WillYou 数据目录与密钥。插件包只读、私有数据可写、可联网；其他用户文件不在保护范围。请只安装信任来源的插件。</p>
      </div><footer className="m10-dialog-actions"><button className="m10-button secondary" disabled={!!action.busy} onClick={closeReview}>取消</button><button className="m10-button primary" disabled={!!action.busy} onClick={()=>void install()}>{action.busy==='install'?'正在处理…':review.plan.kind==='update'?'更新':'安装'}</button></footer>
    </AppDialog>}
    {removing&&<AppDialog title={'卸载 '+removing.displayName} onClose={()=>{if(!action.busy)setRemoving(null);}} closingDisabled={!!action.busy}><div className="m13-plugin-review"><label><input type="radio" name="plugin-uninstall" checked={!deleteData} onChange={()=>setDeleteData(false)}/>保留数据</label><p>保留连接和项目设置，可重新安装恢复。也可安装旧版本回退，但旧版本可能读不了新版本写入的数据。</p><label><input type="radio" name="plugin-uninstall" checked={deleteData} onChange={()=>setDeleteData(true)}/>删除数据</label><p>删除插件私有数据、连接、凭据与项目设置。历史任务和调用记录保留，插件将不可调用。</p></div><footer className="m10-dialog-actions"><button className="m10-button secondary" disabled={!!action.busy} onClick={()=>setRemoving(null)}>取消</button><button className="m10-button primary" disabled={!!action.busy} onClick={()=>void uninstall()}>{action.busy?'正在卸载…':'卸载'}</button></footer></AppDialog>}
  </section>;
});
