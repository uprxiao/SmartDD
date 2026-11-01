// 发件身份确认记录的持久化清洗（独立文件，避免 integration-model 与 m11-preview-model 循环引用）。
export function sanitizeSenderConfirmations(value) {
  const out = {};
  for (const [project, record] of Object.entries(value && typeof value === 'object' ? value : {})) {
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(project)) continue;
    const b = record?.binding;
    if (!b || typeof b.smtpId !== 'string' || !Number.isSafeInteger(b.smtpRevision)) continue;
    out[project] = { at: typeof record.at === 'string' ? record.at.slice(0, 40) : 'demo-confirmed', binding: {
      smtpId: b.smtpId.slice(0, 100), smtpRevision: b.smtpRevision, fromAddress: String(b.fromAddress ?? '').slice(0, 512),
      localId: typeof b.localId === 'string' ? b.localId.slice(0, 100) : null,
      localRevision: Number.isSafeInteger(b.localRevision) ? b.localRevision : null,
      localDirectory: typeof b.localDirectory === 'string' ? b.localDirectory.slice(0, 512) : null } };
  }
  return out;
}
