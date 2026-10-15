// UI-only data. Keep fields aligned with src/shared/projects.ts; never store real secrets.
export const makeId = () => 'preview-' + Math.random().toString(36).slice(2, 9);
export const DB_VENDORS = {
  mysql: ['MySQL', 3306], postgres: ['PostgreSQL', 5432], opengauss: ['openGauss', 5432],
  panweidb: ['盘维 PanweiDB', 5432], kingbase: ['KingbaseES', 54321], highgo: ['HighGo', 5866],
  oceanbase: ['OceanBase (MySQL)', 2881], goldendb: ['GoldenDB', 3306],
};
export function makeProject(p, seeded = false) {
  return {
    aliases: '', rulesPath: '', description: '', configVersion: 1, archived: false,
    createdAt: '2026-10-15', capabilities: { db: true, ssh: true, mcp: true }, ...p,
    dirs: p.path ? [{ id: makeId(), label: '主目录', path: p.path, isDefault: true, available: true, vcs: p.id === 'ais' ? 'SVN' : 'Git' }] : [],
    databases: seeded ? [{ id: makeId(), label: '开发数据库', env: 'dev', vendor: 'mysql', host: 'dev-db.example', port: 3306, database: p.id + '_dev', schema: '', username: 'demo_readonly', hasPassword: true, isDefault: true, accessLevel: 'readonly', aliases: '', note: '', lastTest: null }] : [],
    servers: seeded ? [{ id: makeId(), label: '开发服务器 173', env: 'dev', host: 'dev-server.example', port: 22, username: 'demo', authType: 'password', hasPassword: true, privateKeyPath: '', hasPassphrase: false, sudoPolicy: 'none', hasSudoPassword: false, defaultRoot: false, appRoot: '/srv/ais', logsPath: '/srv/ais/logs', aliases: '', note: '', lastTest: null }] : [],
  };
}
export function saveResource(project, kind, value) {
  const item = { ...value, id: value.id || makeId() };
  const rows = project[kind] || [];
  if (kind === 'dirs' && rows.length === 0) item.isDefault = true;
  const next = rows.some(r => r.id === item.id) ? rows.map(r => r.id === item.id ? item : r) : [...rows, item];
  const normalized = next.map(r => item.isDefault && r.id !== item.id && (kind === 'dirs' || kind === 'databases' && r.env === item.env) ? { ...r, isDefault: false } : r);
  const result = { ...project, [kind]: normalized, configVersion: project.configVersion + 1 };
  if (kind === 'dirs') result.path = (normalized.find(r => r.isDefault) || normalized[0])?.path || '';
  return result;
}
export function removeResource(project, kind, resourceId) {
  let rows = project[kind].filter(r => r.id !== resourceId);
  if (kind === 'dirs' && rows.length && !rows.some(r => r.isDefault)) rows = rows.map((r, i) => ({ ...r, isDefault: i === 0 }));
  const result = { ...project, [kind]: rows, configVersion: project.configVersion + 1 };
  if (kind === 'dirs') result.path = (rows.find(r => r.isDefault) || rows[0])?.path || '';
  return result;
}
export function safeSecretFields(values, previous = {}) {
  const result = { ...values };
  for (const [key, flag] of [['password', 'hasPassword'], ['passphrase', 'hasPassphrase'], ['sudoPassword', 'hasSudoPassword']]) {
    const mode = result[key + 'Mode'];
    result[flag] = mode === 'clear' ? false : mode === 'replace' ? Boolean(result[key]) : Boolean(previous[flag]);
    delete result[key]; delete result[key + 'Mode'];
  }
  return result;
}
