// Trusted built-in package sources. Package versions are independent from the App version.
// A change to the pinned runtime or any released file requires a new application version.
const runtime = { id: 'applications', hash: 'adc15d5422904ec27ee9216e702e8a05139f7a49085aca2774b29d6249ad7625', protocolMajor: 1 };
const str = (maxLength = 4096) => ({ type: 'string', maxLength });
const integer = (minimum = 0, maximum = Number.MAX_SAFE_INTEGER) => ({ type: 'integer', minimum, maximum });
const uuid = { type: 'string', pattern: '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' };
const hash = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const boolean = { type: 'boolean' };
const nullable = schema => ({ anyOf: [schema, { type: 'null' }] });
const array = (items, maxItems = 200) => ({ type: 'array', items, maxItems });
const enumeration = (...values) => ({ type: 'string', enum: values });
const object = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const connection = { connectionId: nullable(uuid) };
const sourceRef = object({ connectionId: uuid, identityRevision: integer(1), nativeId: str(256), contentRevision: hash });
const resourceRef = object({ id: uuid, revision: hash, mediaType: str(200), size: integer() });
const attachment = object({ id: uuid, filename: str(1024), contentType: str(200), size: integer(), contentHash: hash });
const resourceInput = object({ resource: resourceRef, offset: integer(), length: integer(1, 262144) });
const resourceOutput = object({ resourceId: uuid, revision: hash, offset: integer(), length: integer(0, 262144), encoding: enumeration('utf8', 'base64'), data: str(349528), nextOffset: nullable(integer()), eof: boolean });
const page = { cursor: nullable(str(8192)), limit: integer(1, 200) };
const pagination = { nextCursor: nullable(str(8192)), complete: boolean };
const issue = object({ code: str(120), objectId: nullable(str(256)) });
const recipients = { to: array(str(512),100), cc: array(str(512),100), bcc: array(str(512),100) };
const draftHeaders = {
  mode: enumeration('new','reply','reply-all'), sourceMessageRef: nullable(sourceRef), senderConnectionId: nullable(uuid),
  ...recipients, subject: str(2000), inReplyTo: nullable(str(2000)), references: array(str(2000),100), attachmentIds: array(uuid,100),
};
const draftInput = object({ ...draftHeaders, text: str(131072), html: nullable(str(131072)) });
const draftState = enumeration('draft','sending','sent','failed','unknown');
const draft = object({
  id: uuid, revision: integer(1), state: draftState, contentHash: hash,
  content: object({ ...draftHeaders, text: resourceRef, html: nullable(resourceRef) }),
  attachments: array(attachment,100), activeIntentId: nullable(uuid), lastExecutionId: nullable(uuid),
  sourceTaskId: nullable(uuid), copiedFromDraftId: nullable(uuid), createdAt: str(80), updatedAt: str(80),
});
const draftResult = object({ draft });
const sendResult = object({ state: enumeration('server-accepted','failed','unknown'), complete: boolean, accepted: array(str(512),100), rejected: array(str(512),100), errorCode: nullable(str(120)), smtpCode: nullable(integer(100,599)), messageId: str(2000) });
const sendIntent = object({
  id: uuid, draftId: uuid, draftRevision: integer(1),
  state: enumeration('preparing','awaiting-authorization','authorized','executing','server-accepted','failed','unknown','canceled','stale'),
  reviewHash: nullable(hash), review: nullable(resourceRef), authorized: boolean, executionId: nullable(uuid),
  result: nullable(sendResult), errorCode: nullable(str(120)), createdAt: str(80), updatedAt: str(80),
});
const intentResult = object({ intent: sendIntent });
const tool = (appId, name, description, permission, method, input, output, semantics = 'read', retry = 'never', openWorld = true) => ({
  name: `smartdd_${appId}_${name}_v1`, description, contractMajor: 1, permission, input, output,
  annotations: { readOnlyHint: semantics === 'read', destructiveHint: permission === 'mail.send' && name === 'send_execute', idempotentHint: semantics === 'read', openWorldHint: openWorld },
  operation: { method, semantics, retry, timeoutMs: permission === 'mail.send' ? 60000 : 30000 },
});
const zt = (name, description, method, input, output) => tool('zentao',name,description,'zentao.read',method,input,output,'read','safe-read');
const mail = (name, description, permission, method, input, output, semantics = 'read', openWorld = false) => tool('mail',name,description,permission,method,input,output,semantics,semantics === 'read' ? 'safe-read' : 'never',openWorld);
const common = { schema: 'smartdd-app-package-v1', version: '1.0.3', hostApi: { min: 1, max: 1 }, dataApi: 1, runtime, adapter: { entry: 'adapter/index.cjs', format: 'cjs' }, migrations: [] };
const zentaoConfig = object({ kind: { const: 'zentao' }, baseUrl: str(2048), username: str(512), authMode: enumeration('token','password') });
const foxmailConfig = object({ kind: { const: 'foxmail' }, sourcePath: str(4096), account: str(512), queryDays: integer(1,100) },['kind','sourcePath','account']);
const smtpConfig = object({ kind: { const: 'smtp' }, host: str(512), port: integer(1,65535), username: str(512), fromAddress: str(512), authMode: { const: 'password' }, mode: enumeration('plain','starttls','implicit-tls') });
export const definitions = [
  {
    ...common, appId: 'zentao', displayName: '禅道', description: '查询指派给当前账号的 Bug 与研发需求，读取详情、历史和附件，结合项目代码分析。',
    connectionContracts: [{ providerId: 'zentao', configApiMajor: 1, identityContractMajor: 1, inputSchemaPath: 'schemas/connections/zentao.json', authModes: ['token','password'] }],
    connectionSchemas: { zentao: zentaoConfig }, permissions: ['zentao.read'],
    skills: [
      { id: 'bug-analysis', path: 'skills/bug-analysis', entry: 'skills/bug-analysis/SKILL.md', description: '读取本人 Bug、核对复现信息，并结合项目代码分析根因。' },
      { id: 'story-review', path: 'skills/story-review', entry: 'skills/story-review/SKILL.md', description: '核对本人研发需求的描述、验收标准和边界，整理待确认问题。' },
    ],
    tools: [
      zt('work_list','分页查询当前连接账号被指派的 Bug 或研发需求；完整性与空结果分开返回。','zentao.work.list',object({ ...connection, kind: enumeration('bug','story'), ...page },['kind']),object({ kind: enumeration('bug','story'), items: array(object({ id: str(64), title: str(8192), status: str(120), assignedTo: str(512), reference: sourceRef })), total: nullable(integer()), ...pagination, checkedAt: str(80), problems: array(issue) })),
      zt('object_get','读取仍在本人指派范围的对象详情；正文、历史和附件通过有界资源引用返回。','zentao.object.get',object({ kind: enumeration('bug','story'), reference: sourceRef }),object({ kind: enumeration('bug','story'), id: str(64), reference: sourceRef, fields: { type: 'object', additionalProperties: true }, body: nullable(resourceRef), history: nullable(resourceRef), attachments: array(object({ filename: str(1024), resource: resourceRef })), complete: boolean, missing: array(str(120)) })),
      zt('resource','分块读取当前项目授权的禅道正文、历史或附件；保留原来源身份和内容修订。','zentao.resource.read',resourceInput,resourceOutput),
    ],
  },
  {
    ...common, appId: 'mail', displayName: '邮件', description: '只读查询本机 Foxmail 邮件，跨 Agent 接续本地草稿，按明确授权通过项目当前 SMTP 发送。',
    connectionContracts: [
      { providerId: 'foxmail', configApiMajor: 1, identityContractMajor: 1, inputSchemaPath: 'schemas/connections/foxmail.json', authModes: ['local-readonly'] },
      { providerId: 'smtp', configApiMajor: 1, identityContractMajor: 1, inputSchemaPath: 'schemas/connections/smtp.json', authModes: ['password'] },
    ],
    connectionSchemas: { foxmail: foxmailConfig, smtp: smtpConfig }, permissions: ['mail.read','mail.draft','mail.send'],
    skills: [{ id: 'work-assistant', path: 'skills/work-assistant', entry: 'skills/work-assistant/SKILL.md', description: '搜索本地邮件、总结来往内容和待办，准备草稿及经授权的新邮件、回复或回复全部。' }],
    tools: [
      mail('query','在项目明确选定的 Foxmail 来源和配置天数内查询；使用时检查变化，不唤起收信。','mail.read','mail.query',object({ ...connection, text: str(1000), ...page, refresh: boolean },[]),object({ items: array(object({ subject: str(8192), from: str(2000), to: str(8192), date: str(80), messageId: nullable(str(2000)), hasAttachments: boolean, reference: sourceRef })), ...pagination, matched: integer(), range: object({ days: integer(1,100), timeZone: str(120), startDate: str(16), endDate: str(16), start: str(80), endExclusive: str(80) }), checkedAt: str(80), problems: array(issue) }),'read',true),
      mail('read','读取带原来源身份的邮件元信息、正文和普通附件引用；明确缺失或不完整部分。','mail.read','mail.read',object({ reference: sourceRef }),object({ reference: sourceRef, subject: str(8192), from: str(2000), to: str(8192), date: str(80), messageId: nullable(str(2000)), replyTo: array(str(2000),100), inReplyTo: nullable(str(2000)), references: array(str(2000),100), text: resourceRef, html: nullable(resourceRef), attachments: array(object({ filename: str(1024), contentType: str(200), size: integer(), contentHash: hash, contentId: nullable(str(2000)), resource: resourceRef }),100), complete: boolean, missing: array(str(120)) }),'read',true),
      mail('resource_read','分块读取当前项目有权访问的邮件、草稿、审阅或附件资源；不能读取任意磁盘路径。','mail.read','mail.resource.read',resourceInput,resourceOutput),
      mail('draft_list','分页查看当前项目的本地草稿与发送状态，不依赖 Foxmail 或 SMTP 已配置。','mail.draft','mail.draft.list',object(page,[]),object({ items: array(object({ id: uuid, revision: integer(1), state: draftState, subject: str(2000), attachmentCount: integer(0,100), createdAt: str(80), updatedAt: str(80) })), nextCursor: nullable(str(8192)) })),
      mail('draft_get','读取当前项目草稿的指定或当前修订，正文使用稳定资源引用。','mail.draft','mail.draft.get',object({ draftId: uuid, revision: integer(1) },['draftId']),draftResult),
      mail('draft_create','保存独立的本地草稿；可以没有收件人或发件账号，不自动发送。','mail.draft','mail.draft.create',object({ content: draftInput }),draftResult,'write'),
      mail('draft_update','按明确修订更新草稿；并发冲突不能覆盖其他 Agent 或页面的修改。','mail.draft','mail.draft.update',object({ draftId: uuid, expectedRevision: integer(1), content: draftInput }),draftResult,'write'),
      mail('draft_copy','把指定草稿修订复制为新 ID，原已发送或结果未知的内容保持可追溯。','mail.draft','mail.draft.copy',object({ draftId: uuid, expectedRevision: integer(1) }),draftResult,'write'),
      mail('reply_create','依据原邮件创建回复或回复全部草稿，按当前 SMTP 身份计算收件人并保留来源。','mail.draft','mail.reply.create',object({ reference: sourceRef, mode: enumeration('reply','reply-all'), senderConnectionId: nullable(uuid), text: str(131072), html: nullable(str(131072)) },['reference','mode','senderConnectionId','text']),draftResult,'write',true),
      mail('attach_import','把已授权的邮件资源或工作区文件复制为草稿的稳定业务附件，不传任意路径。','mail.draft','mail.attachment.import',object({ source: { oneOf: [object({ kind: { const: 'resource' }, resource: resourceRef, filename: str(1024), contentType: str(200) }),object({ kind: { const: 'workspace-file' }, referenceId: uuid, expectedHash: hash, filename: str(1024), contentType: str(200) })] } }),object({ attachment }),'write',true),
      mail('send_prepare','冻结指定草稿修订、发件身份、收件人、正文及附件，生成审阅意图；本操作不提交 SMTP。','mail.send','mail.send.prepare',object({ draftId: uuid, expectedRevision: integer(1), expectedContentHash: hash }),intentResult,'write'),
      mail('send_execute','执行已由宿主核验具体用户授权的冻结意图；同一意图只提交一次，unknown 不自动重发。','mail.send','mail.send.execute',object({ intentId: uuid, expectedReviewHash: hash }),intentResult,'write',true),
      mail('send_get','读取当前项目发送意图及已有实际结果，不重放发送。','mail.draft','mail.send.get',object({ intentId: uuid }),intentResult),
      mail('send_cancel','取消尚未提交的意图或记录停止等待请求；已提交邮件不能被撤回。','mail.draft','mail.send.cancel',object({ intentId: uuid }),intentResult,'write'),
    ],
  },
];

// Keep the released input/output declarations intact for existing sessions.
// The default distribution contains one version per application.
export const mailV103Definition = definitions.find(definition => definition.appId === 'mail');
const mailV104Definition = structuredClone(mailV103Definition);
mailV104Definition.version = '1.0.4';
const windowMethods = new Set(['mail.query', 'mail.read', 'mail.resource.read', 'mail.reply.create', 'mail.draft.create', 'mail.draft.update', 'mail.attachment.import']);
for (const declaration of mailV104Definition.tools) {
  if (!windowMethods.has(declaration.operation.method)) continue;
  declaration.input.properties.queryDays = integer(1, 100);
  declaration.description += ' 可选 queryDays 为用户明确要求的本次 1–100 天范围；省略沿用连接默认，读取原来源的后续调用须传同一范围，不修改默认值或自动扩大。';
}
definitions[definitions.indexOf(mailV103Definition)] = mailV104Definition;
