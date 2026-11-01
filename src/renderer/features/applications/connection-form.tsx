import {useEffect,useRef,useState} from 'react';
import {CircleCheck,FolderOpen,LoaderCircle,RefreshCw,ShieldCheck} from 'lucide-react';
import {providerApplication,saveConnectionSchema,type ApplicationConnection,type ApplicationProvider,type ConnectionConfig,type SaveApplicationConnection,type VerifiedConnectionCandidate} from '@shared/application-connections';
import {rpcErrorMessage} from '@shared/ipc/rpc';
import {applicationProviderMetadata,applicationProviderFields} from '@shared/application-provider-metadata';
import type {ApplicationFormField} from '@shared/application-presentation';
import {rpc} from '@renderer/lib/ipc';
import {AppDialog,Field} from './controls';
import {unwrap} from './api';
// Validation text and controls come from the same compiled module metadata as the host catalog.
function validationMessage(issue:{path:PropertyKey[];code:string},kind:ApplicationProvider){
 const path=issue.path.join('.');
 if(path==='name')return issue.code==='too_big'?'连接名称最多120个字符。':issue.code==='too_small'?'请输入连接名称。':'请输入不含控制字符的连接名称。';
 const provider=applicationProviderMetadata(kind),field=applicationProviderFields(provider).find(field=>'config.'+field.key===path);
 if(field)return field.validation;
 if(path==='config.authMode')return provider.secret?.authModeValidation??'不支持的认证方式。';
 return path==='secret'?'请核对认证信息。':'请核对连接配置后再测试。';
}
/** Secrets live only in this form. Main owns test receipts; any edit invalidates the receipt. */
export function ConnectionForm({kind,connection,onClose,onSaved}:{kind:ApplicationProvider;connection?:ApplicationConnection;onClose:()=>void;onSaved:()=>Promise<unknown>}){
 const provider=applicationProviderMetadata(kind);
 const [name,setName]=useState(connection?.name??''),[config,setConfig]=useState<ConnectionConfig>(connection?.config??({...provider.initial} as ConnectionConfig)),[secret,setSecret]=useState(''),[candidate,setCandidate]=useState<VerifiedConnectionCandidate|null>(null),[phase,setPhase]=useState<'idle'|'testing'|'ready'|'saving'>('idle'),[error,setError]=useState(''),[acceptImpact,setAcceptImpact]=useState(false);
 const live=useRef(true),receipt=useRef<VerifiedConnectionCandidate|null>(null),generation=useRef(0),committed=useRef(false),appId=providerApplication(kind);
 const discard=(value:VerifiedConnectionCandidate|null)=>{if(value)void rpc.applications.discardConnectionTest(appId,value.operationId).catch(()=>{});};
 useEffect(()=>{live.current=true;return()=>{live.current=false;generation.current++;if(!committed.current)discard(receipt.current);receipt.current=null;};},[]);
 const invalidate=()=>{generation.current++;discard(receipt.current);receipt.current=null;setCandidate(null);setPhase('idle');setAcceptImpact(false);setError('');};
 const change=(patch:Record<string,unknown>)=>{invalidate();setConfig(current=>({...current,...patch}) as ConnectionConfig);};
 const test=async()=>{
  if(phase==='testing'||phase==='saving')return;invalidate();const attempt=generation.current;
  const input:SaveApplicationConnection={...(connection?{id:connection.id}:{}),name,config,expectedRevision:connection?.revision??0,...(secret?{secret}:{})};const parsed=saveConnectionSchema.safeParse(input);
  if(!parsed.success){setError(parsed.error.issues[0]?validationMessage(parsed.error.issues[0],kind):'请核对连接配置后再测试。');return;}
  if(provider.secret&&!secret&&!connection?.hasSecret){setError('请填写认证凭据后再测试连接');return;}setPhase('testing');
  try{const value=unwrap(await rpc.applications.testConnection(parsed.data));if(!live.current||attempt!==generation.current){discard(value);return;}receipt.current=value;setCandidate(value);setPhase('ready');}
  catch(error){if(live.current&&attempt===generation.current){setError(rpcErrorMessage(error));setPhase('idle');}}
 };
 const save=async()=>{
  if(phase!=='ready'||!candidate)return;if(Date.parse(candidate.expiresAt)<=Date.now()){invalidate();setError('测试结果已过期，请重新测试');return;}if(candidate.compatibility.impacts.length&&!acceptImpact){setError('请先核对受影响的历史版本');return;}setPhase('saving');setError('');
  try{unwrap(await rpc.applications.saveConnection(appId,candidate.operationId,candidate.candidateHash,acceptImpact?candidate.compatibility.planHash:undefined));committed.current=true;receipt.current=null;setSecret('');await onSaved();if(live.current)onClose();}
  catch(error){if(live.current){setError(rpcErrorMessage(error));setPhase('idle');discard(receipt.current);receipt.current=null;setCandidate(null);}}
 };
 const locked=phase==='testing'||phase==='saving';
 const field=(definition:ApplicationFormField)=>{
  const raw=Reflect.get(config,definition.key),value=definition.type==='number'?(typeof raw==='number'&&!Number.isNaN(raw)?raw:''):String(raw??''),disabled=!!connection&&definition.immutable;
  const input=definition.type==='select'?<select aria-label={definition.label} disabled={disabled} value={value} onChange={e=>change({[definition.key]:e.target.value})}>{definition.options?.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select>:<input aria-label={definition.label} type={definition.type==='directory'?'text':definition.type} disabled={disabled} value={value} min={definition.min} max={definition.max} step={definition.step} onChange={e=>change({[definition.key]:definition.type==='number'?(e.target.value===''?Number.NaN:Number(e.target.value)):e.target.value})} placeholder={definition.placeholder} autoComplete={definition.autoComplete} required={definition.required}/>;
  return <Field key={definition.key} title={definition.title} note={definition.note}>{definition.type==='directory'?<div className="m10-input-action">{input}<button type="button" className="m10-button secondary" disabled={disabled} onClick={()=>void rpc.dialog.pickDirectory(String(raw||'')||undefined).then(path=>{if(path&&live.current)change({[definition.key]:path});}).catch(error=>setError(rpcErrorMessage(error)))}><FolderOpen size={14}/>选择目录</button></div>:input}</Field>;
 };
 const secretTitle=provider.secret?.conditionalTitle&&Reflect.get(config,provider.secret.conditionalTitle.field)===provider.secret.conditionalTitle.value?provider.secret.conditionalTitle.title:provider.secret?.title;
 return <AppDialog closingDisabled={phase==='saving'} title={(connection?'编辑／重新连接':'添加')+provider.title+'连接'} onClose={()=>{if(phase!=='saving')onClose();}}><form onSubmit={event=>{event.preventDefault();void save();}}>
  <p className="m10-form-intro"><ShieldCheck size={17}/>认证信息由本机加密存储管理。连接测试不发送邮件。</p>
  {connection&&<p className="m10-note">仅更新同一身份的配置或认证。更换服务、账号或本地来源请添加新连接，再到项目中明确选择。</p>}
  <fieldset disabled={locked} className="m10-form-fields"><Field title="连接名称"><input aria-label="连接名称" maxLength={120} value={name} onChange={event=>{invalidate();setName(event.target.value);}} required/></Field>
  {provider.intro&&<p className="m10-muted">{provider.intro}</p>}
  {provider.groups.map((group,index)=>'row' in group?<div className="m10-form-grid" key={index}>{group.row.map(field)}</div>:field(group))}
  {provider.secret&&<Field title={secretTitle??'认证密码'} note={connection?.hasSecret?'留空沿用当前本机凭据；输入新值会在保存时轮换。':'不会从 Foxmail 或其他连接中提取密码。'}><input aria-label="认证凭据" type="password" value={secret} onChange={e=>{invalidate();setSecret(e.target.value);}} autoComplete="new-password" required={!connection?.hasSecret}/></Field>}</fieldset>
  <div className={'m10-test-status '+phase} role="status">{phase==='testing'?<><LoaderCircle size={16}/>正在测试连接…</>:phase==='ready'?<><CircleCheck size={16}/>身份验证通过，可保存连接</>:phase==='saving'?'正在保存…':'保存前请测试；修改字段后需要重新测试。'}</div>
  {candidate&&candidate.compatibility.impacts.length>0&&<section className="m10-note m10-connection-preflight" aria-label="配置兼容预检"><p>此配置可能影响历史版本：</p><ul>{candidate.compatibility.impacts.map((impact,i)=><li key={i}>v{impact.version}{impact.taskId?' · 会话 '+impact.taskId:''} · {impact.reason}</li>)}</ul><label className="m10-check"><input type="checkbox" checked={acceptImpact} onChange={e=>setAcceptImpact(e.target.checked)}/>已核对影响，仍保存此配置</label></section>}
  {error&&<p className="m10-note" role="alert">{error}</p>}
  <footer><button type="button" className="m10-button secondary" disabled={phase==='saving'} onClick={onClose}>取消</button><button type="button" className="m10-button secondary" disabled={locked} onClick={()=>void test()}><RefreshCw size={14}/>测试连接</button><button className="m10-button primary" disabled={phase!=='ready'||!!candidate?.compatibility.impacts.length&&!acceptImpact}>保存连接</button></footer>
 </form></AppDialog>;
}
