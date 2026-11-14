import {SenderIdentityStatus} from './sender-identity';
import {applicationCallFeedback} from '@shared/application-call-feedback';
import {ApplicationTerminalButton} from './terminal-insertion';
import {DeliveryCopies} from './delivery-copies';
import {useEffect,useRef,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {RefreshCw} from 'lucide-react';
import {rpc} from '@renderer/lib/ipc';
import {navigation} from '@renderer/core/navigation';
import {unwrap,skillNames,appNames} from './api';
import type {ApplicationId} from '@shared/application-connections';
import {applicationMetadata,applicationProviderMetadata} from '@shared/application-provider-metadata';
import {AppDialog,AppEmpty,AppMark,Field,timeText} from './controls';
import type {SessionRunDiagnostic,SessionPluginDiagnostic} from '@shared/application-session-diagnostics';
const healthLabel:Record<string,string>={healthy:'上次验证可用',unverified:'待检查',unavailable:'当前不可用',disabled:'已停用',disconnected:'已断开'};
function NewApplicationSession({title,projectId,onBack,onPrepared}:{title:string;projectId:string;onBack:()=>void;onPrepared:()=>void}){
 const [summary,setSummary]=useState(''),summaryInput=useRef<HTMLTextAreaElement>(null);
 // The child AppDialog establishes the native modal before this effect runs.
 useEffect(()=>{summaryInput.current?.focus();},[]);
 const prepare=()=>{
  if(summary.trim())navigation.prepareApplicationTask(projectId,summary);
  else navigation.newTask(projectId);
  onPrepared();
 };
 return <AppDialog title="使用当前版本新建会话" wide className="m10-session-dialog m10-session-summary" heading={<div><h2>使用当前版本新建会话</h2></div>} onClose={onBack}><div className="m10-session-applications" aria-label="新会话摘要">
  <p>原会话：{title}</p><p className="m10-muted">只带入你在此填写的文字，可在新会话输入框继续编辑。新会话在启动时使用项目当前版本，原会话保留。</p>
  <Field title="任务摘要（可选）"><textarea ref={summaryInput} rows={6} value={summary} onChange={event=>setSummary(event.target.value)} placeholder="填写要带入新会话的内容"/></Field>
 </div><div className="m10-session-footer"><button className="m10-button secondary" onClick={onBack}>返回原会话</button><button className="m10-button primary" onClick={prepare}>前往新会话输入框</button></div></AppDialog>;
}
function CapabilityPreparation({run}:{run:SessionRunDiagnostic}){
 const preparation=run.preparation;
 if(!preparation)return null;
 if(preparation.schema===1)return <p className="m10-muted">该运行未记录逐项准备证据；不从当前默认配置推断。</p>;
 const label={application:'插件', 'standard-skill':'独立 Skill','project-mcp':'项目 MCP'},sourceLabel={skill:'Skill',mcp:'MCP',plugin:'插件', 'native-tool':'原生工具','skill-config':'Skill 启停配置',projection:'投影路径',resource:'固定资源',policy:'项目设置'};
 return <details className="m10-runtime-demo"><summary>本次能力准备与冲突来源</summary><p className="m10-muted">仅记录准备结果，不证明 Agent 已发现或读取。以下为该运行准备时的选择与来源；不会修改用户配置。</p>{preparation.capabilities.map(item=><section key={item.kind+':'+item.id} aria-label={label[item.kind]+' '+item.name}><strong>{item.kind==='application'?(appNames[item.id as ApplicationId]??item.name):item.name}</strong><p>{label[item.kind]} · {run.restriction?'本轮已停用；保留原准备记录':run.restrictionIssue?'本轮启动限制待核查':item.state==='prepared'?'宿主已准备，使用未验证':item.state==='disabled'?'准备时已停用':item.state==='unverified'?'准备状态未核实':'本次未准备'}{item.issueCode?' · '+item.issueCode:''}</p>{item.sources.map((source,index)=><p className="m10-message-id" key={index}>{sourceLabel[source.kind]}：{source.name}<br/>{source.path?'目标／来源：'+source.path:'具体路径未记录'}{source.configurationPath&&<><br/>配置文件：{source.configurationPath}</>}{source.location==='profile-arguments'&&<><br/>来源：启动配置参数（不展示参数值）</>}{source.location==='unrecorded'&&<><br/>配置来源未记录</>}</p>)}</section>)}</details>;
}
function ApplicationConflictSources({run,appId}:{run:SessionRunDiagnostic|null;appId:string}){
 const [open,setOpen]=useState(false),preparation=run?.preparation,item=preparation?.schema===2?preparation.capabilities.find(i=>i.kind==='application'&&i.id===appId):undefined;
 return <><button className="m10-button secondary" aria-expanded={open} onClick={()=>setOpen(value=>!value)}>查看冲突</button>{open&&<div className="m10-note" role="status"><p>以下为本轮准备时记录的冲突来源；不会修改配置或重新启动 Agent。</p>{item?.sources.length?item.sources.map((source,index)=><p className="m10-message-id" key={index}>{source.name}<br/>{source.configurationPath?'配置文件：'+source.configurationPath:source.path?'来源路径：'+source.path:source.location==='profile-arguments'?'来源：启动配置参数（不展示参数值）':'具体配置路径未记录'}{source.configurationPath&&source.path&&<><br/>目标：{source.path}</>}</p>):<p>本轮未记录具体冲突来源，不从当前配置推断。</p>}</div>}</>;
}
function RunEvidence({run}:{run:SessionRunDiagnostic}){
 return <div className="m10-run-evidence"><p>运行阶段：{run.state} · {run.current?'当前所属终端':['stopped','failed'].includes(run.state)?'历史运行，不作为当前就绪依据':'运行归属或退出状态待核查，不作为当前就绪依据'}<br/>开始：{timeText(run.startedAt)}{run.endedAt&&<><br/>结束：{timeText(run.endedAt)}</>}</p><p>本次实际 CLI：{run.preparation?.cliVersion??'未记录'}<br/>宿主文件准备：{run.preparation?(run.preparation.state==='prepared'?'已记录，见原时间与资源核对':'本次能力未准备 · '+run.preparation.issueCode):run.preparationIssue?'证据损坏，待核查':'没有本次准备证据'}<br/>工具桥核验：{run.bridge.observedAt?'本运行曾通过内核对端核验 · '+timeText(run.bridge.observedAt):'未验证'}<br/>当前工具通道：{run.current?(run.bridge.connected?'当前连接有效':'当前未核实连接'):'历史记录'}</p>{run.restriction&&<p className="m10-note" role="status">{run.restriction.reason==='managed_launch_payload_too_large'?'本次插件能力内容超过启动容量，已停用插件注入；Agent 可继续工作。原文件准备记录保留，当前不代表插件可用。':run.restriction.reason==='managed_capabilities_unavailable'?'本次插件能力未完成加载核验，已停用插件注入；Agent 可继续工作。原会话选择与历史保留。':'原固定插件资源不可用，本次保留原会话继续工作；插件能力暂不可用，未改用其他版本。'}<br/>停用时间：{timeText(run.restriction.restrictedAt)}</p>}{run.restrictionIssue&&<p className="m10-note" role="alert">启动限制记录待核查，不推断插件就绪。</p>}{(run.preparationIssue||run.bridge.issueCode)&&<p className="m10-note" role="alert">{run.preparationIssue??run.bridge.issueCode} · 保留原记录，未推断为就绪。</p>}{run.skillObservationIssue&&<p className="m10-note" role="alert">Skill 历史证据不完整或已损坏，待核查。</p>}{!!run.skillObservations?.length&&<details><summary>本运行 Skill 观察记录</summary><p className="m10-muted">仅表示原运行曾观察到的证据，不作为当前运行就绪依据。</p>{run.skillObservations.map(item=><p className="m10-message-id" key={item.appId+item.skillId+item.kind}>{item.appId} / {item.skillId} · {item.kind==='read'?'正文读取':'原生清单发现'}<br/>{item.observedAt} · CLI {item.cliVersion}<br/>所属运行：{item.runId}<br/>记录校验：{item.recordHash}</p>)}</details>}<CapabilityPreparation run={run}/><details><summary>运行追溯与配置路径</summary><p className="m10-message-id">运行：{run.id}<br/>固定选择：{run.preparation?.selectionHash??'未记录'}<br/>适配器：{run.preparation?.adapterHash??'未记录'}<br/>准备时间：{timeText(run.preparation?.preparedAt)}</p>{run.preparation&&<><p className="m10-message-id">准备清单：{run.preparation.manifestPath}</p>{run.preparation.configPaths.map(path=><p className="m10-message-id" key={path}>MCP 配置：{path}</p>)}</>}</details></div>;
}
const LEVEL_TITLE:Record<string,string>={'L0.skill':'Skill 已交付','L0.mcp':'MCP 可交付','L0.cli':'CLI 可交付（含沙箱放行）',L1:'调用身份可核验',L2:'已验证发现／读取',L3:'聊天原话授权'};
const LEVEL_STATE:Record<string,string>={declared:'已声明','best-effort':'尽力交付 · 未验证',unverified:'未验证'};
const ENTRY:Record<string,string>={mcp:'MCP',cli:'CLI',mixed:'MCP＋CLI',unavailable:'无'};
function RunPlan({run}:{run:SessionRunDiagnostic}){
 if(run.runPlanIssue)return <p className="m10-note" role="alert">本次运行计划无法核验，保留原记录等待核查；不按当前配置推断入口或适配等级。</p>;
 const plan=run.runPlan;if(!plan)return null;
 return <section className="m10-run-plan" aria-label="本次运行计划"><header><strong>本次运行计划</strong><small className="m10-muted">Codex {plan.cliVersion} · {plan.verified?'已声明版本':'未声明版本，按降级处理'} · 启动时固定，运行中不切换入口</small></header>
  <ul className="m10-level-list" aria-label="适配等级">{plan.levels.map(item=><li key={item.level} data-state={item.state}><code>{item.level}</code><span>{LEVEL_TITLE[item.level]}</span><small>{LEVEL_STATE[item.state]}</small></li>)}</ul>
  {!plan.nativeSendEvidence&&<p className="m10-muted">{plan.levels.some(item=>item.level==='L2'&&item.state==='declared')?'聊天原话授权在此版本上尚未验证，保持关闭：发送使用页面授权。':'聊天原话授权与「已确认读取 Skill」在此版本上尚未验证，保持关闭：发送使用页面授权。'}</p>}
  {plan.applications.map(app=><div key={app.appId} className="m10-plan-app" data-active={app.effectiveEntry==='unavailable'?'none':app.effectiveEntry}><strong>{appNames[app.appId as ApplicationId]??app.appId}</strong><span className="m10-state">{app.effectiveEntry==='unavailable'?'本次运行不可用':'生效入口 · '+ENTRY[app.effectiveEntry]}</span>{app.fallback&&<p className="m10-note" role="status">已降级为只读 {ENTRY[app.effectiveEntry]}：{app.reason??'主入口本次不可交付'}</p>}{app.effectiveEntry==='unavailable'&&app.reason&&<p className="m10-note" role="alert">{app.reason}</p>}<small className="m10-muted">服务端只放行本次生效入口；调用另一入口会被拒绝。</small></div>)}
 </section>;
}
function SessionPluginRows({plugins}:{plugins:SessionPluginDiagnostic[]}){
 const label=(plugin:SessionPluginDiagnostic)=>plugin.state==='uninstalled'?'已卸载':plugin.state==='disabled'?'已停用，调用会被拒绝':plugin.state==='project-disabled'?'本项目已关闭，调用会被拒绝':plugin.state==='unavailable'?'当前不可用，调用会被拒绝':plugin.state!=='available'||!plugin.currentVersion?'可用状态待核查':plugin.currentVersion!==plugin.launchVersion?`可用 · 已更新到 ${plugin.currentVersion}，下一次调用即用新版本`:'可用';
 return <div className="m13-session-plugin-list">{plugins.map(plugin=><div className="m13-session-plugin-row" data-session-plugin={plugin.appId} key={plugin.appId}>
  <div className="m13-session-plugin-main"><b>{plugin.name}</b><span className="m10-package-version">本次启动时 v{plugin.launchVersion}</span><small>{plugin.connections.length?'连接：'+plugin.connections.map(connection=>connection.name??connection.id).join('、')+'（运行中继续用这个连接）':'无需连接'}</small></div>
  <span className={'m13-session-plugin-state '+(plugin.state==='available'?'ok':'warn')}>{label(plugin)}</span>
 </div>)}</div>;
}
export function SessionApplicationsPanel({taskId,onClose,runIdentity='',}:{taskId:string;onClose:()=>void;runIdentity?:string;projectName?:string|null}){
 const query=useQuery({queryKey:['applications','session',taskId,runIdentity],queryFn:async()=>unwrap(await rpc.applications.session(taskId)),retry:false,refetchOnWindowFocus:false});
 const [notice,setNotice]=useState(''),[newSessionFor,setNewSessionFor]=useState<string|null>(null);const value=query.isFetching||query.error?undefined:query.data;
 const launchPlugins:SessionPluginDiagnostic[]=value?[...value.applications.filter(app=>app.fixedVersion!==null).map(app=>({appId:app.appId,name:app.name,launchVersion:app.fixedVersion!,currentVersion:app.defaultVersion,state:app.currentState??'unverified',connections:app.connections.filter(connection=>connection.originalId!==null).map(connection=>({slot:connection.slot,id:connection.originalId!,name:connection.originalName}))})),...(value.plugins??[])]:[];
 const configure=(app:ApplicationId)=>{if(!value)return;onClose();navigation.openApplications(app,value.projectId??undefined);};
 if(newSessionFor===taskId&&query.data?.canNewSession&&query.data.projectId)return <NewApplicationSession key={taskId} title={query.data.title} projectId={query.data.projectId} onBack={()=>setNewSessionFor(null)} onPrepared={onClose}/>;
 return <AppDialog title="会话插件" className="m10-session-dialog m13-session-compact" heading={<div><h2>会话插件</h2>{value&&<p className="m10-dialog-subtitle"><span data-testid="session-current-title">{value.title}</span></p>}</div>} onClose={onClose}><div className="m10-session-applications" data-testid="session-applications">
 {query.isPending||query.isFetching?<AppEmpty loading title="正在核对原会话" text="读取固定版本、本次运行与独立证据。"/>:query.error?<AppEmpty error title="会话诊断未完成" text={query.error.message} action="重试读取" onAction={()=>void query.refetch()}/>:value&&<>
 {launchPlugins.length?<SessionPluginRows plugins={launchPlugins}/>:<p className="m13-session-hint">这个任务启动时没有可用的插件。</p>}
 <p className="m13-session-hint">启动时已加载的 Skill 与 MCP 在重启会话后才按最新状态变化；插件调用立即按最新状态执行。</p>
 <details className="m13-session-diagnostics" data-session-diagnostics><summary>诊断与管理</summary>
 <p>Agent 终端：{value.agentState==='running'?'运行中':value.agentState==='stopped'?'已停止':'状态未核实'}</p><p className="m10-muted">启动时的插件和连接按原记录显示；插件当前不可用时，Agent 可以继续工作。</p>
 {value.selection!=='fixed'&&<p className="m10-note" role="status">{value.selection==='corrupt'?'固定能力快照损坏，保留原记录等待核查。':value.selection==='unsupported-schema'?'原能力快照格式暂不支持，请使用兼容版本。原记录已保留，不自动迁移或替换。':value.selection==='unknown-history'?'历史能力未知，不自动补入当前插件。':'本任务尚无已记录的固定能力。'}查看当前项目可用版本不表示本会话已选用。</p>}
 {!!value.issues.length&&<p className="m10-note" role="alert">{value.issues.join('、')} · 请核对原资源；本页不会换版、启动或重启 Agent。</p>}
 {value.currentRun?<section aria-label="当前运行证据"><h3>当前运行证据</h3><RunPlan run={value.currentRun}/><RunEvidence run={value.currentRun}/></section>:<p className="m10-note">当前没有可核实的插件运行证据。历史证据不作为当前加载或使用结果。</p>}
 {!value.applications.length&&!value.plugins?.length&&<p>本会话未选用插件；项目当前也没有启用插件。</p>}
 {value.applications.map(app=><section className="m10-session-app" aria-label={app.name+'会话插件'} key={app.appId}><header><AppMark app={app.appId}/><div><strong>{app.name}<span className="m10-package-version">{app.fixedVersion?'固定资源 v'+app.fixedVersion:'本会话未选用'}</span></strong><small>当前插件 {app.defaultVersion?'v'+app.defaultVersion:'尚未就绪'} · 当前项目{app.policy==='enabled'?'已启用':app.policy==='disabled'?'未启用':'状态待核查'}</small></div><span className="m10-state">{app.issueCode?'插件能力不可用':app.resourceState==='verified'?'原资源已核对':'准备未核实'}</span></header><p>原固定资源：{app.resourceState==='verified'?'本次检查完整':app.resourceState==='unavailable'?'当前不可用':'未核实'}{app.issueCode?' · '+app.issueCode:''}</p>
 {app.issueCode==='AGENT_CAPABILITY_NAME_CONFLICT'&&<><p className="m10-note" role="status">本轮此插件与用户原生能力名称或启停配置冲突，保留用户配置及原会话选择；其他能力可继续使用。</p><ApplicationConflictSources key={(value.currentRun?.id??'unrecorded')+':'+app.appId} run={value.currentRun} appId={app.appId}/></>}
 <p>Agent 发现 Skill：{app.evidence.skillDiscovery==='verified'?'已核验本次原生清单':'未验证'}<br/>Agent 读取 Skill：{app.evidence.skillRead==='verified'?'已核验本次原生读取':'未验证'}<br/>本次运行工具请求：{app.evidence.toolRequests} 次，调用完成 {app.evidence.successfulToolRequests} 次</p><p className="m10-muted">文件或工具桥准备不证明 Agent 发现／读取 Skill；调用完成也不代表外部写操作已成功。</p>
 {!!app.evidence.skillDiscoveryObservations?.length&&<details><summary>本次 Skill 发现证据</summary>{app.evidence.skillDiscoveryObservations.map(item=><p className="m10-message-id" key={item.skillId+item.callId}>{item.skillId}<br/>时间：{item.observedAt}<br/>所属运行：{item.runId}<br/>记录校验：{item.recordHash}</p>)}</details>}
 {!!app.evidence.skillReadObservations?.length&&<details><summary>本次 Skill 读取证据</summary>{app.evidence.skillReadObservations.map(read=><p className="m10-message-id" key={read.skillId+read.callId}>{read.skillId}<br/>时间：{read.observedAt}<br/>所属运行：{read.runId}<br/>记录校验：{read.recordHash}</p>)}</details>}
 {app.evidence.latestErrorCode&&<p className="m10-note" role="status" aria-label={app.name+'最近调用结果'}>{applicationCallFeedback(app.evidence.latestErrorCode,app.evidence.latestEffectState,app.evidence.latestAttemptCount)}</p>}
 {app.connections.map(connection=><p key={connection.slot}>{applicationProviderMetadata(connection.slot).diagnosticTitle??applicationProviderMetadata(connection.slot).project.title}：{connection.name??(connection.id?'原连接':'未选用')} · {healthLabel[connection.health]??'待核查'}<br/><small>创建时：{connection.originalName??(connection.originalId?'原连接身份 '+connection.originalId:'未选用')}<br/>相对创建时选用：{connection.selection==='same'?'原身份':connection.selection==='changed'?'已变化':connection.selection==='missing'?'未选用':'待核查'} · 原包配置{connection.compatibility==='compatible'?'兼容':connection.compatibility==='incompatible'?'不兼容':'兼容性待核查'}{connection.issueCode?' · '+connection.issueCode:''}</small></p>)}
 {value.projectId&&applicationMetadata(app.appId).presentation.projectPolicy==='sender-identity'&&<SenderIdentityStatus projectId={value.projectId} appId={app.appId} readOnly/>}
 {value.projectId&&app.skills.map(skill=><ApplicationTerminalButton key={skill.id} projectId={value.projectId!} source={{kind:'skill',appId:app.appId,skillId:skill.id}} onInserted={onClose} disabled={!!app.issueCode||app.resourceState!=='verified'||value.currentRun?.preparation?.state!=='prepared'||!!value.currentRun?.restriction||!!value.currentRun?.restrictionIssue} label="插入示例到终端" variant="example"/>)}<details className="m10-session-sources"><summary>固定包与 Skill 来源</summary><p className="m10-message-id">包：{app.packageHash??'本会话未选用'}</p>{app.skills.map(skill=><p className="m10-message-id" key={skill.id}>{skillNames[skill.id]??skill.id}<br/>内容：{skill.sourceHash}<br/>原投影：{skill.projectionPath}</p>)}</details><button className="m10-button secondary" onClick={()=>configure(app.appId)}>检查{app.name}与连接</button></section>)}
 <DeliveryCopies value={value.deliveryCopies}/>
 {!!value.recentRuns.length&&<details><summary>最近 {value.recentRuns.length} 次{value.recentRuns.some(run=>!['stopped','failed'].includes(run.state))?'其他运行记录':'历史运行证据'}</summary>{value.recentRuns.map(run=><section className="m10-session-history" key={run.id}><RunEvidence run={run}/></section>)}</details>}
 <p className="m10-muted">创建时 CLI：{value.createdCliVersion??'未记录'} · 最近检查：{timeText(value.checkedAt)}</p>
 <div className="m13-session-diagnostics-actions">{value?.projectId&&<button className="m10-button secondary" onClick={()=>{onClose();navigation.openProject(value.projectId!,"applications");}}>项目插件</button>}{value&&<button className="m10-button secondary" onClick={()=>void navigator.clipboard.writeText(JSON.stringify(value,null,2)).then(()=>setNotice('已复制脱敏诊断信息'),()=>setNotice('复制未完成，可展开追溯信息查看'))}>复制脱敏诊断</button>}<button className="m10-button secondary" disabled={query.isFetching} onClick={()=>void query.refetch()}><RefreshCw size={13}/>重新核对</button>{value?.canNewSession&&value.projectId&&<button className="m10-button primary" onClick={()=>setNewSessionFor(taskId)}>使用当前版本新建会话</button>}</div>
 </details>
 </>}
 </div>{notice&&<p className="m10-note" role="status">{notice}</p>}<footer className="m10-session-footer"><button className="m10-button primary" onClick={onClose}>完成</button></footer></AppDialog>;
}
