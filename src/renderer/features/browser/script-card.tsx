import {useEffect,useState} from 'react';
import {toast} from 'sonner';
import {events,rpc} from '@renderer/lib/ipc';
import {browserScriptChangedEvent} from '@shared/events';
import {revealBrowserTab} from './store';

type ScriptStatus=Awaited<ReturnType<typeof rpc.browser.scriptStatus>>;
type Evidence=Awaited<ReturnType<typeof rpc.browser.readScriptEvidence>>;
const label:Record<ScriptStatus['phase'],string>={
  queued:'等待运行',running:'正在运行',succeeded:'测试通过',failed:'测试失败',
  stopped:'已停止',paused:'已暂停','awaiting-login':'等待本人登录', 'needs-review':'结果待核对',
};

export function BrowserScriptCard({taskId,executionId,archived}:{taskId:string;executionId:string;archived:boolean}){
  const [status,setStatus]=useState<ScriptStatus>();
  const [error,setError]=useState(false);
  const [working,setWorking]=useState(false);
  const [preview,setPreview]=useState<Evidence>();
  const [verification,setVerification]=useState<string>();
  useEffect(()=>{
    let closed=false,sequence=0;
    const refresh=async()=>{
      const expected=++sequence;
      try{
        const result=await rpc.browser.scriptStatus({taskId,executionId});
        if(!closed&&expected===sequence){setStatus(result);setError(false);}
      }catch{
        if(!closed&&expected===sequence)setError(true);
      }
    };
    const unsubscribe=events.on(browserScriptChangedEvent,event=>{
      if(event.taskId===taskId&&event.executionId===executionId)void refresh();
    });
    void refresh();
    return()=>{closed=true;unsubscribe();};
  },[taskId,executionId]);
  const control=async(action:'pause'|'stop')=>{
    setWorking(true);
    try{await rpc.browser.scriptStatus({taskId,executionId,action});}
    catch{toast.error('无法更新本次浏览器测试');}
    finally{setWorking(false);}
  };
  const openEvidence=async(kind:'report'|'screenshot')=>{
    try{setPreview(await rpc.browser.readScriptEvidence({taskId,executionId,kind}));}
    catch{toast.error('无法预览本次浏览器测试证据');}
  };
  const inspect=async()=>{
    setWorking(true);
    try{
      const result=await rpc.browser.inspectScriptResult({taskId,executionId});
      setVerification(result.state==='marker-found'?'原网页上已找到声明的业务标记。':
        result.state==='marker-missing'?'原网页当前未找到声明的业务标记。':'本次执行没有可核对的原业务标记。');
    }catch{setVerification('原网页或测试包已变化，无法核对原结果。');}
    finally{setWorking(false);}
  };
  if(error)return <div className="agent-child-result">浏览器测试记录暂不可用</div>;
  if(!status)return <div className="agent-child-result">正在获取浏览器测试记录…</div>;
  const active=['queued','running'].includes(status.phase);
  return <details className="agent-child-result" open={active||undefined}>
    <summary>执行浏览器测试 · {label[status.phase]}</summary>
    <small>已完成 {status.cases.length} / {status.caseIds.length}{status.currentCase&&` · 当前用例 ${status.currentCase}`}</small>
    {status.checkpoint&&<small>续接步骤 {status.checkpoint.stepId}</small>}
    {status.cases.map(result=><div key={result.id}>
      <b>{result.id} · {result.status==='passed'?'通过':result.status==='blocked'?'受阻':'失败'}</b>
      {result.assertions.filter(entry=>!entry.passed).map(entry=><div key={entry.id}>
        <small>{entry.id}</small>
        <small>预期 {entry.expected??'未记录'}，实际 {entry.actual??'未记录'}</small>
      </div>)}
      {result.unexecutedAssertions?.map(id=><small key={id}>{id} · 未执行</small>)}
      {result.nativeFailure&&<small>{result.nativeFailure.method} · {result.nativeFailure.code}</small>}
    </div>)}
    {!archived&&<button type="button" onClick={()=>void revealBrowserTab(taskId,status.pageId).catch(()=>toast.error('无法打开原网页标签'))}>查看网页标签</button>}
    {status.report&&<button type="button" onClick={()=>void openEvidence('report')}>查看报告</button>}
    {status.evidence.some(item=>item.path.endsWith('.png'))&&<button type="button" onClick={()=>void openEvidence('screenshot')}>查看截图</button>}
    {status.phase==='needs-review'&&!archived&&<button type="button" disabled={working} onClick={()=>void inspect()}>只读核对原结果</button>}
    {verification&&<small role="status">{verification}</small>}
    {preview&&<section aria-label="浏览器测试证据">
      {preview.kind==='report'&&<pre className="agent-request-detail">{preview.text}</pre>}
      {preview.kind==='screenshot'&&<img src={preview.image} alt="本次执行的原网页截图" style={{maxWidth:'100%',height:'auto'}}/>}
      <button type="button" onClick={()=>setPreview(undefined)}>关闭预览</button>
    </section>}
    {active&&!archived&&<>
      <button type="button" disabled={working} onClick={()=>void control('pause')}>暂停</button>
      <button type="button" disabled={working} onClick={()=>void control('stop')}>停止</button>
    </>}
  </details>;
}
