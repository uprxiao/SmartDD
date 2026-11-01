import {useQuery} from '@tanstack/react-query';
import type {ApplicationId} from '@shared/application-connections';
import {mailSenderIdentityStatusSchema,type MailSenderIdentityStatus} from '@shared/mail-sender-identity';
import {rpc} from '@renderer/lib/ipc';
import {unwrap,useApplicationAction} from './api';
const labels:Record<MailSenderIdentityStatus['state'],string>={unconfigured:'未选用发件账号',automatic:'发件身份已自动确认',confirmed:'发件身份已由用户确认','needs-confirmation':'需要确认发件身份',invalidated:'发件身份确认已失效',mismatch:'发件地址与 Foxmail 账号不一致'};
const tones:Record<MailSenderIdentityStatus['state'],string>={unconfigured:'muted',automatic:'ok',confirmed:'ok','needs-confirmation':'warn',invalidated:'warn',mismatch:'error'};
/** Same approved status view in project settings and session diagnostics; only the project view can confirm. */
export function SenderIdentityStatus({projectId,appId,disabled=false,readOnly=false}:{projectId:string;appId:ApplicationId;disabled?:boolean;readOnly?:boolean}){
 const action=useApplicationAction(),query=useQuery({queryKey:['applications','project-policy',projectId,appId],queryFn:async()=>mailSenderIdentityStatusSchema.parse(unwrap(await rpc.applications.projectPolicy(projectId,appId))),retry:false});
 if(query.isPending)return <section className="m10-sender-identity muted" aria-label="发件身份"><strong>发件身份</strong><p className="m10-muted" role="status">正在核对发件身份…</p></section>;
 if(query.error||!query.data)return <section className="m10-sender-identity warn" aria-label="发件身份"><strong>发件身份</strong><p className="m10-note" role="alert">发件身份暂未核实；读取与草稿不受影响，发送前请重新核对。</p><button className="m10-button secondary" onClick={()=>void query.refetch()}>重新核对发件身份</button></section>;
 const status=query.data;
 return <section className={'m10-sender-identity '+tones[status.state]} aria-label="发件身份" data-status={status.state}>
  <header><strong>发件身份</strong><span className="m10-state" role="status">{labels[status.state]}</span></header>
  <p className={status.state==='mismatch'?'m10-note':'m10-muted'} role={status.state==='mismatch'?'alert':undefined}>{status.message}{status.fromAddress&&<> · {status.fromAddress}</>}</p>
  {!readOnly&&status.canConfirm&&status.bindingHash&&<div className="m10-sender-actions"><button className="m10-button secondary" disabled={disabled||!!action.busy||query.isFetching} onClick={()=>void action.run('sender-identity',async()=>unwrap(await rpc.applications.projectAction(projectId,appId,{action:'confirm-sender',arguments:{expectedBindingHash:status.bindingHash,confirmed:true}})))}>{action.busy?'正在确认…':status.state==='invalidated'?'重新确认发件身份':'确认这是我的发件身份'}</button><small className="m10-muted">确认只对当前发件账号、Foxmail 来源及其修订有效；任一变化后需重新确认。</small></div>}
  {status.state==='mismatch'&&<p className="m10-muted">此情形不能通过确认覆盖。可改选发件地址一致的 SMTP 账号，或更换 Foxmail 来源。</p>}
  {action.error&&<p className="m10-note" role="alert">{action.error}</p>}
 </section>;
}
