import { useState } from 'react';
import { rpc } from '@renderer/lib/ipc';
import { revealBrowserTab } from './store';

type Receipt=Awaited<ReturnType<typeof rpc.browser.verifyCheckpoint>>;

export function BrowserCheckpointCard({taskId,receipt,archived}:{taskId:string;receipt:Receipt;archived:boolean}){
  const [working,setWorking]=useState(false);
  const [message,setMessage]=useState<string>();
  const verify=async()=>{
    setWorking(true);
    setMessage(undefined);
    try{await rpc.browser.verifyCheckpoint({taskId,checkpointId:receipt.checkpointId});}
    catch{setMessage('暂未核对到原步骤的业务结果。');}
    finally{setWorking(false);}
  };
  const verified=receipt.business==='verified';
  const action=receipt.action.state==='succeeded'?'已执行':receipt.action.state==='failed'?'失败':'结果未确认';
  return <details className="agent-child-result">
    <summary>原步骤 · {verified?'已核对':'待核对'}</summary>
    <small>浏览器动作 · {action}</small>
    <small>原操作编号 {receipt.operationId}</small>
    {!archived&&<button type="button" onClick={()=>void revealBrowserTab(taskId,receipt.pageId).catch(()=>setMessage('原网页标签暂不可用。'))}>查看网页标签</button>}
    {!archived&&!verified&&<button type="button" disabled={working} onClick={()=>void verify()}>只读核对原结果</button>}
    {message&&<small role="status">{message}</small>}
  </details>;
}
