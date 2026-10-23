import type {DeliveryCopyDiagnostics} from '@shared/application-session-diagnostics';
import {timeText} from './controls';

export function DeliveryCopies({value}:{value:DeliveryCopyDiagnostics|null}){
 if(!value)return null;
 const stateLabel={unprocessed:'尚无处理记录',held:'保留原内容',preparing:'清理计划已登记，待核查',renamed:'原副本已转入回收区，待核查',deleting:'部分清理，待恢复核查',removed:'原内容处理完成，回执待核查',committed:'原回收记录已完成',unverified:'处理记录未核实，保留原内容'};
 const reason=(code:string)=>code==='RESOURCE_BUSY'?'仍有占用或引用待核查':['OWNERSHIP_CONFLICT','HASH_MISMATCH'].includes(code)?'当前内容或目录归属与原记录不符':'归属或恢复依据待核验';
 return <details className="m10-runtime-demo"><summary>交付副本保留与清理记录</summary>
  <p className="m10-muted">只读展示最近处理记录，不触发清理或重启。仅有完成记录不证明当前路径已不存在，也不表示原版本可以删除。</p>
  {value.incomplete&&<p className="m10-note" role="status">未完整核对全部记录：仅展示最近最多 16 次交付、64 条副本记录；其余或损坏记录继续保留。{value.issueCode?' · '+value.issueCode:''}</p>}
  {!value.records.length&&<p>{value.issueCode?'原处理记录待核查，不推断副本已清理。':'本会话当前未发现可展示的副本处理记录。'}</p>}
  {value.records.map(item=><section key={item.deliveryId+':'+item.relativePath} aria-label="交付副本记录"><p>{stateLabel[item.state]}{item.issueCode?' · '+reason(item.issueCode):''}</p>
   <p className="m10-message-id">相对路径：{item.relativePath}<br/>内容标识：{item.contentHash??'未记录'}<br/>原交付：{item.deliveryId}<br/>记录更新：{item.updatedAt?timeText(item.updatedAt):'未记录'}{item.issueCode&&<><br/>原因：{item.issueCode}</>}</p>
  </section>)}
 </details>;
}
