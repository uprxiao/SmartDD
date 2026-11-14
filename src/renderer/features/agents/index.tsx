import { observer } from 'mobx-react-lite';
import { navigation } from '@renderer/core/navigation';
import { GlobalModelNotice } from './global-model-notice';
import { useEffect, useRef, useState } from 'react';
import { Download, Plus, Upload } from 'lucide-react';
import { toast } from 'sonner';
import type { CodeAgentKind, CodeAgentTool, ProviderView, RunConfigView } from '@shared/ai-agents';
import { rpcErrorMessage } from '@shared/ipc/rpc';
import { rpc } from '@renderer/lib/ipc';
import { useAgents, useRefreshAgents } from '@renderer/lib/hooks/useAgents';
import { AgentDialog } from './ui';
import { AgentList, ProviderList } from './agent-list';
import { AgentEditor, agentLabels } from './agent-editor';
import { LegacyAgentEditor } from './legacy-editor';
import { AgentImportDialog, AgentExportDialog } from './transfer-dialogs';
import { ProviderCatalogDialog } from './provider-catalog';
import { ProviderDetail } from './provider-detail';
import '../applications/style.css';
import './style.css';

type Modal={type:'agent';initial?:RunConfigView;preset?:{kind:CodeAgentKind;providerId:string}}|{type:'legacy';config:RunConfigView}|{type:'provider';id:string}|
  {type:'catalog';forTool?:CodeAgentKind}|{type:'import'}|{type:'export'}|{type:'delete';config:RunConfigView}|{type:'path';tool:CodeAgentTool;back?:Modal};
