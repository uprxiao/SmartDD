import {AttachmentSaveButton} from './attachment-save';
import {useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {attachmentHasTextPreview,type MailAttachmentTarget,type MailAttachmentSource} from '@shared/application-attachments';
import {rpc} from '@renderer/lib/ipc';
import {unwrap} from './api';
import {AppDialog,AppEmpty} from './controls';
import {ResourceView} from './resource-view';
export function MailAttachmentPreview({projectId,target}:{projectId:string;target:MailAttachmentTarget}){
 const [open,setOpen]=useState(false),query=useQuery({queryKey:['applications','attachment',projectId,target],enabled:open,queryFn:async()=>unwrap(await rpc.applications.attachment(projectId,target)),retry:false,refetchOnWindowFocus:false});
 return <div className="m10-attachment-preview"><button className="m10-button secondary" aria-expanded={open} onClick={()=>setOpen(v=>!v)}>{open?'收起附件文字':'查看附件文字'}</button>{open&&((query.isPending||query.isFetching)?<p role="status">正在核对原附件…</p>:query.error?<AppEmpty error title="附件无法读取" text={query.error.message} action="重试" onAction={()=>void query.refetch()}/>:query.data&&<><p className="m10-muted">{query.data.filename} · {query.data.size} 字节；仅显示文字，不执行内容或加载远程资源。</p>{attachmentHasTextPreview(query.data.contentType)?<ResourceView resource={query.data.resource} scope={projectId} read={offset=>rpc.applications.attachmentResource(projectId,{target,offset,length:65536}).then(unwrap)}/>:<p>该附件不是支持的文字类型，未将它解码或分析。</p>}</>)}</div>;
}
export function MailAttachmentsDialog({projectId,source,onClose}:{projectId:string;source:MailAttachmentSource;onClose:()=>void}){
 const query=useQuery({queryKey:['applications','mail-attachments',projectId,source],queryFn:async()=>unwrap(await rpc.applications.mailAttachmentList(projectId,source)),retry:false,refetchOnWindowFocus:false}),value=query.data,[saving,setSaving]=useState(false);
 return <AppDialog title="原邮件附件" wide closingDisabled={saving} onClose={onClose}>{(query.isPending||query.isFetching)?<AppEmpty loading title="正在核对原邮件" text="依据原引用与当前项目权限读取本机来源。"/>:query.error?<AppEmpty error title="原邮件附件不可用" text={query.error.message} action="重试" onAction={()=>void query.refetch()}/>:value&&<><p>{value.subject||'（无主题）'} · {value.from}</p>{!value.complete&&<p className="m10-note" role="status">原邮件内容未完整读取：{value.missing.join('、')||'存在未完成的部分'}；未自动从其他来源补取。</p>}{value.attachments.map(a=><div className="m10-attachment m10-mail-attachment" key={a.resource.id}><span>{a.filename} · {a.size} 字节</span><AttachmentSaveButton projectId={projectId} target={{kind:'mail',source,resource:a.resource}} disabled={saving} onBusyChange={setSaving}/>{attachmentHasTextPreview(a.contentType)&&<MailAttachmentPreview projectId={projectId} target={{kind:'mail',source,resource:a.resource}}/>}</div>)}{!value.attachments.length&&<p>{value.complete?'这封原邮件没有可列出的附件。':'当前没有可列出的附件，不能据此判断原邮件无附件。'}</p>}</>}<footer><button className="m10-button secondary" disabled={saving} onClick={onClose}>返回原记录</button></footer></AppDialog>;
}
