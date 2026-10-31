import {timeText} from './controls';
import type {useApplicationImpact} from './api';
export function impactReady(query:ReturnType<typeof useApplicationImpact>){return !!query.data&&!query.isFetching&&!query.error;}
const provider={zentao:'禅道连接',foxmail:'本地读取来源',smtp:'SMTP 发件账号'};
const runState=(state:string)=>state==='active'?'运行中，需停止':['preparing','prepared'].includes(state)?'正在准备，需停止':state==='stopping'?'正在停止，待确认':'运行状态待核查';
export function ApplicationImpactView({query}:{query:ReturnType<typeof useApplicationImpact>}){
 if(query.isFetching||query.isPending)return <p role="status">正在核对影响范围…</p>;
 if(query.error)return <div className="m10-note" role="alert"><p>{query.error.message}</p><button className="m10-button secondary" onClick={()=>void query.refetch()}>重试影响核对</button></div>;
 const data=query.data;if(!data)return null;
 return <section className="m10-impact" aria-label="本次操作影响范围">
  <h3>受影响连接（{data.connections.length}）</h3>{data.connections.length?<ul className="m10-impact-list" aria-label="受影响连接">{data.connections.map(c=><li key={c.id}><strong title={c.name}>{c.name}</strong><small>{provider[c.providerId]} · {c.authorization==='disconnected'?'已断开':c.enabled?'连接已启用':'连接已停用'}</small></li>)}</ul>:<p>没有受影响的连接。</p>}
  <h3>关联项目（{data.projects.length}）</h3>{data.projects.length?<ul className="m10-impact-list" aria-label="关联项目">{data.projects.map(p=><li key={p.id}><strong title={p.name}>{p.name}</strong><small>{p.archived?'已归档 · ':''}{p.enabled?'项目已启用':'项目已停用'}</small></li>)}</ul>:<p>没有关联项目。</p>}
  {data.kind==='switch'&&<><h3>需要停止的运行（{data.runs.length}）</h3>{data.runs.length?<ul className="m10-impact-list" aria-label="需要停止的运行">{data.runs.map(r=><li key={r.id}><strong title={r.title}>{r.title}</strong><small>{runState(r.state)}</small></li>)}</ul>:<p>没有需要停止的运行。</p>}</>}
  <p className="m10-muted">核对时间：<time dateTime={data.checkedAt}>{timeText(data.checkedAt,'未记录')}</time>。{data.kind==='switch'?'执行时再次核对当前相关运行；无关任务继续运行。':'已停用或归档项目仍保留连接选择；此操作不停止 Agent 的其他工作。'}</p>
 </section>;
}
