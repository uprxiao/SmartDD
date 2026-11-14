import type {SessionChangeQuery} from '@shared/session-change-impact';
import {readSessionChangeImpact,sessionChangeMessage} from '../applications/session-change';
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Blocks, ChevronRight, Info, RefreshCw, Search, Server, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { rpc } from '@renderer/lib/ipc';
import { rpcErrorMessage } from '@shared/ipc/rpc';
import type { CapabilityRegistryView, ManagedCapabilityView } from '@shared/managed-capabilities';
import { AgentDialog, AgentSwitch, Pill } from '../agents/ui';
import '../agents/style.css';

const labels:Record<ManagedCapabilityView['status'],string>={new:'新发现',managed:'已纳管',conflict:'同名冲突',invalid:'需处理',missing:'来源已删除',plugin:'随插件管理',host:'宿主专属'};
const issueLabels:Record<string,string>={source_disabled:'来源中已停用',skill_metadata_missing:'Skill 缺少名称或说明',skill_parse_failed:'Skill 声明无法解析',config_parse_failed:'来源配置无法解析',path_unreadable:'来源路径不可读',runtime_dependencies_unverified:'运行依赖待核验',command_path_unverified:'命令路径待核验',network_auth_unverified:'网络及认证待核验',project_trust_unverified:'项目授权待核验',project_not_git:'当前项目不是 Git 仓库；Codex 项目链接会出现在项目目录',project_git_unverified:'Git 排除路径尚未核验，请检查项目 Git 配置',skill_target_conflict:'Codex 项目目录存在同名 Skill 目标，保留原件，不覆盖',plugin_manifest_unverified:'原生插件清单尚不能核验，请在来源 CLI 中检查',plugin_source_changed:'原生插件来源已变化或暂时不可读，请重新扫描',plugin_path_unverified:'原生插件声明的路径无法安全识别，未导入该路径',plugin_mcp_unverified:'原生插件的 MCP 配置尚不能等价转换，请在目标 CLI 单独配置'};
const sourceLabel=(item:ManagedCapabilityView)=>item.sourceScope==='project'?`项目级 · ${item.projectRoot}`:item.sourceScope==='plugin'?item.sourceLabel:`用户级 · ${item.runner==='claude'?'Claude Code':'Codex'}`;

