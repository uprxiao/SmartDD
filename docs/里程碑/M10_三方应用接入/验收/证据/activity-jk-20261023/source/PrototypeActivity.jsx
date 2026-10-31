import {useState} from 'react';
import {activityCategory, activityDemoState, activityError, activitySource, demoActivityRecovery, filterDemoActivity} from './activity-prototype-model.mjs';

const stateLabel = item => ({success:item.category === 'write' ? '已提交到邮件服务器' : '调用完成',failed:'调用失败',unknown:'调用结果未知',sending:'原提交尚无最终结果',draft:'草稿',handoff:'已交给客户端'})[item.status];
export function PrototypeActivity({data, setData, projects, Dialog, AppMark, onRecover, onVerify}) {
  const [app,setApp]=useState('all'), [connection,setConnection]=useState('all'), [project,setProject]=useState('all');
  const [selected,setSelected]=useState(null), [refreshed,setRefreshed]=useState(false);
  const items=filterDemoActivity(data.activity,{app,connection,project});
  const item=data.activity.find(a=>a.id===selected);
  const projectName = row => row.project == null ? '全局配置' : projects.find(p=>p.id===row.project)?.name || '已删除项目 · '+row.project;
  const connectionName = row => data.connections.find(c=>c.id===row.connectionId && c.app===row.app)?.name || '原连接身份保留';
  const recovery=item && demoActivityRecovery(item,data);
  return <>
    <header className="m10-page-head"><div><h1>调用记录</h1><p>查看操作来源、当前阶段和需要恢复的事项。</p></div><button className="m10-button secondary" onClick={()=>setRefreshed(true)}>刷新记录</button><button className="m10-button secondary" onClick={()=>{setData(activityDemoState);setRefreshed(false);}}>查看恢复示例</button></header>
    <div className="m10-activity-filters">
      <label>应用<select aria-label="按应用筛选记录" value={app} onChange={e=>{setApp(e.target.value);setConnection('all');}}><option value="all">全部应用</option><option value="zentao">禅道</option><option value="mail">邮件</option></select></label>
      <label>连接<select aria-label="按连接筛选记录" value={connection} onChange={e=>setConnection(e.target.value)}><option value="all">全部连接</option>{data.connections.filter(c=>app==='all'||c.app===app).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label>项目<select aria-label="按项目筛选记录" value={project} onChange={e=>setProject(e.target.value)}><option value="all">全部项目</option><option value="global">全局配置</option>{projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
    </div>
    {refreshed && <p role="status">已刷新视图 · 未重新执行原操作（合成记录）</p>}
    {!items.length && <div className="m10-empty"><h3>当前筛选没有调用记录</h3><p>读取、草稿、配置和发送操作会按实际来源保留在这里。</p></div>}
    <div className="m10-activity-list">{items.map(row=><button className="m10-activity-row" data-activity-id={row.id} key={row.id} onClick={()=>setSelected(row.id)}><AppMark app={row.app}/><span className="m10-activity-copy"><strong>{row.operation}<small className="m10-inline-label">{activityCategory(row)}</small></strong><small>{projectName(row)} · {connectionName(row)} · {activitySource(row)}</small><small>{row.at} · 合成记录</small></span><span className={'m10-state '+row.status}>{stateLabel(row)}</span></button>)}</div>
    <p className="m10-muted">授权依据、执行状态与结果分别记录。SMTP服务器接受不代表送达；未知结果先核实，刷新不重发。</p>
    {item && <Dialog title="调用与结果详情 · 合成记录" wide onClose={()=>setSelected(null)}>
      <div className="m10-activity-detail"><h2>{item.operation}</h2><div className="m10-detail-props"><span>应用<strong>{item.app==='mail'?'邮件':'禅道'}</strong></span><span>阶段<strong>{stateLabel(item)}</strong></span><span>来源<strong>{activitySource(item)}</strong></span><span>类别<strong>{activityCategory(item)}</strong></span></div>
      <p>项目：{projectName(item)} · 连接：{connectionName(item)}</p><p>时间：{item.at}</p>
      {item.taskId && <p>原任务：{item.taskTitle} · {item.taskId}</p>}
      {activityError(item) && <p className="m10-note" role="alert">{activityError(item)}</p>}
      {item.status==='unknown' && <p className="m10-note">结果未知，请核实原提交；刷新、返回或重连不会重发。</p>}
      {item.category==='write' && <p>SMTP服务器接受不代表送达或已读；WillYou不写入Foxmail已发送。</p>}
      <details><summary>追溯标识</summary><p className="m10-message-id">原操作：{item.id}<br/>运行：{item.runId || '无'}<br/>索引：{item.jobId || '无'}{item.draftId && <><br/>原草稿：{item.draftId} · r{item.revision}</>}</p></details></div>
      <footer>{recovery && <button className="m10-button secondary" onClick={()=>{setSelected(null);onRecover(recovery);}}>{recovery.kind==='draft'?'查看原项目草稿':'检查原连接'}</button>}{item.status==='unknown' && <button className="m10-button secondary" onClick={()=>{setSelected(null);onVerify(item);}}>核实结果</button>}<button className="m10-button secondary" onClick={()=>setRefreshed(true)}>刷新原记录</button><button className="m10-button secondary" onClick={()=>setSelected(null)}>关闭</button></footer>
    </Dialog>}
  </>;
}
