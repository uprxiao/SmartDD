import {PrototypeAttachment} from './PrototypeAttachment';
import {useEffect,useRef,useState} from 'react';
import {activityCategory, activityDemoState, activityError, activitySource, demoActivityRecovery, filterDemoActivity} from './activity-prototype-model.mjs';
// Reuse the existing synthetic response owner;this never verifies a connection.
import {createPreviewConnectionChecks as createPreviewActivityReads} from './connection-preflight-preview.mjs';

const stateLabel = item => ({success:item.category === 'write' ? '已提交到邮件服务器' : '调用完成',failed:'调用失败',unknown:'调用结果未知',sending:'原提交尚无最终结果',draft:'草稿',handoff:'已交给客户端'})[item.status];
export function ReadControls({hold,setHold,listError,setListError,detailError,setDetailError,stats,release,className='m10-activity-read-preview'}){
 return <details className={className}><summary>读取演示控制 · 仅合成</summary><label className="m10-check"><input aria-label="暂存演示读取响应" type="checkbox" checked={hold} onChange={e=>setHold(e.target.checked)}/>暂存新读取，稍后交回 · 合成</label><label className="m10-check"><input aria-label="下次列表读取失败" type="checkbox" checked={listError} onChange={e=>setListError(e.target.checked)}/>下次列表读取失败 · 合成</label><label className="m10-check"><input aria-label="下次详情读取失败" type="checkbox" checked={detailError} onChange={e=>setDetailError(e.target.checked)}/>下次详情读取失败 · 合成</label><p role="status" aria-label="演示读取计数">读取请求 {stats.started} · 暂存 {stats.held} · 已忽略过期响应 {stats.ignored}</p><button type="button" className="m10-button secondary" disabled={!stats.held} onClick={release}>交回暂存读取 · 合成</button></details>;
}
const readError='原业务记录有字段缺失或损坏，未用当前配置替换（合成读取故障）。';
export function PrototypeActivity({data, setData, projects, Dialog, Empty, AppMark, onRecover, onVerify, renderDraftRecovery}) {
  const [app,setApp]=useState('all'), [connection,setConnection]=useState('all'), [project,setProject]=useState('all');
  const [selected,setSelected]=useState(null), [refreshed,setRefreshed]=useState(false),[attachmentOpen,setAttachmentOpen]=useState(false);
  const [draftRecovery,setDraftRecovery]=useState(null),draftAction=useRef(null),returnDraftAction=useRef(false);
  useEffect(()=>{if(!draftRecovery&&returnDraftAction.current&&draftAction.current){draftAction.current.focus();returnDraftAction.current=false;}},[draftRecovery]);
  const [listPhase,setListPhase]=useState('ready'),[listBusy,setListBusy]=useState(false),[detailPhase,setDetailPhase]=useState('ready');
  const [holdReads,setHoldReads]=useState(false),[nextListError,setNextListError]=useState(false),[nextDetailError,setNextDetailError]=useState(false),[stats,setStats]=useState({started:0,held:0,ignored:0});
  const live=useRef(true),listGeneration=useRef(0),detailGeneration=useRef(0),selectedId=useRef(null),reads=useRef(null),listCache=useRef(new Map([[JSON.stringify(['all','all','all']),{phase:'ready',generation:0}]]));
  if(!reads.current)reads.current=createPreviewActivityReads(setStats);
  useEffect(()=>{live.current=true;return()=>{live.current=false;listGeneration.current++;detailGeneration.current++;reads.current.dispose();};},[]);
  const readList=(next={app,connection,project},reason='refresh')=>{
    const key=JSON.stringify([next.app,next.connection,next.project]),background=listCache.current.get(key)?.phase==='ready',attempt=++listGeneration.current,failed=nextListError;
    setNextListError(false);setRefreshed(false);setListBusy(true);setListPhase(background?'ready':'loading');listCache.current.set(key,{phase:background?'ready':'loading',generation:attempt});
    reads.current.request(()=>{if(live.current&&listCache.current.get(key)?.generation===attempt)listCache.current.set(key,{phase:failed?'error':'ready',generation:attempt});if(!live.current||attempt!==listGeneration.current)return false;setListBusy(false);setListPhase(failed?'error':'ready');if(!failed&&reason==='refresh')setRefreshed(true);return true;},{hold:holdReads});
  };
  const filter=(key,value)=>{const next={app,connection,project,[key]:value};if(key==='app')next.connection='all';setApp(next.app);setConnection(next.connection);setProject(next.project);readList(next,'filter');};
  const readDetail=id=>{const attempt=++detailGeneration.current,failed=nextDetailError||!data.activity.some(row=>row.id===id);selectedId.current=id;setSelected(id);setAttachmentOpen(false);setNextDetailError(false);setDetailPhase('loading');reads.current.request(()=>{if(!live.current||attempt!==detailGeneration.current||selectedId.current!==id)return false;setDetailPhase(failed?'error':'ready');return true;},{hold:holdReads});};
  const closeDetail=()=>{detailGeneration.current++;selectedId.current=null;setSelected(null);setAttachmentOpen(false);};
  const preview={hold:holdReads,setHold:setHoldReads,listError:nextListError,setListError:setNextListError,detailError:nextDetailError,setDetailError:setNextDetailError,stats,release:()=>reads.current.release()};
  const items=filterDemoActivity(data.activity,{app,connection,project});
  const item=data.activity.find(a=>a.id===selected);
  const projectName = row => row.project == null ? '全局配置' : projects.find(p=>p.id===row.project)?.name || '已删除项目 · '+row.project;
  const connectionName = row => data.connections.find(c=>c.id===row.connectionId && c.app===row.app)?.name || '原连接身份保留';
  const recovery=item && demoActivityRecovery(item,data);
  return <>
    <header className="m10-page-head"><div><h1>调用记录</h1><p>查看操作来源、当前阶段和需要恢复的事项。</p></div><button className="m10-button secondary" disabled={listBusy} onClick={()=>readList()}>刷新记录</button><button className="m10-button secondary" onClick={()=>{setData(activityDemoState);setRefreshed(false);}}>查看恢复示例</button></header>
    <div className="m10-activity-filters">
      <label>应用<select aria-label="按应用筛选记录" value={app} onChange={e=>filter('app',e.target.value)}><option value="all">全部应用</option><option value="zentao">禅道</option><option value="mail">邮件</option></select></label>
      <label>连接<select aria-label="按连接筛选记录" value={connection} onChange={e=>filter('connection',e.target.value)}><option value="all">全部连接</option>{data.connections.filter(c=>app==='all'||c.app===app).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label>项目<select aria-label="按项目筛选记录" value={project} onChange={e=>filter('project',e.target.value)}><option value="all">全部项目</option><option value="global">全局配置</option>{projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
    </div>
    {refreshed && <p role="status">已刷新视图 · 未重新执行原操作（合成记录）</p>}
    {listPhase==='loading'?<Empty kind="loading" role="status" title="正在读取调用记录" text="读取本机持久操作账与发送结果。"/>:listPhase==='error'?<Empty kind="error" role="alert" title="调用记录读取未完成" text={readError} action="重试读取" onAction={()=>readList()}/>:<>
    {!items.length && <Empty role="status" title="当前筛选没有调用记录" text="读取、草稿、配置和发送操作会按实际来源保留在这里。"/>}
    <div className="m10-activity-list">{items.map(row=><button className="m10-activity-row" data-activity-id={row.id} key={row.id} onClick={()=>readDetail(row.id)}><AppMark app={row.app}/><span className="m10-activity-copy"><strong>{row.operation}<small className="m10-inline-label">{activityCategory(row)}</small></strong><small>{projectName(row)} · {connectionName(row)} · {activitySource(row)}</small><small>{row.at} · 合成记录</small></span><span className={'m10-state '+row.status}>{stateLabel(row)}</span></button>)}</div></>}
    <p className="m10-muted">授权依据、执行状态与结果分别记录。SMTP服务器接受不代表送达；未知结果先核实，刷新不重发。</p>
    <ReadControls {...preview}/>
    {selected && !attachmentOpen && !draftRecovery && <Dialog title="调用与结果详情 · 合成记录" className="m10-activity-dialog" wide onClose={closeDetail}>
      {detailPhase==='loading'?<Empty kind="loading" role="status" title="正在读取原记录" text="只读核对，不重新提交操作。"/>:detailPhase==='error'?<Empty kind="error" role="alert" title="原记录无法完整读取" text={readError} action="重新读取" onAction={()=>readDetail(selected)}/>:item&&<div className="m10-activity-detail"><h2>{item.operation}</h2><div className="m10-detail-props"><span>应用<strong>{item.app==='mail'?'邮件':'禅道'}</strong></span><span>阶段<strong>{stateLabel(item)}</strong></span><span>来源<strong>{activitySource(item)}</strong></span><span>类别<strong>{activityCategory(item)}</strong></span></div>
      <p>项目：{projectName(item)} · 连接：{connectionName(item)}</p><p>时间：{item.at}</p>
      {item.taskId && <p>原任务：{item.taskTitle} · {item.taskId}</p>}
      {activityError(item) && <p className="m10-note" role="alert">{activityError(item)}</p>}
      {item.status==='unknown' && <p className="m10-note">结果未知，请核实原提交；刷新、返回或重连不会重发。</p>}
      {item.category==='write' && <p>SMTP服务器接受不代表送达或已读；WillYou不写入Foxmail已发送。</p>}
      <details><summary>追溯标识</summary><p className="m10-message-id">原操作：{item.id}<br/>运行：{item.runId || '无'}<br/>索引：{item.jobId || '无'}{item.draftId && <><br/>原草稿：{item.draftId} · r{item.revision}</>}</p></details></div>}
      {(holdReads||stats.held>0||nextListError||nextDetailError)&&<ReadControls {...preview}/>}
      <footer>{detailPhase==='ready'&&item&&<>{item.app==='mail'&&item.category==='read'&&<button className="m10-button secondary" onClick={()=>setAttachmentOpen(true)}>查看原邮件附件 · 合成</button>}{recovery && <button ref={recovery.kind==='draft'?draftAction:undefined} className="m10-button secondary" onClick={()=>{if(recovery.kind==='draft'&&renderDraftRecovery)setDraftRecovery(recovery);else{closeDetail();onRecover(recovery);}}}>{recovery.kind==='draft'?'查看原项目草稿':'检查原连接'}</button>}{item.status==='unknown' && <button className="m10-button secondary" onClick={()=>{closeDetail();onVerify(item);}}>核实结果</button>}</>}<button className="m10-button secondary" disabled={detailPhase==='loading'} onClick={()=>readDetail(selected)}>刷新原记录</button><button className="m10-button secondary" onClick={closeDetail}>关闭</button></footer>
    </Dialog>}
    {draftRecovery&&renderDraftRecovery?.(draftRecovery,()=>{returnDraftAction.current=true;setDraftRecovery(null);})}
    {item&&attachmentOpen&&<Dialog title="原邮件附件" wide onClose={()=>setAttachmentOpen(false)}><p>原邮件附件 · 公开合成示例；未读取真实邮件。</p><PrototypeAttachment/><footer><button className="m10-button secondary" onClick={()=>setAttachmentOpen(false)}>返回原记录</button></footer></Dialog>}
  </>;
}
