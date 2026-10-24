import {useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {RefreshCw} from 'lucide-react';
import type {ApplicationId} from '@shared/application-connections';
import type {ApplicationVersionUsage,ApplicationUpgradeReport,ApplicationUpgradeImpact,ApplicationUpgradeIssue} from '@shared/application-maintenance';
import {navigation} from '@renderer/core/navigation';
import {rpc} from '@renderer/lib/ipc';
import {unwrap,useApplicationAction} from './api';
import {AppDialog,AppEmpty} from './controls';
export const versionBytes=(n:number|null)=>n===null?'尚未测量':n<1024?n+' 字节':n<1024*1024?(n/1024).toFixed(1)+' KB':(n/1024/1024).toFixed(1)+' MB';
const integrityLabels={valid:'完整性已核对',invalid:'完整性异常',missing:'原文件缺失',removed:'文件已清理',unknown:'完整性待核查'};
const compatibleLabels={compatible:'宿主契约兼容',incompatible:'宿主契约不兼容',unknown:'运行依赖待核查'};
export function ApplicationVersionsPanel({appId}:{appId:ApplicationId}){
 const query=useQuery({queryKey:['applications','versions',appId],queryFn:async()=>unwrap(await rpc.applications.versions(appId)),retry:false,refetchOnWindowFocus:false});
 const action=useApplicationAction(),[references,setReferences]=useState<ApplicationVersionUsage|null>(null),[confirm,setConfirm]=useState<ApplicationVersionUsage|null>(null),[result,setResult]=useState(''),[cancelConfirm,setCancelConfirm]=useState<ApplicationVersionUsage|null>(null);
 const cleanup=async()=>{if(!confirm)return;const original=confirm;const done=await action.run('cleanup-'+original.packageHash,async()=>{const value=unwrap(await rpc.applications.cleanupVersion({appId,packageHash:original.packageHash,planHash:original.planHash}));setResult('已清理版本文件 '+versionBytes(value.removedFileBytes)+'；版本身份与业务数据保留。');});if(done)setConfirm(null);else await query.refetch();};
 const cancelCleanup=async()=>{if(!cancelConfirm?.cleanupRecovery)return;const original=cancelConfirm,recovery=original.cleanupRecovery!;const done=await action.run('cancel-cleanup-'+recovery.operationId,async()=>{unwrap(await rpc.applications.cancelCleanup({appId:original.appId,packageHash:original.packageHash,operationId:recovery.operationId,planHash:recovery.planHash}));setResult('已取消本次清理，完整原版本保留；默认版本和业务数据不变。');});if(done)setCancelConfirm(null);else await query.refetch();};
 return <section className="m10-section m10-versions" aria-label="版本与占用"><div className="m10-section-heading"><h2>版本与占用</h2><button className="m10-button secondary" disabled={query.isFetching||!!action.busy} onClick={()=>void query.refetch()}><RefreshCw size={13}/>检查占用</button></div><p className="m10-muted">新会话使用默认版本；旧会话与已删除任务保留的原生历史继续引用原版本。</p>
 {query.isPending?<AppEmpty loading title="正在核对版本占用" text="核对本机版本、历史引用与运行资源。"/>:query.error?<AppEmpty error title="版本占用未完成核对" text={query.error.message} action="重新检查" onAction={()=>void query.refetch()}/>:<>
 <UpgradeStatus report={query.data.upgrade}/>
 {!!query.data.recoveryPending&&<p className="m10-note" role="status">有 {query.data.recoveryPending} 项版本清理尚待恢复核查，相关版本继续保留。</p>}
 {!query.data.items.length&&<p className="m10-muted">本机尚无此应用的版本记录。</p>}
 <div className="m10-version-list">{query.data.items.map(item=><article className="m10-version-row" key={item.packageHash}><div className="m10-version-summary"><strong>v{item.version}{item.defaultForNewSessions&&<span className="m10-inline-label">新会话默认</span>}</strong><span>{item.sessionRefCount} 个会话 · {item.tombstoneRefCount} 个已删任务保留引用 · {item.activeRunCount} 个运行占用</span><small>版本原件 {versionBytes(item.sourceBytes)} · 派生资源 {versionBytes(item.projectionBytes)}</small><small>{integrityLabels[item.integrity]} · {compatibleLabels[item.compatibility]}</small><p className="m10-muted">{item.retentionReasons.join('；')||'没有保留引用，清理前会再次核对。'}</p>{item.issues.map(issue=><p className="m10-note" key={issue}>{issue}</p>)}{item.cleanupRecovery&&<p className="m10-note" role="status">{item.cleanupRecovery.canCancel?'原版本文件完整；可保留版本并取消本次清理。':cleanupRecoveryReason(item.cleanupRecovery.issueCode)}</p>}</div><div className="m10-version-actions"><button className="m10-button secondary" onClick={()=>setReferences(item)}>查看引用 v{item.version}</button>{item.canCleanup&&<button className="m10-button secondary" disabled={!!action.busy||query.isFetching} onClick={()=>{action.setError('');setConfirm(item);}}>清理版本 v{item.version}</button>}{item.cleanupRecovery?.canCancel&&<button className="m10-button secondary" disabled={!!action.busy||query.isFetching} onClick={()=>{action.setError('');setCancelConfirm(item);}}>保留版本，取消清理 v{item.version}</button>}</div></article>)}</div></>}
 {result&&<p className="m10-note" role="status">{result}</p>}{action.error&&!confirm&&!cancelConfirm&&<p className="m10-note" role="alert">{action.error}</p>}
 <p className="m10-muted">空间按文件字节计算。清理保留连接、草稿、发送记录和版本身份；共享依赖另按占用保留。</p>
 {references&&<AppDialog title={'版本 v'+references.version+' 的引用'} wide onClose={()=>setReferences(null)}><p>会话数按任务去重，已删除任务的原生历史引用单独保留。</p>{references.references.length?references.references.map(ref=><article className="m10-version-reference" key={ref.taskId}><strong>{ref.title??'已删除任务的原生历史'}</strong><span>{ref.runner} · {ref.deleted?'删除后保留':ref.retention==='hold'?'待核查':'会话保留'}</span>{ref.title&&<button className="m10-button secondary" onClick={()=>{setReferences(null);navigation.openTask(ref.taskId);}}>打开原任务</button>}</article>):<p>没有已确认的会话引用；其他保留依据仍按当前检查结果处理。</p>}<p className="m10-muted">{references.retentionReasons.join('；')}</p><footer><button className="m10-button secondary" onClick={()=>setReferences(null)}>关闭</button></footer></AppDialog>}
 {confirm&&<AppDialog title={'清理版本 v'+confirm.version} closingDisabled={!!action.busy} onClose={()=>{if(!action.busy)setConfirm(null);}}><p>清理这个非默认、已确认无引用的版本原件，预计移除 {versionBytes(confirm.reclaimableBytes)} 文件。不会删除连接、业务记录或历史身份；共享依赖继续保留。</p><p>执行前会再次核对占用。需要此版本时，必须从相同内容的可信完整包恢复。</p>{action.error&&<p className="m10-note" role="alert">{action.error}</p>}<footer><button className="m10-button secondary" disabled={!!action.busy} onClick={()=>setConfirm(null)}>取消</button><button className="m10-button primary" disabled={!!action.busy} onClick={()=>void cleanup()}>{action.busy?'正在清理…':'确认清理版本'}</button></footer></AppDialog>}
 {cancelConfirm&&<AppDialog title={'保留版本 v'+cancelConfirm.version+'，取消清理'} closingDisabled={!!action.busy} onClose={()=>{if(!action.busy)setCancelConfirm(null);}}><p>核对原操作及完整文件后，取消这一次清理并保留原版本。不会改变默认版本、历史会话或业务数据。</p><p>原路径被其他目录占用、文件已部分删除或进程状态未核实时，将保留现场并说明原因。</p>{action.error&&<p className="m10-note" role="alert">{action.error}</p>}<footer><button className="m10-button secondary" disabled={!!action.busy} onClick={()=>setCancelConfirm(null)}>返回</button><button className="m10-button primary" disabled={!!action.busy} onClick={()=>void cancelCleanup()}>{action.busy?'正在核对并保留…':'保留版本，取消清理'}</button></footer></AppDialog>}
 </section>;
}

function cleanupRecoveryReason(code:string|null){return code==='HASH_MISMATCH'?'原版本文件已部分或全部清理，不能直接恢复为可用；保留现场，等待恢复核查。':code==='OWNERSHIP_CONFLICT'?'原路径或暂存目录被其他内容占用，保留双方内容，不覆盖。':code==='RESOURCE_BUSY'?'原清理或取消进程尚未确认退出，保留现场。':code==='CAPABILITY_UNAVAILABLE'?'当前环境尚未验证原目录完整恢复，保留现场。':'本次清理尚待恢复核查，原版本继续保持不可用。';}

const upgradeReasons:Record<string,string>={INSUFFICIENT_SPACE:'可用磁盘空间不足',DEFAULT_CHANGED:'默认版本已变化，需要重新核对',DUPLICATE_APPLICATION:'升级目标存在重复应用',HISTORICAL_REFERENCE_UNVERIFIED:'历史会话引用尚未核验',CONNECTION_CONTRACT_UNVERIFIED:'连接配置与所用版本的兼容性尚未核验',RETAINED_PACKAGE_INCOMPATIBLE:'保留版本与当前宿主不兼容或无法核验'};
function UpgradeStatus({report}:{report?:ApplicationUpgradeReport}){
 if(!report)return null;
 if(report.state==='unavailable')return <p className="m10-note" role="status">升级状态无法核验。请重新检查；原默认版本和历史会话保留。</p>;
 if(!report.targets.length)return <p className="m10-muted">当前分发没有待切换的应用版本。</p>;
 if(!report.preflight)return <p className="m10-note" role="status">升级条件尚未核验。请重新检查；原默认版本和历史会话保留。</p>;
 return <section className="m10-note m10-upgrade-report" aria-label="升级预检"><strong>{report.preflight?.issues.length?'升级暂未执行':'升级预检已通过，等待维护时切换'}</strong><p>本次整组目标：{report.targets.map(t=>(t.appId==='mail'?'邮件':t.appId==='zentao'?'禅道':t.appId)+' v'+t.version).join('、')}。</p>{report.preflight.issues.map((issue,i)=>{const detail=report.impacts?.[i];return <UpgradeImpact key={i} issue={issue} detail={detail?.code===issue.code&&detail.packageHash===issue.packageHash&&detail.taskId===issue.taskId&&detail.connectionId===issue.connectionId?detail:undefined}/>;})}<p>原默认版本、历史会话和业务数据保留。修复原因后重新检查；检查不会执行升级。</p></section>;
}

const upgradeCauseLabels:Record<string,string>={HOST_INCOMPATIBLE:'当前程序不支持原版本的Host／Data API契约',CONFIG_INCOMPATIBLE:'连接配置不能等价转换为原版本契约或认证方式不受支持',CONFIG_COMPATIBILITY_UNVERIFIED:'缺少可核验的原连接契约或配置转换器',AUTH_REQUIRED:'服务与账号身份尚未核验',HASH_MISMATCH:'原版本内容或引用身份不符',NOT_FOUND:'原版本资源未找到，历史引用继续保留',CAPABILITY_UNAVAILABLE:'原版本资源或依赖尚未核验'};
const upgradeActionLabels:Record<string,string>={'zentao.read':'查询本人 Bug／Story 与详情','mail.read':'读取邮件、正文及附件','mail.draft':'处理本地草稿','mail.send':'发送邮件'};
function UpgradeImpact({issue,detail}:{issue:ApplicationUpgradeIssue;detail?:ApplicationUpgradeImpact}){
 const reason=issue.causeCode&&upgradeCauseLabels[issue.causeCode]||upgradeReasons[issue.code]||'升级条件尚未核验';
 return <article className="m10-version-reference">
 {issue.packageHash&&<strong>{detail?.appName&&detail.version?detail.appName+' v'+detail.version+(issue.taskId?' · 原版本':detail.target?' · 升级目标':' · 版本'):'原版本待核验'}</strong>}
 <p>{reason}</p>
 {issue.taskId&&<span>会话：{detail?.taskTitle??'历史会话（任务已删除或无法读取）'}</span>}
 {issue.connectionId&&<span>连接：{detail?.connectionName??'连接名称待核验'}</span>}
 {(issue.packageHash||issue.taskId||issue.connectionId)&&<span>{detail?.target?'目标包声明动作：':'动作范围：'}{detail?.verified&&detail.operations!==null?(detail.operations.length?detail.operations.map(permission=>upgradeActionLabels[permission]??'未识别动作 '+permission).join('、'):'原会话未授权此连接动作'):'待核验'}{detail?.scope==='connection'?'（依赖此连接的部分）':''}</span>}
 {detail?.scope==='connection'&&<small>连接问题只影响依赖该连接的操作；独立能力仍按当前权限使用。</small>}
 <small>{[issue.packageHash&&'版本标识 '+issue.packageHash,issue.taskId&&'会话标识 '+issue.taskId,issue.connectionId&&'连接标识 '+issue.connectionId].filter(Boolean).join(' · ')}</small>
 </article>;
}
