import{isPublicDraftFixture}from'./draft-recovery-preview.mjs';
// Fixed synthetic P08 records. No credentials, external calls or real run IDs.
const id = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value) ? value : null;
export function projectDemoActivity(record) {
  const callerKind = ['ui', 'agent-run', 'index-job'].includes(record.callerKind) ? record.callerKind : 'ui';
  return {
    id: String(record.id), ...(isPublicDraftFixture(record.draftFixture)?{draftFixture:record.draftFixture}:{}), app: record.app === 'zentao' ? 'zentao' : 'mail',
    operation: String(record.operation || ''),
    status: ['success','failed','unknown','handoff','draft','sending'].includes(record.status) ? record.status : 'unknown',
    project: id(record.project), connectionId: String(record.connectionId || ''), at: String(record.at || ''),
    actor: String(record.actor || ''), draftId: id(record.draftId) || '', revision: Number(record.revision) || null,
    callerKind, category: ['read','draft','write','configuration'].includes(record.category) ? record.category : 'read',
    taskId: callerKind === 'agent-run' ? id(record.taskId) : null,
    taskTitle: callerKind === 'agent-run' ? String(record.taskTitle || '') : '',
    runId: callerKind === 'agent-run' ? id(record.runId) : null,
    jobId: callerKind === 'index-job' ? id(record.jobId) : null,
    errorFixture: record.errorFixture === 'long-auth' ? 'long-auth' : null,
  };
}
export const activitySource = record => record.callerKind === 'agent-run'
  ? '项目 Agent · ' + (record.taskTitle || '原任务标识保留')
  : record.callerKind === 'index-job' ? '使用触发索引' : '界面操作';
export const activityCategory = record => ({read:'读取',draft:'草稿与附件',write:'SMTP 发送',configuration:'配置与状态'})[record.category] || '读取';
export const activityError = record => record.errorFixture === 'long-auth'
  ? 'AUTH_REQUIRED · 原连接认证失效；请核对当前连接身份后重新验证。'.repeat(12) + ' 未记录密码、令牌或认证头。'
  : record.status === 'failed' ? '本次操作失败；检查原连接或草稿后再明确下一步。' : '';
export function filterDemoActivity(records, {app='all',connection='all',project='all'}={}) {
  return records.filter(record => (app === 'all' || record.app === app)
    && (connection === 'all' || record.connectionId === connection)
    && (project === 'all' || (project === 'global' ? record.project == null : record.project === project)));
}
export function demoActivityRecovery(record, state) {
  const draft = state.drafts?.find(d => d.id === record.draftId && d.project === record.project);
  if (record.app === 'mail' && draft) return {kind:'draft', app:'mail', project:draft.project, draftId:draft.id,revision:record.revision,activityId:record.id};
  const connection = state.connections.find(c => c.id === record.connectionId && c.app === record.app);
  return connection ? {kind:'connection',app:record.app,connectionId:connection.id} : null;
}
export function activityDemoState(state) {
  const rows = [
    {id:'activity-global',app:'zentao',operation:'测试连接',status:'failed',project:null,connectionId:'zt-demo',callerKind:'ui',category:'configuration',at:'2026-10-23 10:20',errorFixture:'long-auth'},
    {id:'activity-cc',app:'zentao',operation:'读取 Bug #812',status:'success',project:'ais',connectionId:'zt-review',callerKind:'agent-run',category:'read',taskId:'p-cc-task',taskTitle:'Claude Code · 合成任务 A',runId:'p-cc-run',at:'2026-10-23 10:21'},
    {id:'activity-index',app:'mail',operation:'本地邮件增量检查',status:'success',project:'ais',connectionId:'fox-demo',callerKind:'index-job',category:'read',jobId:'p-index-job',at:'2026-10-23 10:22'},
    {id:'activity-draft',app:'mail',operation:'更新草稿修订',status:'failed',project:'smartdd',connectionId:'smtp-review',callerKind:'agent-run',category:'draft',taskId:'p-codex-task',taskTitle:'Codex · 合成任务 B',runId:'p-codex-run',draftId:'activity-draft-b',revision:1,at:'2026-10-23 10:23'},
    {id:'unknown-demo',app:'mail',operation:'发送示例邮件',status:'unknown',project:'ais',connectionId:'smtp-review',callerKind:'ui',category:'write',draftId:'activity-draft-a',revision:1,at:'2026-10-23 10:24'},
    {id:'activity-accepted',app:'mail',operation:'发送示例邮件',status:'success',project:'smartdd',connectionId:'smtp-review',callerKind:'ui',category:'write',at:'2026-10-23 10:25'},
  ].map(projectDemoActivity);
  const connections = [
    {id:'zt-review',app:'zentao',kind:'zentao',name:'验收禅道 B',url:'https://zentao-b.example.invalid/',account:'demo.b',auth:'password',credentialPresent:true,enabled:true,validation:'ready',revision:1},
    {id:'smtp-review',app:'mail',kind:'smtp',name:'验收发件 B',host:'smtp.example.invalid',account:'sender@example.invalid',port:465,transport:'implicit-tls',enabled:true,validation:'ready',credentialPresent:true,revision:1},
  ];
  const drafts = [
    {id:'activity-draft-a',project:'ais',status:'unknown'},
    {id:'activity-draft-b',project:'smartdd',status:'failed'},
  ].map(d => ({...d,revision:1,fixture:'m10-review',senderId:'smtp-review',mailSendSlotRevision:0}));
  return {...state,
    connections:[...state.connections,...connections.filter(c => !state.connections.some(old => old.id === c.id))],
    drafts:[...(state.drafts || []).filter(d => !drafts.some(next => next.id === d.id)),...drafts],
    activity:[...rows,...state.activity.filter(old => !rows.some(row => row.id === old.id))].slice(0,40),
  };
}
