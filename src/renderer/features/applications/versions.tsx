import {useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {RefreshCw} from 'lucide-react';
import type {ApplicationId} from '@shared/application-connections';
import type {ApplicationVersionUsage} from '@shared/application-maintenance';
import {navigation} from '@renderer/core/navigation';
import {rpc} from '@renderer/lib/ipc';
import {unwrap,useApplicationAction} from './api';
import {AppDialog,AppEmpty} from './controls';
export const versionBytes=(n:number|null)=>n===null?'尚未测量':n<1024?n+' 字节':n<1024*1024?(n/1024).toFixed(1)+' KB':(n/1024/1024).toFixed(1)+' MB';
const integrityLabels={valid:'完整性已核对',invalid:'完整性异常',missing:'原文件缺失',removed:'文件已清理',unknown:'完整性待核查'};
const compatibleLabels={compatible:'宿主契约兼容',incompatible:'宿主契约不兼容',unknown:'运行依赖待核查'};
export function ApplicationVersionsPanel({appId}:{appId:ApplicationId}){
 const query=useQuery({queryKey:['applications','versions',appId],queryFn:async()=>unwrap(await rpc.applications.versions(appId)),retry:false,refetchOnWindowFocus:false});
 const action=useApplicationAction(),[references,setReferences]=useState<ApplicationVersionUsage|null>(null),[confirm,setConfirm]=useState<ApplicationVersionUsage|null>(null),[result,setResult]=useState('');
 const cleanup=async()=>{if(!confirm)return;const original=confirm;const done=await action.run('cleanup-'+original.packageHash,async()=>{const value=unwrap(await rpc.applications.cleanupVersion({appId,packageHash:original.packageHash,planHash:original.planHash}));setResult('已清理版本文件 '+versionBytes(value.removedFileBytes)+'；版本身份与业务数据保留。');});if(done)setConfirm(null);else await query.refetch();};
 return <section className="m10-section m10-versions" aria-label="版本与占用"><div className="m10-section-heading"><h2>版本与占用</h2><button className="m10-button secondary" disabled={query.isFetching||!!action.busy} onClick={()=>void query.refetch()}><RefreshCw size={13}/>检查占用</button></div><p className="m10-muted">新会话使用默认版本；旧会话与已删除任务保留的原生历史继续引用原版本。</p>
 {query.isPending?<AppEmpty loading title="正在核对版本占用" text="核对本机版本、历史引用与运行资源。"/>:query.error?<AppEmpty error title="版本占用未完成核对" text={query.error.message} action="重新检查" onAction={()=>void query.refetch()}/>:<>
 {!!query.data.recoveryPending&&<p className="m10-note" role="status">有 {query.data.recoveryPending} 项版本清理尚待恢复核查，相关版本继续保留。</p>}
 {!query.data.items.length&&<p className="m10-muted">本机尚无此应用的版本记录。</p>}
 <div className="m10-version-list">{query.data.items.map(item=><article className="m10-version-row" key={item.packageHash}><div className="m10-version-summary"><strong>v{item.version}{item.defaultForNewSessions&&<span className="m10-inline-label">新会话默认</span>}</strong><span>{item.sessionRefCount} 个会话 · {item.tombstoneRefCount} 个已删任务保留引用 · {item.activeRunCount} 个运行占用</span><small>版本原件 {versionBytes(item.sourceBytes)} · 派生资源 {versionBytes(item.projectionBytes)}</small><small>{integrityLabels[item.integrity]} · {compatibleLabels[item.compatibility]}</small><p className="m10-muted">{item.retentionReasons.join('；')||'没有保留引用，清理前会再次核对。'}</p>{item.issues.map(issue=><p className="m10-note" key={issue}>{issue}</p>)}</div><div className="m10-version-actions"><button className="m10-button secondary" onClick={()=>setReferences(item)}>查看引用 v{item.version}</button>{item.canCleanup&&<button className="m10-button secondary" disabled={!!action.busy||query.isFetching} onClick={()=>{action.setError('');setConfirm(item);}}>清理版本 v{item.version}</button>}</div></article>)}</div></>}
 {result&&<p className="m10-note" role="status">{result}</p>}{action.error&&!confirm&&<p className="m10-note" role="alert">{action.error}</p>}
 <p className="m10-muted">空间按文件字节计算。清理保留连接、草稿、发送记录和版本身份；共享依赖另按占用保留。</p>
 {references&&<AppDialog title={'版本 v'+references.version+' 的引用'} wide onClose={()=>setReferences(null)}><p>会话数按任务去重，已删除任务的原生历史引用单独保留。</p>{references.references.length?references.references.map(ref=><article className="m10-version-reference" key={ref.taskId}><strong>{ref.title??'已删除任务的原生历史'}</strong><span>{ref.runner} · {ref.deleted?'删除后保留':ref.retention==='hold'?'待核查':'会话保留'}</span>{ref.title&&<button className="m10-button secondary" onClick={()=>{setReferences(null);navigation.openTask(ref.taskId);}}>打开原任务</button>}</article>):<p>没有已确认的会话引用；其他保留依据仍按当前检查结果处理。</p>}<p className="m10-muted">{references.retentionReasons.join('；')}</p><footer><button className="m10-button secondary" onClick={()=>setReferences(null)}>关闭</button></footer></AppDialog>}
 {confirm&&<AppDialog title={'清理版本 v'+confirm.version} closingDisabled={!!action.busy} onClose={()=>{if(!action.busy)setConfirm(null);}}><p>清理这个非默认、已确认无引用的版本原件，预计移除 {versionBytes(confirm.reclaimableBytes)} 文件。不会删除连接、业务记录或历史身份；共享依赖继续保留。</p><p>执行前会再次核对占用。需要此版本时，必须从相同内容的可信完整包恢复。</p>{action.error&&<p className="m10-note" role="alert">{action.error}</p>}<footer><button className="m10-button secondary" disabled={!!action.busy} onClick={()=>setConfirm(null)}>取消</button><button className="m10-button primary" disabled={!!action.busy} onClick={()=>void cleanup()}>{action.busy?'正在清理…':'确认清理版本'}</button></footer></AppDialog>}
 </section>;
}
