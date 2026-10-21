import {ApplicationImpactView,impactReady} from './impact';
import {useState} from 'react';
import {ArrowUpRight,ChevronRight,Database,SquareTerminal,Zap} from 'lucide-react';
import type {ApplicationConnection,ApplicationId,ApplicationProvider,ProjectApplicationSelectionInput} from '@shared/application-connections';
import {observer} from 'mobx-react-lite';
import {navigation} from '@renderer/core/navigation';
import {tasksStore} from '@renderer/core/tasks-store';
import {rpc} from '@renderer/lib/ipc';
import {appNames,skillNames,unwrap,useApplicationImpact,useApplicationAction,useCatalog,useConnections,useProjectApplication,type CatalogItem} from './api';
import {AppDialog,AppEmpty,AppMark,AppSwitch,connectionState} from './controls';
type Project={id:string;name:string;archivedAt:number|null};
const sourceText=(connection:ApplicationConnection)=>connection.config.kind==='zentao'?connection.config.username+' · '+connection.config.baseUrl:connection.config.kind==='foxmail'?connection.config.account+' · '+connection.config.sourcePath:connection.config.fromAddress+' · '+connection.config.host;
export const ProjectApplications=observer(function ProjectApplications({project}:{project:Project}){
 const catalog=useCatalog();
 if(catalog.isPending)return <AppEmpty loading title="正在加载项目应用" text="正在读取本机应用与项目选用。"/>;
 if(catalog.error)return <AppEmpty error title="项目应用暂不可用" text={catalog.error.message} action="重试" onAction={()=>void catalog.refetch()}/>;
 return <div className="m10-project-apps" aria-label={project.name+'的应用'}><div className="m10-project-apps-intro"><div><h2>项目应用</h2><p>启用应用后，配套 Skill 与工具一起提供给本项目的新会话。</p></div><button className="m10-button secondary" onClick={()=>navigation.openApplications()}>管理应用<ArrowUpRight size={13}/></button></div>
  {catalog.data?.map(app=><ProjectApplication key={app.appId} app={app} project={project}/>)}
  <div className="m10-project-session-note"><SquareTerminal size={17}/><div><strong>新会话采用当前版本，恢复会话保留原版本</strong><p>连接和权限按当前配置检查；某项应用暂不可用不停止 Agent 的其他工作。升级不会替换旧会话的固定包。</p><span>首版目标：macOS arm64 · Claude Code / Codex · 仅 WillYou 内启动／恢复。</span></div><button className="m10-button secondary" disabled={project.archivedAt!==null} onClick={()=>navigation.newTask(project.id)}>新建任务<ArrowUpRight size={13}/></button></div>
  <div className="m10-local-data"><Database size={15}/><span>连接、草稿和记录独立保存在本机；项目导出不包含这些应用数据，导入后需在本机重新选用连接。</span></div>
 </div>;
});
const ProjectApplication=observer(function ProjectApplication({project,app}:{project:Project;app:CatalogItem}){
 const query=useProjectApplication(project.id,app.appId),connections=useConnections(app.appId),action=useApplicationAction(),[switchTo,setSwitchTo]=useState<ProjectApplicationSelectionInput|null>(null);
 const selection=query.data,disabled=project.archivedAt!==null||!app.added||!!action.busy||!selection||!!selection.pendingOperationId;
 const impact=useApplicationImpact(switchTo?{kind:'switch',projectId:project.id,expectedRevision:switchTo.expectedRevision}:null);
 const currentZen=connections.data?.find(c=>c.id===selection?.connections.zentao);
 const commit=async(input:ProjectApplicationSelectionInput)=>{const done=await action.run('selection',async()=>{unwrap(await rpc.applications.select(input));await tasksStore.refresh();});if(done)setSwitchTo(null);};
 const change=(slot:ApplicationProvider,id:string|null)=>{
  if(!selection||disabled)return;const next={projectId:project.id,appId:app.appId,expectedRevision:selection.revision,enabled:selection.enabled,connections:{...selection.connections,[slot]:id}};
  if(slot==='zentao'&&selection.connections.zentao&&selection.connections.zentao!==id){action.setError('');setSwitchTo(next);}else void commit(next);
 };
 const options=(slot:ApplicationProvider,label:string)=><fieldset><legend>{label}</legend><div className="m10-project-connections"><label><input type="radio" name={project.id+'-'+slot} aria-label={label+'不选用'} checked={!selection?.connections[slot]} disabled={disabled} onChange={()=>change(slot,null)}/><span><strong>不选用</strong><small>{slot==='smtp'?'仍可保存草稿；发送时需要有效发件账号。':'查询时提示来源未配置，不自动选择其他连接。'}</small></span></label>{connections.data?.filter(c=>c.providerId===slot).map(c=><label key={c.id}><input type="radio" name={project.id+'-'+slot} aria-label={'为'+project.name+'选用'+c.name} checked={selection?.connections[slot]===c.id} disabled={disabled} onChange={()=>change(slot,c.id)}/><span><strong title={c.name}>{c.name}</strong><small>{sourceText(c)}<br/>{connectionState(c)}{c.healthCode?' · '+c.healthCode:''}</small></span></label>)}</div></fieldset>;
 return <section className="m10-project-application"><header><AppMark app={app.appId}/><div><strong>{app.displayName}<span className="m10-package-version">v{app.version??'—'} · 新会话默认</span></strong><p>{app.skills.length} 个 Skill · 旧会话保留创建时的版本</p></div><span className={'m10-state '+(selection?.enabled&&app.enabled?'ready':'')}>{!app.added?'尚未添加':!app.enabled?'应用已全局停用':selection?.enabled?'项目已启用':'未启用'}</span><AppSwitch label={'为'+project.name+'启用'+appNames[app.appId]} checked={selection?.enabled??false} disabled={disabled} onChange={enabled=>selection&&void commit({projectId:project.id,appId:app.appId,enabled,expectedRevision:selection.revision,connections:selection.connections})}/></header>
  <div className="m10-project-application-body">{query.error||connections.error?<AppEmpty error title="无法读取项目选用" text={(query.error??connections.error)?.message??''} action="重新载入" onAction={()=>{void query.refetch();void connections.refetch();}}/>:query.isPending||connections.isPending?<p role="status">正在读取连接…</p>:<><p className="m10-muted">{app.appId==='zentao'?'每项目仅一个生效连接；停用或认证失败不会自动切换账号。':'每项目至多选择一个本地读取来源和一个 SMTP 发件账号，两者分别配置、分别选用。'}</p><div className="m10-mail-connections">{app.appId==='zentao'?options('zentao','禅道连接'):<>{options('foxmail','本地读取来源')}{options('smtp','SMTP 发件账号')}</>}</div></>}
   {!app.added&&<button className="m10-button secondary" onClick={()=>navigation.openApplications(app.appId,project.id)}>先添加{app.displayName}应用</button>}{selection?.pendingOperationId&&<p className="m10-note" role="status">项目连接变更尚未结束；保留已登记选择，完成后重新载入。</p>}
   {action.error&&<p className="m10-note" role="alert">{action.error}</p>}<div className="m10-project-skills"><Zap size={14}/><span>{app.skills.map(s=>skillNames[s.id]??s.id).join('、')}</span><small>随应用启用</small></div>
   <footer><button onClick={()=>navigation.openApplications(app.appId,project.id)}>查看应用与连接<ChevronRight size={13}/></button></footer>
  </div>
  {switchTo&&<AppDialog closingDisabled={!!action.busy} title="切换项目禅道连接" onClose={()=>{if(!action.busy)setSwitchTo(null);}}><p className="m10-modal-copy">{currentZen?.name??'当前连接'} → {connections.data?.find(c=>c.id===switchTo.connections.zentao)?.name??'不选用'}<br/>仅影响 {project.name}。停止此项目相关运行后提交；原引用保留原来源，停止失败保留原选择。</p><ApplicationImpactView query={impact}/>{action.error&&<p className="m10-note" role="alert">{action.error}</p>}<footer><button className="m10-button secondary" disabled={!!action.busy} onClick={()=>setSwitchTo(null)}>取消</button><button className="m10-button primary" disabled={!!action.busy||!impactReady(impact)} onClick={()=>{if(impactReady(impact))void commit(switchTo);}}>{action.busy?'正在停止并切换…':impactReady(impact)&&impact.data!.runs.length?'停止相关运行并切换':'切换连接'}</button></footer></AppDialog>}
 </section>;
});
