import { isAbsolute } from 'node:path';
import { ApplicationError } from '@shared/applications';
import { foxmailConfigSchema, smtpConfigSchema } from '@shared/application-connections';
import type { LegacyCapabilityPolicy } from '@shared/application-capabilities';
import type { MailDraftDataService } from '../../draft-data-service';
import type { MailReadDataService } from '../../mail-read-data-service';
import type { MailSendDataService } from '../../mail-send-data-service';
import { MailWorkerClient } from '../../providers/mail-worker-client';
import { verifySmtp } from '../../providers/smtp';
import type { ApplicationModuleDefinition, ApplicationProviderDefinition } from '../registry';
import {retainedConfigViewDefinitions} from '../retained-config-views';
import {MailSenderIdentity} from './sender-identity';
import {z} from 'zod';
import {applicationPreflightFailure} from '../../capability-preflight';

export interface RetainedMailData { drafts: MailDraftDataService; reads: MailReadDataService; sends: MailSendDataService }
const read = (id: string, required: string[] = [], conditional: string[] = []): LegacyCapabilityPolicy => ({ id, semantics: 'read', retry: 'safe-read', slots: { required, conditional } });
const write = (id: string, kind: NonNullable<LegacyCapabilityPolicy['protection']>['kind'], object: string, key: string, required: string[] = [], conditional: string[] = []): LegacyCapabilityPolicy => ({ id, semantics: 'write', retry: 'never', protection: { kind, object, key }, slots: { required, conditional } });
const policies: Readonly<Record<string, LegacyCapabilityPolicy>> = {
  query: read('mail.message.query', ['foxmail']), read: read('mail.message.read', ['foxmail']), resource_read: read('mail.resource.read', [], ['foxmail']),
  draft_list: read('mail.draft.list'), draft_get: read('mail.draft.get'),
  draft_create: write('mail.draft.create', 'operation-receipt', 'mail_draft_mutations', 'operationId', [], ['smtp']),
  draft_update: write('mail.draft.update', 'revision', 'mail_drafts', 'expectedRevision', [], ['smtp', 'foxmail']),
  draft_copy: write('mail.draft.copy', 'revision', 'mail_drafts', 'expectedRevision'),
  reply_create: write('mail.reply.create', 'operation-receipt', 'mail_draft_mutations', 'operationId', ['foxmail'], ['smtp']),
  attach_import: write('mail.attachment.import', 'operation-receipt', 'mail_draft_mutations', 'operationId', [], ['foxmail']),
  send_prepare: write('mail.send.prepare', 'revision', 'mail_drafts', 'expectedRevision', ['smtp']),
  send_execute: { ...write('mail.send.execute', 'business-intent', 'mail_send_intent', 'intentId', ['smtp']), semantics: 'external-write', approval: 'host-observed-user-authorization' },
  send_get: read('mail.send.get'), send_cancel: write('mail.send.cancel', 'business-intent', 'mail_send_intent', 'intentId'),
};
const methodAliases:Readonly<Record<string,string>>={query:'mail.query',read:'mail.read',resource_read:'mail.resource.read'};
export const mailModule: ApplicationModuleDefinition<'mail', readonly [ApplicationProviderDefinition<typeof foxmailConfigSchema, 'foxmail', 'mail'>, ApplicationProviderDefinition<typeof smtpConfigSchema, 'smtp', 'mail'>]> = {
  appId: 'mail', contractMajors: [1], slots: ['foxmail', 'smtp'], stopBeforeSwitch: false,
  capabilities:Object.fromEntries(Object.entries(policies).map(([key,policy])=>[policy.id,{...policy,method:methodAliases[key]??policy.id,contractMajors:[1,2],permission:['query','read','resource_read'].includes(key)?'mail.read':['send_prepare','send_execute'].includes(key)?'mail.send':'mail.draft'}])),
  legacyToolNames:Object.fromEntries(Object.entries(policies).map(([key,policy])=>[policy.id,`smartdd_mail_${key}_v1`])),
  presentation: { projectPolicy:'sender-identity',displayName: '邮件', heading: '在项目 Agent 中查询、准备草稿与获准发送邮件', mark: 'envelope', projectNote: '每项目至多选择一个本地读取来源和一个 SMTP 发件账号，两者分别配置、分别选用。', emptyConnectionSuffix: '或本地邮件来源', defaultProvider: 'foxmail', panel: 'mail-work', switchTitle: '切换项目邮件连接' },
  providers: [{
    id: 'foxmail', appId: 'mail', readDefaultKeys: ['queryDays'], configApiMajor: 1, configSchema: foxmailConfigSchema,
    configViews: retainedConfigViewDefinitions.filter(v=>v.providerId==='foxmail'),
    authentication: { kind: 'none', mode: 'local-readonly' }, permissions: { read: 'mail.read', write: 'mail.read' },
    validateCandidate(value, previous) {
      const config = foxmailConfigSchema.parse(value);
      if (!isAbsolute(config.sourcePath)) throw new ApplicationError('INVALID_INPUT', '请选择本机Foxmail的完整来源路径');
      if (previous?.kind === 'foxmail' && foxmailConfigSchema.parse(previous).sourcePath !== config.sourcePath) throw new ApplicationError('IDENTITY_CHANGE_REQUIRES_SELECTION', '已有来源路径不能覆盖，请新建来源并显式选用');
    },
    presentation: {
      id: 'foxmail', appId: 'mail', title: 'Foxmail 本地读取', diagnosticTitle: '邮件来源', initial: { kind: 'foxmail', sourcePath: '', account: '', queryDays: 30 },
      icon: 'folder', summaryFields: ['account', 'sourcePath'], locationField: 'sourcePath',
      project: { title: '本地读取来源', unselectedNote: '查询时提示来源未配置，不自动选择其他连接。' },
      groups: [
        { key: 'sourcePath', title: 'Foxmail 本地来源', label: 'Foxmail 本地来源', type: 'directory', required: true, immutable: true, placeholder: '本机来源完整路径', note: '选择单个本机邮箱账号的来源目录或 messages.db；只读原文件，不触发收信。', validation: '请选择完整的本地来源路径。' },
        { key: 'account', title: '邮箱账号', label: 'Foxmail 邮箱账号', type: 'text', required: true, immutable: true, placeholder: 'me@example.com', validation: '请明确填写这个本地来源的邮箱账号。' },
        { key: 'queryDays', title: '默认查询天数', label: '邮件查询天数', type: 'number', required: true, min: 1, max: 100, step: 1, note: '含当天，按本机时区计算；查询范围与缓存保留时间独立。', validation: '请输入1–100之间的整数天数。' },
      ], secret: null,
    },
    async verify(value, _secret, signal, runtime) { const client = new MailWorkerClient(runtime.mailWorker, runtime.foxmailNative); try { return await client.verify(foxmailConfigSchema.parse(value), signal); } finally { await client.close(); } },
  }, {
    id: 'smtp', appId: 'mail', configApiMajor: 1, configSchema: smtpConfigSchema,
    configViews: retainedConfigViewDefinitions.filter(v=>v.providerId==='smtp'),
    authentication: { kind: 'secret', modes: ['password'] }, permissions: { read: 'mail.send', write: 'mail.send' },
    presentation: {
      id: 'smtp', appId: 'mail', title: 'SMTP 发件', diagnosticTitle: '发件账号', initial: { kind: 'smtp', host: '', port: 465, username: '', fromAddress: '', authMode: 'password', mode: 'implicit-tls' },
      intro: '通过独立 SMTP 服务器发送，在 WillYou 保留结果，不写入 Foxmail 已发送。', icon: 'send', summaryFields: ['fromAddress', 'host'], locationField: 'host',
      project: { title: 'SMTP 发件账号', unselectedTitle: 'SMTP发件账号', unselectedNote: '仍可保存草稿；发送时需要有效发件账号。' },
      supplemental: { title: '邮件发送', note: '待配置 · 与本地读取分别连接', action: '配置发件通道' },
      groups: [
        { row: [
          { key: 'host', title: '服务主机', label: 'SMTP 服务主机', type: 'text', format: 'host', required: true, immutable: true, validation: '请填写邮件服务主机名。' },
          { key: 'port', title: '端口', label: 'SMTP 端口', type: 'number', required: true, min: 1, max: 65535, validation: '端口必须为1–65535之间的整数。' },
        ] },
        { key: 'mode', title: '连接方式', label: 'SMTP 连接方式', type: 'select', options: [{ value: 'implicit-tls', label: '隐式 TLS' }, { value: 'starttls', label: 'STARTTLS' }, { value: 'plain', label: '不加密（按服务配置）' }], validation: '不支持的 SMTP 连接方式。' },
        { key: 'username', title: '登录账号', label: 'SMTP 登录账号', type: 'text', required: true, immutable: true, autoComplete: 'off', validation: '请输入有效的SMTP登录账号。' },
        { key: 'fromAddress', title: '发件地址', label: 'SMTP 发件地址', type: 'email', required: true, immutable: true, validation: '请输入有效的发件地址。' },
      ], secret: { title: '认证密码', authModeValidation: '不支持的发件认证方式。' },
    },
    verify: (value, secret, signal) => verifySmtp(smtpConfigSchema.parse(value), secret, signal),
  }],
  legacyPolicy(tool): LegacyCapabilityPolicy {
    const match = /^smartdd_mail_(.+)_v1$/.exec(tool.name), policy = match && policies[match[1]];
    if (!policy) throw new ApplicationError('HOST_INCOMPATIBLE', '该旧邮件工具没有受信业务映射');
    return structuredClone(policy);
  },
  createData(services) {
    const data = services.retained.get('mail') as RetainedMailData | undefined;
    if (!data?.drafts || !data.reads || !data.sends) throw new ApplicationError('CAPABILITY_UNAVAILABLE', '邮件业务服务尚未准备');
    const identity=new MailSenderIdentity(services.store,services.connections,services.selections,services.contexts);
    const target = (method: string) => method.startsWith('mail.send.') ? data.sends : ['mail.query', 'mail.read', 'mail.resource.read'].includes(method) ? data.reads : data.drafts;
    return {receiptOnly(context,method,input){
      services.contexts.assertActive(context);if(method!=='mail.send.execute')return false;
      const parsed=z.object({intentId:z.uuid(),expectedReviewHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict().safeParse(input);if(!parsed.success)return false;
      const row=services.store.sqlite.prepare('SELECT project_id,source_task_id,source_run_id,review_hash,execution_id FROM mail_send_intents WHERE id=?').get(parsed.data.intentId) as {project_id:string;source_task_id:string|null;source_run_id:string|null;review_hash:string|null;execution_id:string|null}|undefined;
      return !!row&&!!row.execution_id&&row.project_id===context.projectId&&row.source_task_id===context.taskId&&row.source_run_id===context.runId&&row.review_hash===parsed.data.expectedReviewHash;
    },legacyData:data.drafts,projectPolicy:{
      status:projectId=>identity.status(projectId),validateSelection:(projectId,slots)=>identity.validateSelection(projectId,slots),afterSelection:projectId=>identity.afterSelection(projectId),
      stamp:(projectId,permission)=>permission==='mail.send'?identity.requireConfirmed(projectId):null,
      action:(context,sender,input)=>{const parsed=z.object({action:z.literal('confirm-sender'),arguments:z.unknown()}).strict().safeParse(input);if(!parsed.success)throw new ApplicationError('INVALID_INPUT','此项目身份操作无效');return identity.confirm(context,String(sender.sender.id),parsed.data.arguments);},
    },resolve: (version, method, binding) => target(method).resolve(version, method, binding),execute: async (context, method, input) => {
      try{
      services.contexts.assertActive(context);
      if(['mail.draft.create','mail.draft.update','mail.reply.create'].includes(method)&&input&&typeof input==='object'){
        const content=method==='mail.reply.create'?input:Reflect.get(input,'content');
        const selected=content&&typeof content==='object'?Reflect.get(content,'senderConnectionId'):null;
        // A draft's sender reference is scoped to this project, but is not a
        // send authorization. SMTP health/confirmation only gates sending.
        if(typeof selected==='string')await services.contexts.draftSender(context,selected);
      }
      // Reply preparation checks an existing mismatched pair, without requiring
      // a send confirmation or blocking unconfirmed/invalidated draft work.
      if(method==='mail.reply.create'&&context.projectId)identity.validateSelection(context.projectId);
      }catch(error){throw applicationPreflightFailure(error,context.operationId);}
      return target(method).execute(context,method,input);
    }};
  },
};
