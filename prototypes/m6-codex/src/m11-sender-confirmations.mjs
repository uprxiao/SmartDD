// 发件身份确认记录的持久化清洗（独立文件，避免 integration-model 与 m11-preview-model 循环引用）。
export function sanitizeSenderConfirmations(value) {
  const out = {};
  for (const [project, record] of Object.entries(value && typeof value === 'object' ? value : {})) {
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(project)) continue;
    const b = record?.binding;
    if (!b || typeof b.smtpId !== 'string' || !Number.isSafeInteger(b.smtpRevision)) continue;
    out[project] = { method:record.method==='automatic'?'automatic':'user', at: typeof record.at === 'string' ? record.at.slice(0, 40) : 'demo-confirmed', binding: {
      smtpId: b.smtpId.slice(0, 100), smtpRevision: b.smtpRevision, fromAddress: String(b.fromAddress ?? '').slice(0, 512),
      localId: typeof b.localId === 'string' ? b.localId.slice(0, 100) : null,
      localRevision: Number.isSafeInteger(b.localRevision) ? b.localRevision : null,
      localDirectory: typeof b.localDirectory === 'string' ? b.localDirectory.slice(0, 512) : null,
      smtpBindingRevision:Number.isSafeInteger(b.smtpBindingRevision)?b.smtpBindingRevision:null,localBindingRevision:Number.isSafeInteger(b.localBindingRevision)?b.localBindingRevision:null } };
  }
  return out;
}

const MAILBOX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const mailboxOf = value => typeof value === 'string' && MAILBOX.test(value.trim()) ? value.trim().toLowerCase() : null;
export const senderBindingOf = (state,project,smtp,local,directory) => ({
 smtpId:smtp.id,smtpRevision:smtp.revision??1,fromAddress:mailboxOf(smtp.fromAddress??smtp.account)??'',
 localId:local?.id??null,localRevision:local?.revision??null,localDirectory:local?directory:null,
 smtpBindingRevision:state.mailSlotRevisions?.[project]?.smtp??state.mailBindingRevisions?.[project]??0,
 localBindingRevision:state.mailSlotRevisions?.[project]?.local??state.mailBindingRevisions?.[project]??0,
});
export const sameSenderBinding = (a,b) => !!a&&!!b&&['smtpId','smtpRevision','fromAddress','localId','localRevision','localDirectory','smtpBindingRevision','localBindingRevision'].every(k=>a[k]===b[k]);
// Only the first matching selection may mint the automatic demo receipt. Later
// changes retain its binding so the existing invalidated state can be shown.
export function recordInitialAutomaticSender(state,project,chosen){
 if(state.senderConfirmations?.[project])return state;
 const smtp=chosen.find(c=>c.kind==='smtp'),local=chosen.find(c=>c.kind==='local'),directory=local?.accountDir??local?.account??'';
 if(!smtp||!local||!mailboxOf(directory)||mailboxOf(directory)!==mailboxOf(smtp.fromAddress??smtp.account))return state;
 return{...state,senderConfirmations:{...state.senderConfirmations,[project]:{method:'automatic',at:'demo-automatic',binding:senderBindingOf(state,project,smtp,local,directory)}}};
}
