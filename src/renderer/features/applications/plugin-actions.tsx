import {useEffect,useRef,useState} from 'react';
import {observer} from 'mobx-react-lite';
import type {PluginUiActionRequest,PreparedPluginUiAction} from '@shared/plugin-actions';
import {rpc} from '@renderer/lib/ipc';
import {agentTasksStore} from '@renderer/core/agent-tasks-store';
import {navigation} from '@renderer/core/navigation';
import {ApplicationTerminalButton} from './terminal-insertion';
import {AppDialog} from './controls';
import {unwrap} from './api';

const TerminalChoice=observer(function TerminalChoice({value,onClose,onDone}:{value:Extract<PreparedPluginUiAction,{kind:'insertTerminal'}>;onClose():void;onDone():void}){
  const [target,setTarget]=useState<string|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),live=useRef(true);
  useEffect(()=>()=>{live.current=false;},[]);
  const agentTasks=agentTasksStore.tasks.filter(t=>t.projectId===value.projectId);
  const prepare=async()=>{if(busy)return;setBusy(true);setError('');try{const latest=unwrap(await rpc.applications.pluginReviewAction(value.id));if(!live.current)return;if(latest.kind!=='insertTerminal'||latest.projectId!==value.projectId)throw new Error('原插件引用已变化');onDone();navigation.prepareApplicationTask(value.projectId,latest.text);}catch(e){if(live.current)setError(e instanceof Error?e.message:'引用未准备');}finally{if(live.current)setBusy(false);}};
  return <AppDialog title="选择插入会话" onClose={onClose}><p>只插入草稿，不自动发送。请选择本项目的目标任务。</p>{agentTasks.length>0?<label>新任务<select aria-label="插件引用目标任务" value={target??''} onChange={e=>setTarget(e.target.value||null)}><option value="">选择任务</option>{agentTasks.map(t=><option key={t.taskId} value={t.taskId}>{t.title}</option>)}</select></label>:<p>本项目没有可选任务。</p>}
    {target&&<ApplicationTerminalButton agentTaskId={target} key={target} projectId={value.projectId} source={{kind:'pluginAction',appId:value.appId,actionId:value.id}} label="插入所选会话" onInserted={onDone}/>}
    {error&&<p role="alert">{error}</p>}<footer>{!agentTasks.length&&<button className="m10-button secondary" disabled={busy} onClick={()=>void prepare()}>{busy?'正在准备…':'新建会话并插入'}</button>}<button className="m10-button secondary" onClick={onClose}>取消</button></footer></AppDialog>;
});

/** A click selects a declared action; the host resolves it from its own original read, never client text/URL. */
export function PluginActionButton({title,request,onDone}:{title:string;request:PluginUiActionRequest;onDone(close:boolean,navigate:boolean):void}){
  const [value,setValue]=useState<Extract<PreparedPluginUiAction,{kind:'insertTerminal'}>|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[unknown,setUnknown]=useState(false);
  const live=useRef(true),pending=useRef(false),action=useRef<string|null>(null);
  const release=()=>{const id=action.current;action.current=null;if(id)void rpc.applications.pluginReleaseAction(id).catch(()=>{});};
  useEffect(()=>{live.current=true;return()=>{live.current=false;release();};},[]);
  const click=async()=>{
    if(pending.current||unknown)return;pending.current=true;setBusy(true);setError('');let dispatched=false;
    try{const prepared=unwrap(await rpc.applications.pluginPrepareAction(request));if(!live.current){void rpc.applications.pluginReleaseAction(prepared.id).catch(()=>{});return;}action.current=prepared.id;
      if(prepared.kind==='insertTerminal'){setValue(prepared);return;}
      dispatched=true;const opened=await rpc.applications.pluginOpenAction(prepared.id);if(!live.current)return;if(!opened.ok){dispatched=opened.code==='UPSTREAM_RESULT_UNKNOWN';throw new Error(opened.message);}onDone(prepared.closeOnDone,false);
    }catch(e){if(live.current){setUnknown(dispatched);setError(dispatched?'打开结果未确认，不会自动重试。':e instanceof Error?e.message:'插件动作未准备');}}
    finally{pending.current=false;if(live.current)setBusy(false);if(!action.current||!live.current||dispatched)release();}
  };
  const close=()=>{setValue(null);release();};
  return <><button className="m10-button secondary" disabled={busy||unknown||!!value} onClick={()=>void click()}>{busy?'正在核对…':title}</button>{error&&<p role="alert">{error}</p>}{value&&<TerminalChoice value={value} onClose={close} onDone={()=>{const closeParent=value.closeOnDone;close();onDone(closeParent,true);}}/>}</>;
}