export function SkillsWorkspace(){
  const client=useQueryClient(),query=useQuery({queryKey:['managed-capabilities'],queryFn:()=>rpc.capabilities.managedList(),refetchInterval:5000});
  const builtin=useQuery({queryKey:['managed-builtins'],queryFn:()=>rpc.capabilities.builtinSettings()});
  const [kind,setKind]=useState<'skill'|'mcp'>('skill'),[filter,setFilter]=useState('all'),[search,setSearch]=useState(''),[selected,setSelected]=useState<string|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const busyRef=useRef(false);
  const act=async<T,>(fn:()=>Promise<T>,message?:string,effect?:{query:SessionChangeQuery|null;kind:'cap-on'|'cap-off';format?:(body:string,result:T)=>string})=>{
    if(busyRef.current)return;busyRef.current=true;setBusy(true);setError('');
    try{await client.cancelQueries({queryKey:['managed-capabilities']});const impact=effect?.query?await readSessionChangeImpact(effect.query):null;const result=await fn();await Promise.all([query.refetch(),builtin.refetch()]);if(message){const body=effect?sessionChangeMessage(effect.kind,impact??{runningCount:0,globalDisabled:false,checkedAt:''}):'';toast.success(effect?.format?effect.format(body,result):message+(effect?'：'+body:''));}}
    catch(e){setError(rpcErrorMessage(e));}finally{busyRef.current=false;setBusy(false);}
  };
  useEffect(()=>{let live=true;void rpc.capabilities.scanManaged().then(v=>{if(live)client.setQueryData(['managed-capabilities'],v);}).catch(e=>{if(live)setError(rpcErrorMessage(e));});return()=>{live=false;};},[client]);
  const items=(query.data?.items??[]).filter(x=>x.sourceScope!=='host');
  const sameKind=items.filter(x=>x.kind===kind),attention=(x:ManagedCapabilityView)=>['conflict','invalid','missing'].includes(x.status);
  const count={all:sameKind.length,new:sameKind.filter(x=>x.status==='new').length,managed:sameKind.filter(x=>x.managed).length,attention:sameKind.filter(attention).length};
  const shown=sameKind.filter(x=>(filter==='all'||filter==='new'&&x.status==='new'||filter==='managed'&&x.managed||filter==='attention'&&attention(x))&&`${x.name} ${x.sourcePath} ${x.sourceLabel}`.toLowerCase().includes(search.toLowerCase()));
  const item=query.data?.items.find(x=>x.id===selected);
  return <>
    <header className="m10-page-head"><div><h1>技能</h1><p>你在 Claude Code 或 Codex 中安装的 Skill、配置的 MCP，会被自动发现；纳管后同步配置给另一个工具，所有项目默认可用。安装与首次认证仍在来源 CLI 中完成。</p></div>
      <div className="m10-head-actions"><label className="m10-search"><Search size={15}/><input aria-label="搜索技能" placeholder="搜索" value={search} onChange={e=>setSearch(e.target.value)}/></label><button className="m10-button secondary" disabled={busy} onClick={()=>void act(()=>rpc.capabilities.scanManaged(),'扫描完成；未启动任何 MCP 或脚本')}><RefreshCw size={14} className={busy?'m13-spin':''}/>{busy?'正在扫描…':'重新扫描'}</button></div>
    </header>
    {((!item&&error)||query.error||builtin.error)&&<div className="m13-alert danger" role="alert">{(!item?error:'')||(query.error?rpcErrorMessage(query.error):builtin.error?rpcErrorMessage(builtin.error):'')}</div>}
    <section className="m13-builtin"><h2 className="m10-section-title">WillYou 内置</h2><div className="m13-cap-list">
      {builtin.data?.skills.map(s=><div className="m13-cap static" key={s.id}><span className="m13-cap-icon"><Sparkles size={16}/></span><span className="m13-cap-main"><b>{s.name}<span className="m10-package-version">{s.current.version}</span></b><small>{s.description}</small><small className="m13-cap-scope">Skill · 随 WillYou 安装到 ~/.agents/skills，所有项目可用</small></span><label className="m13-switch-row"><span>{s.enabled?'已启用':'已停用'}</span><AgentSwitch on={s.enabled} label={(s.enabled?'停用 ':'启用 ')+s.name} disabled={busy} onChange={()=>void act(()=>rpc.capabilities.setBuiltinEnabled(s.id,!s.enabled),s.name+(s.enabled?' 已停用':' 已启用'),{query:{kind:'builtin',id:s.id},kind:s.enabled?'cap-off':'cap-on'})}/></label></div>)}
      {builtin.data&&<div className="m13-cap static"><span className="m13-cap-icon"><Server size={16}/></span><span className="m13-cap-main"><b>WillYou 项目上下文 MCP<span className="m10-package-version">1.0.0</span></b><small>提供当前项目的资源身份与配置路径，宿主专属，不向其他配置迁移。</small><small className="m13-cap-scope">MCP · 每个会话自动提供</small></span><label className="m13-switch-row"><span>{builtin.data.mcpEnabled?'已启用':'已停用'}</span><AgentSwitch on={builtin.data.mcpEnabled} label={(builtin.data.mcpEnabled?'停用 ':'启用 ')+'WillYou 项目上下文 MCP'} disabled={busy} onChange={()=>void act(()=>rpc.capabilities.setBuiltinEnabled('smartdd-project-context',!builtin.data!.mcpEnabled),'WillYou 项目上下文 MCP'+(builtin.data!.mcpEnabled?' 已停用':' 已启用'),{query:{kind:'builtin',id:'smartdd-project-context'},kind:builtin.data!.mcpEnabled?'cap-off':'cap-on'})}/></label></div>}
    </div></section>
    <h2 className="m10-section-title m13-ext-title">从 CLI 发现</h2>
    <div className="m13-alert info"><Info size={16}/><div><strong>第三方 Provider 下 Codex 原生插件不可用</strong><p>插件自带的 Skill／MCP 可在这里发现并纳管；新建或重启会话后生效。</p></div></div>
    {!!query.data?.newCount&&<div className="m13-discover"><Sparkles size={18}/><div><strong>发现 {query.data.newCount} 个新项</strong><p>纳管后会同步配置到另一个工具；同名冲突等需要处理的项不会被一起纳管。</p></div><button className="m10-button primary" disabled={busy} onClick={()=>void act(()=>rpc.capabilities.adoptAll(),'已纳管无冲突项',{query:items.some(x=>x.status==='new')?{kind:'capability',ids:items.filter(x=>x.status==='new').map(x=>x.id),management:true}:null,kind:'cap-on',format:(body,result:CapabilityRegistryView)=>{const ids=new Set(items.filter(x=>x.status==='new').map(x=>x.id)),names=result.items.filter(x=>ids.has(x.id)&&x.managed).map(x=>x.name);return names.length?'已纳管：'+names.join('、')+'；'+body:'没有可纳管的新项';}})}>一键纳管</button></div>}
    <div className="m13-toolbar"><div className="m10-tabs" role="tablist">{(['skill','mcp'] as const).map(v=><button key={v} role="tab" aria-selected={kind===v} onClick={()=>setKind(v)}>{v==='skill'?'Skill':'MCP'}<span className="m13-count">{items.filter(x=>x.kind===v).length}</span></button>)}</div><label className="m13-switch-row"><span>以后自动纳管</span><AgentSwitch on={query.data?.autoManage??false} label="以后自动纳管" disabled={busy||!query.data} onChange={()=>void act(()=>rpc.capabilities.setAutoManage(!query.data!.autoManage))}/></label></div>
    <div className="m13-filters">{(['all','new','managed','attention'] as const).map(v=><button key={v} aria-pressed={filter===v} onClick={()=>setFilter(v)}>{{all:'全部',new:'新发现',managed:'已纳管',attention:'需处理'}[v]}<span>{count[v]}</span></button>)}</div>
    <div className="m13-cap-list">{shown.map(x=><button key={x.id} className="m13-cap" onClick={()=>x.status==='plugin'?toast.info('此能力随所属插件安装、更新和卸载，请在插件详情中管理'):setSelected(x.id)}><span className="m13-cap-icon">{x.kind==='skill'?<Sparkles size={16}/>:<Server size={16}/>}</span><span className="m13-cap-main"><b>{x.name}</b><small>{x.sourcePath}</small><small className="m13-cap-scope">{sourceLabel(x)}</small></span><span className="m13-cap-targets">{(['claude','codex'] as const).map(agent=><span className="m13-target muted" key={agent}><b>{agent==='claude'?'Claude Code':'Codex'}</b>{x.sourceScope==='plugin'?'随插件管理':x.targetIssues?.[agent]?'需处理':x.runner===agent?'来源':x.managed?'待运行配置':'待纳管'}</span>)}</span><Pill tone={attention(x)?'warn':x.managed?'ok':'muted'}>{labels[x.status]}</Pill><ChevronRight size={15} className="m13-chev"/></button>)}{!shown.length&&<div className="m13-empty"><Blocks size={20}/><h3>{filter==='attention'?'没有需要处理的项':'没有匹配的项'}</h3><p>在 Claude Code 或 Codex 中安装后，任务结束或回到本页时会自动发现。</p></div>}</div>
    <p className="m13-footnote"><Info size={14}/>这里不提供安装 Skill 或添加 MCP 的入口。取消纳管只移除 WillYou 为另一个工具做的配置，不删除来源原件。</p>
    {item&&<AgentDialog title={item.name} sub={`${item.kind==='skill'?'Skill':'MCP'} · ${labels[item.status]}`} wide onClose={()=>setSelected(null)} footer={<><button className="m10-button secondary" onClick={()=>setSelected(null)}>关闭</button>{item.status==='new'&&<button className="m10-button primary" disabled={busy} onClick={()=>void act(()=>rpc.capabilities.setManaged(item.id,true),item.name+' 已纳管',{query:{kind:'capability',ids:[item.id],management:true},kind:'cap-on'})}>纳管</button>}{item.managed&&<button className="m10-button secondary" disabled={busy} onClick={()=>void act(()=>rpc.capabilities.setManaged(item.id,false),'已取消纳管',{query:{kind:'capability',ids:[item.id],management:true},kind:'cap-off',format:body=>'已取消纳管 '+item.name+'：'+body+'；来源原件未改动'})}>取消纳管</button>}</>}>
      {error&&<div className="m13-alert danger" role="alert">{error}</div>}
      <dl className="m13-info compact"><dt>来源</dt><dd>{sourceLabel(item)}<code>{item.sourcePath}</code></dd><dt>会话加载</dt><dd>尚未核验；配置成功、会话加载与调用成功分别判断。</dd></dl>
      {item.issues.length>0&&<div className="m13-alert warn">{item.issues.map(s=><p key={s}>{issueLabels[s]??s}</p>)}</div>}
      {item.targetIssues&&Object.entries(item.targetIssues).map(([runner,reason])=><div className="m13-alert warn" key={runner}><b>{runner==='claude'?'Claude Code':'Codex'}</b><p>{reason}</p></div>)}
      {item.status==='conflict'&&<div className="m13-alert warn">同名来源冲突；保留所有原件，不覆盖、不自动改名。</div>}
      {item.projectRoot&&<p className="m13-hint">项目级能力只在该项目的任务中生效，不会扩成全局。Codex 项目链接的 Git 排除只影响显示，不提供隔离。</p>}
      {item.managed&&<label className="m13-switch-row"><span>已启用</span><AgentSwitch on={item.enabled} label="启用技能" disabled={busy} onChange={()=>void act(()=>rpc.capabilities.setManagedEnabled(item.id,!item.enabled),item.name+(item.enabled?' 已停用':' 已启用'),{query:{kind:'capability',ids:[item.id],management:false},kind:item.enabled?'cap-off':'cap-on'})}/></label>}
      {item.kind==='mcp'&&item.managed&&<><h3 className="m13-sub">工具审批</h3><div className="m13-radios" role="radiogroup">{[false,true].map(value=><label className={'m13-radio'+(item.autoApprove===value?' selected':'')} key={String(value)}><input type="radio" name="mcp-approval" checked={item.autoApprove===value} disabled={busy} onChange={()=>void act(()=>rpc.capabilities.setAutoApprove(item.id,value))}/><span><b>{value?'自动批准':'沿用来源设置'}</b><small>{value?'该 MCP 的工具调用不再询问；来源中禁用的工具仍然禁用。':'来源未设置时，每次调用在终端询问。'}</small></span></label>)}</div></>}
    </AgentDialog>}
  </>;
}
