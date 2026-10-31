import {useEffect,useRef,useState} from 'react';
import {CircleCheck,FolderOpen,LoaderCircle,RefreshCw,ShieldCheck} from 'lucide-react';
import {providerApplication,saveConnectionSchema,type ApplicationConnection,type ApplicationProvider,type ConnectionConfig,type SaveApplicationConnection,type VerifiedConnectionCandidate} from '@shared/application-connections';
import {rpcErrorMessage} from '@shared/ipc/rpc';
import {rpc} from '@renderer/lib/ipc';
import {AppDialog,Field} from './controls';
import {unwrap} from './api';
const initial=(kind:ApplicationProvider):ConnectionConfig=>kind==='zentao'?{kind,baseUrl:'',username:'',authMode:'token'}:kind==='foxmail'?{kind,sourcePath:'',account:'',queryDays:30}:{kind,host:'',port:465,username:'',fromAddress:'',authMode:'password',mode:'implicit-tls'};
const titles={zentao:'禅道',foxmail:'Foxmail 本地读取',smtp:'SMTP 发件'};
/** Secrets live only in this form. Main owns test receipts; any edit invalidates the receipt. */
export function ConnectionForm({kind,connection,onClose,onSaved}:{kind:ApplicationProvider;connection?:ApplicationConnection;onClose:()=>void;onSaved:()=>Promise<unknown>}){
 const [name,setName]=useState(connection?.name??''),[config,setConfig]=useState<ConnectionConfig>(connection?.config??initial(kind)),[secret,setSecret]=useState(''),[candidate,setCandidate]=useState<VerifiedConnectionCandidate|null>(null),[phase,setPhase]=useState<'idle'|'testing'|'ready'|'saving'>('idle'),[error,setError]=useState(''),[acceptImpact,setAcceptImpact]=useState(false);
 const live=useRef(true),receipt=useRef<VerifiedConnectionCandidate|null>(null),generation=useRef(0),committed=useRef(false),appId=providerApplication(kind);
 const discard=(value:VerifiedConnectionCandidate|null)=>{if(value)void rpc.applications.discardConnectionTest(appId,value.operationId).catch(()=>{});};
 useEffect(()=>{live.current=true;return()=>{live.current=false;generation.current++;if(!committed.current)discard(receipt.current);receipt.current=null;};},[]);
 const invalidate=()=>{generation.current++;discard(receipt.current);receipt.current=null;setCandidate(null);setPhase('idle');setAcceptImpact(false);setError('');};
 const change=(patch:Partial<ConnectionConfig>)=>{invalidate();setConfig(current=>({...current,...patch}) as ConnectionConfig);};
 const test=async()=>{
  if(phase==='testing'||phase==='saving')return;invalidate();const attempt=generation.current;
  const input:SaveApplicationConnection={...(connection?{id:connection.id}:{}),name,config,expectedRevision:connection?.revision??0,...(secret?{secret}:{})};const parsed=saveConnectionSchema.safeParse(input);
  if(!parsed.success){setError(parsed.error.issues[0]?.message??'请核对连接配置');return;}setPhase('testing');
  try{const value=unwrap(await rpc.applications.testConnection(parsed.data));if(!live.current||attempt!==generation.current){discard(value);return;}receipt.current=value;setCandidate(value);setPhase('ready');}
  catch(error){if(live.current&&attempt===generation.current){setError(rpcErrorMessage(error));setPhase('idle');}}
 };
 const save=async()=>{
  if(phase!=='ready'||!candidate)return;if(Date.parse(candidate.expiresAt)<=Date.now()){invalidate();setError('测试结果已过期，请重新测试');return;}if(candidate.compatibility.impacts.length&&!acceptImpact){setError('请先核对受影响的历史版本');return;}setPhase('saving');setError('');
  try{unwrap(await rpc.applications.saveConnection(appId,candidate.operationId,candidate.candidateHash,acceptImpact?candidate.compatibility.planHash:undefined));committed.current=true;receipt.current=null;setSecret('');await onSaved();if(live.current)onClose();}
  catch(error){if(live.current){setError(rpcErrorMessage(error));setPhase('idle');discard(receipt.current);receipt.current=null;setCandidate(null);}}
 };
 const locked=phase==='testing'||phase==='saving';
 return <AppDialog closingDisabled={phase==='saving'} title={(connection?'编辑／重新连接':'添加')+titles[kind]+'连接'} onClose={()=>{if(phase!=='saving')onClose();}}><form onSubmit={event=>{event.preventDefault();void save();}}>
  <p className="m10-form-intro"><ShieldCheck size={17}/>认证信息由本机加密存储管理。连接测试不发送邮件。</p>
  {connection&&<p className="m10-note">仅更新同一身份的配置或认证。更换服务、账号或本地来源请添加新连接，再到项目中明确选择。</p>}
  <fieldset disabled={locked} className="m10-form-fields"><Field title="连接名称"><input aria-label="连接名称" maxLength={120} value={name} onChange={event=>{invalidate();setName(event.target.value);}} required/></Field>
  {config.kind==='zentao'&&<><Field title="服务地址"><input aria-label="禅道服务地址" type="url" disabled={!!connection} value={config.baseUrl} onChange={e=>change({baseUrl:e.target.value})} placeholder="https://zentao.example.com/" required/></Field><Field title="账号"><input aria-label="禅道账号" disabled={!!connection} value={config.username} onChange={e=>change({username:e.target.value})} autoComplete="off" required/></Field><Field title="认证方式"><select aria-label="禅道认证方式" value={config.authMode} onChange={e=>change({authMode:e.target.value as 'token'|'password'})}><option value="token">Token</option><option value="password">密码</option></select></Field></>}
  {config.kind==='foxmail'&&<><Field title="Foxmail 本地来源" note="选择单个本机邮箱账号的来源目录或 messages.db；只读原文件，不触发收信。"><div className="m10-input-action"><input aria-label="Foxmail 本地来源" disabled={!!connection} value={config.sourcePath} onChange={e=>change({sourcePath:e.target.value})} placeholder="本机来源完整路径" required/><button type="button" className="m10-button secondary" disabled={!!connection} onClick={()=>void rpc.dialog.pickDirectory(config.sourcePath||undefined).then(path=>{if(path&&live.current)change({sourcePath:path});}).catch(error=>setError(rpcErrorMessage(error)))}><FolderOpen size={14}/>选择目录</button></div></Field><Field title="邮箱账号"><input aria-label="Foxmail 邮箱账号" disabled={!!connection} value={config.account} onChange={e=>change({account:e.target.value})} placeholder="me@example.com" required/></Field><Field title="默认查询天数" note="含当天，按本机时区计算；查询范围与缓存保留时间独立。"><input aria-label="邮件查询天数" type="number" min={1} max={100} step={1} value={config.queryDays} onChange={e=>change({queryDays:Number(e.target.value)})} required/></Field></>}
  {config.kind==='smtp'&&<><p className="m10-muted">通过独立 SMTP 服务器发送，在 WillYou 保留结果，不写入 Foxmail 已发送。</p><div className="m10-form-grid"><Field title="服务主机"><input aria-label="SMTP 服务主机" disabled={!!connection} value={config.host} onChange={e=>change({host:e.target.value})} required/></Field><Field title="端口"><input aria-label="SMTP 端口" type="number" min={1} max={65535} value={config.port} onChange={e=>change({port:Number(e.target.value)})} required/></Field></div><Field title="连接方式"><select aria-label="SMTP 连接方式" value={config.mode} onChange={e=>change({mode:e.target.value as 'plain'|'starttls'|'implicit-tls'})}><option value="implicit-tls">隐式 TLS</option><option value="starttls">STARTTLS</option><option value="plain">不加密（按服务配置）</option></select></Field><Field title="登录账号"><input aria-label="SMTP 登录账号" disabled={!!connection} value={config.username} onChange={e=>change({username:e.target.value})} autoComplete="off" required/></Field><Field title="发件地址"><input aria-label="SMTP 发件地址" type="email" disabled={!!connection} value={config.fromAddress} onChange={e=>change({fromAddress:e.target.value})} required/></Field></>}
  {config.kind!=='foxmail'&&<Field title={config.kind==='zentao'&&config.authMode==='token'?'Token':'认证密码'} note={connection?.hasSecret?'留空沿用当前本机凭据；输入新值会在保存时轮换。':'不会从 Foxmail 或其他连接中提取密码。'}><input aria-label="认证凭据" type="password" value={secret} onChange={e=>{invalidate();setSecret(e.target.value);}} autoComplete="new-password" required={!connection?.hasSecret}/></Field>}</fieldset>
  <div className={'m10-test-status '+phase} role="status">{phase==='testing'?<><LoaderCircle size={16}/>正在测试连接…</>:phase==='ready'?<><CircleCheck size={16}/>身份验证通过，可保存连接</>:phase==='saving'?'正在保存…':'保存前请测试；修改字段后需要重新测试。'}</div>
  {candidate&&candidate.compatibility.impacts.length>0&&<div className="m10-note"><p>此配置可能影响历史版本：</p>{candidate.compatibility.impacts.map((impact,i)=><p key={i}>v{impact.version}{impact.taskId?' · 会话 '+impact.taskId:''} · {impact.reason}</p>)}<label><input type="checkbox" checked={acceptImpact} onChange={e=>setAcceptImpact(e.target.checked)}/>已核对影响，仍保存此配置</label></div>}
  {error&&<p className="m10-note" role="alert">{error}</p>}
  <footer><button type="button" className="m10-button secondary" disabled={phase==='saving'} onClick={onClose}>取消</button><button type="button" className="m10-button secondary" disabled={locked} onClick={()=>void test()}><RefreshCw size={14}/>测试连接</button><button className="m10-button primary" disabled={phase!=='ready'||!!candidate?.compatibility.impacts.length&&!acceptImpact}>保存连接</button></footer>
 </form></AppDialog>;
}
