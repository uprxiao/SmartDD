import {useQuery} from '@tanstack/react-query';
import {rpc} from '@renderer/lib/ipc';
import {unwrap} from './api';
import type {ApplicationId} from '@shared/application-connections';
import type {ApplicationSessionDiagnostic,SessionPluginDiagnostic} from '@shared/application-session-diagnostics';
import {AppDialog,AppEmpty} from './controls';

function SessionPluginRows({plugins}:{plugins:SessionPluginDiagnostic[]}){
 const label=(plugin:SessionPluginDiagnostic)=>plugin.state==='uninstalled'?'已卸载':plugin.state==='disabled'?'已停用，调用会被拒绝':plugin.state==='project-disabled'?'本项目已关闭，调用会被拒绝':plugin.state==='unavailable'?'当前不可用，调用会被拒绝':plugin.state!=='available'||!plugin.currentVersion?'可用状态待核查':plugin.currentVersion!==plugin.launchVersion?`可用 · 已更新到 ${plugin.currentVersion}，下一次调用即用新版本`:'可用';
 return <div className="m13-session-plugin-list">{plugins.map(plugin=><div className="m13-session-plugin-row" data-session-plugin={plugin.appId} key={plugin.appId}>
  <div className="m13-session-plugin-main"><b>{plugin.name}</b><span className="m10-package-version">本次启动时 v{plugin.launchVersion}</span><small>{plugin.connections.length?'连接：'+plugin.connections.map(connection=>connection.name??connection.id).join('、')+'（运行中继续用这个连接）':'无需连接'}</small></div>
  <span className={'m13-session-plugin-state '+(plugin.state==='available'?'ok':'warn')}>{label(plugin)}</span>
 </div>)}</div>;
}

function SessionWarnings({value}:{value:ApplicationSessionDiagnostic}){
 const messages:string[]=[];
 if(value.selection!=='fixed'){
  const selection=value.selection==='corrupt'?'固定能力快照损坏，保留原记录等待核查。':value.selection==='unsupported-schema'?'原能力快照格式暂不支持，请使用兼容版本。原记录已保留，不自动迁移或替换。':value.selection==='unknown-history'?'历史能力未知，不自动补入当前插件。':'本任务尚无已记录的固定能力。';
  messages.push(selection+'查看当前项目可用版本不表示本会话已选用。');
 }
 if(value.issues.length)messages.push('插件状态暂无法核实，原会话与配置已保留。');
 const run=value.currentRun?.current?value.currentRun:null;
 if(!run&&(value.agentState==='running'||value.currentRun))messages.push('当前没有可核实的插件运行证据，不按历史记录推断当前加载或使用结果。');
 if(run?.restriction){
  messages.push(run.restriction.reason==='managed_launch_payload_too_large'?'本次插件能力内容超过启动容量，已停用插件注入；Agent 可继续工作。':run.restriction.reason==='managed_capabilities_unavailable'?'本次插件能力未完成加载核验，已停用插件注入；Agent 可继续工作。':'原固定插件资源不可用，保留原会话继续工作；本次插件能力暂不可用，未改用其他版本。');
 }
 if(run?.restrictionIssue)messages.push('启动限制记录待核查，不推断插件就绪。');
 if(run?.runPlanIssue||run?.preparationIssue||run?.bridge.issueCode)messages.push('本次插件准备或连接状态暂无法核实，原会话已保留，不推断为就绪。');
 if(run?.skillObservationIssue)messages.push('Skill 历史证据不完整或已损坏，待核查。');
 if(value.applications.some(app=>app.issueCode==='AGENT_CAPABILITY_NAME_CONFLICT'))messages.push('本轮此插件与用户原生能力名称或启停配置冲突，保留用户配置及原会话选择；其他能力可继续使用。');
 if(run?.preparation?.schema===2&&run.preparation.capabilities.some(item=>item.kind!=='application'&&item.issueCode==='AGENT_CAPABILITY_NAME_CONFLICT'))messages.push('本轮 Skill 或 MCP 与用户原生能力名称或启停配置冲突，保留用户配置及原会话选择。');
 return <>{[...new Set(messages)].map(message=><p className="m10-note" role="status" key={message}>{message}</p>)}</>;
}

export function SessionApplicationsPanel({taskId,onClose,runIdentity=''}:{taskId:string;onClose:()=>void;runIdentity?:string;projectName?:string|null}){
 const query=useQuery({queryKey:['applications','session',taskId,runIdentity],queryFn:async()=>unwrap(await rpc.applications.session(taskId)),retry:false,refetchOnWindowFocus:false});
 const value=query.isFetching||query.error?undefined:query.data;
 const launchPlugins:SessionPluginDiagnostic[]=value?.selection==='fixed'?[...value.applications.filter(app=>app.fixedVersion!==null).map(app=>({appId:app.appId,name:app.name,launchVersion:app.fixedVersion!,currentVersion:app.defaultVersion,state:app.currentState??'unverified',connections:app.connections.filter(connection=>connection.originalId!==null).map(connection=>({slot:connection.slot,id:connection.originalId!,name:connection.originalName}))})),...(value.plugins??[])]:[];
 return <AppDialog title="会话插件" className="m10-session-dialog m13-session-compact" heading={<div><h2>会话插件</h2>{value&&<p className="m10-dialog-subtitle"><span data-testid="session-current-title">{value.title}</span></p>}</div>} onClose={onClose}>
  <div className="m10-session-applications" data-testid="session-applications">
   {query.isPending||query.isFetching?<AppEmpty loading title="正在读取会话插件" text="核对这个任务启动时的插件与当前状态。"/>:query.error?<AppEmpty error title="会话插件读取未完成" text={query.error.message} action="重试读取" onAction={()=>void query.refetch()}/>:value&&<>
    {launchPlugins.length?<SessionPluginRows plugins={launchPlugins}/>:value.selection==='fixed'&&<p className="m13-session-hint">这个任务启动时没有可用的插件。</p>}
    <SessionWarnings value={value}/>
    <p className="m13-session-hint">启动时已加载的 Skill 与 MCP 在重启会话后才按最新状态变化；插件调用立即按最新状态执行。</p>
   </>}
  </div>
  <footer className="m10-session-footer"><button className="m10-button primary" onClick={onClose}>完成</button></footer>
 </AppDialog>;
}