export const AgentsSection=observer(function AgentsSection(){
  const query=useAgents(),refresh=useRefreshAgents(),[tab,setTab]=useState<'configs'|'providers'>('configs');
  const detectingRef=useRef(false);
  const [modal,setModal]=useState<Modal|null>(null),[detecting,setDetecting]=useState(false),[error,setError]=useState('');
  const {configs=[],providers=[],tools=[]}=query.data??{};
  const providerRequest=navigation.agentProviderRequest;
  useEffect(()=>{
    if(!providerRequest||!query.data)return;
    if(providers.some(p=>p.id===providerRequest.id))setModal({type:'provider',id:providerRequest.id});
    else setError('供应商已删除，请改选智能体');
    navigation.consumeAgentProviderRequest(providerRequest.seq);
  },[providerRequest,query.data,providers]);
  const action=async(fn:()=>Promise<unknown>,message?:string)=>{setError('');try{await fn();await refresh();if(message)toast.success(message);}catch(e){setError(rpcErrorMessage(e));}};
  const detect=async(manual=false)=>{
    if(detectingRef.current)return;detectingRef.current=true;setDetecting(true);setError('');
    try{
      const detected=await rpc.agents.refreshTools(),messages:string[]=[];
      for(const {tool} of detected??[]){
        const previous=tools.find(t=>t.id===tool.id),label=agentLabels[tool.kind]??tool.kind;
        if(!previous?.installed&&tool.installed)messages.push(`检测到 ${label}，新建智能体时可以选择它`);
        else if(previous?.installed&&!tool.installed)messages.push(`没有检测到 ${label}：它的智能体暂时不能使用，也不在首页显示`);
        else if(tool.installed&&previous?.login!==tool.login){
          if(tool.login==='none')messages.push(`${label} 已退出登录：订阅／API 智能体暂时不能使用，也不在首页显示`);
          else messages.push(`${label} 登录状态已更新，新建智能体时可以选择它`);
        }
      }
      await refresh();
      if(messages.length)toast.success(messages.join('；'));
      else if(manual)toast.success('已重新检测：没有变化');
    }catch(e){const message=rpcErrorMessage(e);setError(message);if(manual)toast.error(message);}finally{detectingRef.current=false;setDetecting(false);}
  };
  // Detection and explicit creation remain separate. This never auto-adds an Agent.
  useEffect(()=>{void detect();},[]);
  const edit=(config:RunConfigView)=>setModal(config.source==='legacy'?{type:'legacy',config}:{type:'agent',initial:config});
  const newWithProvider=(provider:ProviderView,kind:CodeAgentKind)=>{
    const tool=tools.find(t=>t.kind===kind&&t.installed)??tools.find(t=>t.kind===kind);
    const existing=configs.find(c=>c.toolId===tool?.id&&c.providerId===provider.id&&c.source==='provider');
    setTab('configs');if(existing)edit(existing);else setModal({type:'agent',preset:{kind,providerId:provider.id}});
  };
  const close=()=>setModal(null);
  const currentProvider=modal?.type==='provider'?providers.find(p=>p.id===modal.id):undefined;
  return <div className="m13-shell m13-settings-embed" data-testid="agents-settings">
    <GlobalModelNotice/>
    <div className="m10-page-head"><div><h1>智能体</h1><p>智能体＝Code Agent＋订阅或供应商。这里的列表就是首页的智能体下拉，默认的排第一，其余可拖动调整顺序；每次运行按需注入，不修改 CLI 的全局配置。</p></div>
      <div className="m10-head-actions"><button className="m10-button secondary" onClick={()=>setModal({type:'import'})}><Upload size={14}/>导入</button><button className="m10-button secondary" onClick={()=>setModal({type:'export'})}><Download size={14}/>导出</button>
        {tab==='configs'?<button className="m10-button primary" onClick={()=>setModal({type:'agent'})}><Plus size={14}/>新建智能体</button>:<button className="m10-button primary" onClick={()=>setModal({type:'catalog'})}><Plus size={14}/>添加供应商</button>}</div>
    </div>
    <div className="m10-tabs" role="tablist">{(['configs','providers'] as const).map(id=><button key={id} role="tab" aria-selected={tab===id} onClick={()=>setTab(id)}>{id==='configs'?'智能体':'供应商'}<span className="m13-count">{id==='configs'?configs.length:providers.length}</span></button>)}</div>
    {query.isPending?<p className="m13-hint">正在读取智能体配置…</p>:query.error?<div className="m13-alert danger" role="alert">{rpcErrorMessage(query.error)}</div>:tab==='configs'?<AgentList configs={configs} providers={providers} tools={tools} actions={{edit,create:()=>setModal({type:'agent'}),remove:config=>setModal({type:'delete',config}),
      setDefault:c=>void action(()=>rpc.agents.setDefault(c.id),'已设为默认智能体'),toggleVisible:c=>void action(()=>rpc.agents.homeVisible(c.id,!c.homeVisible)),reorder:(c,index)=>void action(()=>rpc.agents.reorder(c.id,index))}}/>:<ProviderList providers={providers} configs={configs} onEdit={p=>setModal({type:'provider',id:p.id})} onCreate={()=>setModal({type:'catalog'})}/>}

    {error&&<div className="m13-alert danger" role="alert">{error}</div>}
    {modal?.type==='agent'&&<AgentEditor key={modal.initial?.id??`${modal.preset?.kind??'new'}:${modal.preset?.providerId??''}`} initial={modal.initial} preset={modal.preset} configs={configs} providers={providers} tools={tools} onClose={close} onRefresh={refresh} onSaved={()=>toast.success(modal.initial?'智能体已保存':'智能体已创建')} onEditExisting={edit} onAddProvider={forTool=>setModal({type:'catalog',forTool})} onToolPath={tool=>setModal({type:'path',tool,back:modal})} onRedetect={()=>void detect(true)} redetecting={detecting}/>}
    {modal?.type==='legacy'&&<LegacyAgentEditor key={modal.config.id} config={configs.find(c=>c.id===modal.config.id)??modal.config} onClose={close} onSaved={refresh}/>}
    {modal?.type==='catalog'&&<ProviderCatalogDialog providers={providers} forTool={modal.forTool} onClose={close} onConnected={refresh} onNewAgent={newWithProvider}/>}
    {modal?.type==='provider'&&currentProvider&&<ProviderDetail provider={currentProvider} configs={configs} onClose={close} onRefresh={refresh} onNewAgent={newWithProvider}/>}
    {modal?.type==='import'&&<AgentImportDialog onClose={close} onDone={()=>{void refresh();toast.success('智能体配置已导入');}}/>}
    {modal?.type==='export'&&<AgentExportDialog providers={providers} configs={configs} onClose={close} onDone={()=>toast.success('智能体配置已导出')}/>}
    {modal?.type==='path'&&<ToolPathDialog tool={modal.tool} onClose={()=>setModal(modal.back??null)} onSaved={async()=>{await refresh();setModal(modal.back??null);}}/>}
    {modal?.type==='delete'&&<DeleteAgentDialog config={modal.config} onClose={close} onDelete={async()=>{await rpc.agents.delete(modal.config.id);await refresh();close();}}/>}
  </div>;
});
function ToolPathDialog({tool,onClose,onSaved}:{tool:CodeAgentTool;onClose:()=>void;onSaved:()=>Promise<void>}){
  const [path,setPath]=useState(tool.customPath??tool.executable),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const save=async()=>{if(busy)return;setBusy(true);setError('');try{const result=await rpc.agents.customToolPath(tool.kind,path.trim()||null,tool.id);if(!result.tool.installed)throw Error(result.error??'未检测到可启动的程序，未保存');await onSaved();}catch(e){setError(rpcErrorMessage(e));}finally{setBusy(false);}};
  return <AgentDialog title="自定义可执行路径" sub={(agentLabels[tool.kind]??tool.kind)+' · 高级'} onClose={onClose} footer={<><button className="m10-button secondary" onClick={onClose}>取消</button><button className="m10-button primary" disabled={busy} onClick={()=>void save()}>{busy?'检测中…':'检测并保存'}</button></>}><label className="m13-field"><span>可执行文件</span><input value={path} onChange={e=>setPath(e.target.value)}/></label>{error&&<div className="m13-alert danger" role="alert">{error}</div>}<p className="m13-hint">一般不需要修改。WillYou 会检测该文件能否启动并读取版本。留空恢复自动检测。</p></AgentDialog>;
}
function DeleteAgentDialog({config,onClose,onDelete}:{config:RunConfigView;onClose:()=>void;onDelete:()=>Promise<void>}){
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const remove=async()=>{if(busy)return;setBusy(true);try{await onDelete();}catch(e){setError(rpcErrorMessage(e));}finally{setBusy(false);}};
  return <AgentDialog title={`删除 ${config.name}？`} onClose={onClose} footer={<><button className="m10-button secondary" onClick={onClose}>取消</button><button className="m10-button primary m13-danger-btn" disabled={busy} onClick={()=>void remove()}>删除</button></>}><p className="m13-desc">历史任务仍会保留，恢复时需要重新选择智能体。{config.isDefault?'删除后默认改为首页显示中的下一个。':''}</p>{error&&<div className="m13-alert danger" role="alert">{error}</div>}</AgentDialog>;
}
