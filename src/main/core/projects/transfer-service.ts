import { createHash, randomUUID } from 'node:crypto';
import { accessSync, constants, statSync } from 'node:fs';
import { basename, isAbsolute, join } from 'node:path';
import { eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { RUNNERS, aiProfileInputSchema } from '@shared/ai-profiles';
import { NEW_MAIN_DIR_REF, TRANSFER_CAPABILITIES, TRANSFER_LIMITS, transferDraftSchema, type DraftValidation, type ExportDescription, type ImportResult, type TransferDraft, type TransferPreview } from '@shared/project-transfer';
import type { AppDb } from '../../db/client';
import { aiProfiles, importedKeys, projectCapabilities, projectDatabases, projectDirs, projectImportReceipts, projects, projectServers } from '../../db/schema';
import type { SecretsStore } from '../../secrets';
import { aiSecretKey } from '../ai/ai-profile-service';
import type { AiProfileService } from '../ai/ai-profile-service';
import { inspectDir, pathIdentity } from './dir-status';
import type { ProjectService } from './project-service';
import { secretKeys } from './secret-keys';
import { decryptProject, encryptProject, inspectEnvelope, strictBase64, TransferError, validatePayload, type PortableProject } from './transfer-format';
import { atomicWrite, ImportedKeyFiles, readLimited } from './transfer-files';

type FileSession = { owner: number; touched: number; raw: Buffer; fileName: string };
type PreviewSession = { owner: number; touched: number; payload: PortableProject; paths: Set<string>; rules: Set<string> };
interface Dependencies {
  db: AppDb; secrets: SecretsStore; projects: ProjectService; profiles: AiProfileService;
  userData: string; appVersion: string; env: () => Record<string, string>; now?: () => number;
  /** Only injected by isolated tests. Never selected by IPC input or application environment. */
  checkpoint?: (phase: 'snapshot' | 'journal' | 'key-staged' | 'key-renamed' | 'keys' | 'rows' | 'secrets' | 'committed' | 'export-write') => void;
}
const exportSchema = z.strictObject({ projectId: z.string().min(1).max(100), profileIds: z.array(z.string().min(1).max(100)).max(50), emptyPasswordRefs: z.array(z.string().max(100)).max(200) });
function uniqueName(base: string, names: string[], max: number): string {
  const occupied = new Set(names.map(n => n.toLowerCase()));
  if (!occupied.has(base.toLowerCase()) && base.length <= max) return base;
  for (let i = 1; ; i++) {
    const suffix = i === 1 ? '（导入）' : `（导入 ${i}）`;
    const candidate = `${base.slice(0, max - suffix.length)}${suffix}`;
    if (!occupied.has(candidate.toLowerCase())) return candidate;
  }
}
export function transferFilename(name: string, date = new Date()): string {
  const clean = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').slice(0, 100) || 'project';
  return `${clean}-${date.toISOString().slice(0, 10)}.willyou`;
}
export class ProjectTransferService {
  private files = new Map<string, FileSession>();
  private previews = new Map<string, PreviewSession>();
  private generations = new Map<number, number>();
  private busy = new Set<number>();
  private committing = false;
  private now: () => number;
  private timer: ReturnType<typeof setInterval>;
  readonly keys: ImportedKeyFiles;
  constructor(private readonly d: Dependencies) {
    this.now = d.now ?? Date.now;
    this.keys = new ImportedKeyFiles(d.db, d.userData, d.checkpoint);
    this.timer = setInterval(() => this.prune(), 60_000); this.timer.unref();
  }
  recover() { this.keys.recover(); }
  disposeAll() { clearInterval(this.timer); for (const f of this.files.values()) f.raw.fill(0); this.files.clear(); this.previews.clear(); }
  disposeOwner(owner: number) {
    this.generations.set(owner, (this.generations.get(owner) ?? 0) + 1);
    for (const [key, value] of this.files) if (value.owner === owner) { value.raw.fill(0); this.files.delete(key); }
    for (const [key, value] of this.previews) if (value.owner === owner) this.previews.delete(key);
  }
  dispose(owner: number, token: string) {
    const f = this.files.get(token); if (f?.owner === owner) { f.raw.fill(0); this.files.delete(token); }
    if (this.previews.get(token)?.owner === owner) this.previews.delete(token);
  }
  private prune() {
    for (const [key, v] of this.files) if (this.now() - v.touched > TRANSFER_LIMITS.ttl && !this.busy.has(v.owner)) this.dispose(v.owner, key);
    for (const [key, v] of this.previews) if (this.now() - v.touched > TRANSFER_LIMITS.ttl && !this.busy.has(v.owner)) this.dispose(v.owner, key);
  }
  private preview(owner: number, token: string): PreviewSession {
    this.prune(); const p = this.previews.get(token);
    if (!p || p.owner !== owner) throw new TransferError('PREVIEW_EXPIRED', '导入预览已失效，请重新选择文件');
    p.touched = this.now(); return p;
  }
  async exclusive<T>(owner: number, fn: () => Promise<T>): Promise<T> {
    if (this.busy.has(owner)) throw new TransferError('BUSY', '正在处理当前操作，请稍候');
    this.busy.add(owner); try { return await fn(); } finally { this.busy.delete(owner); }
  }
  choose(owner: number, path: string): { fileToken: string; fileName: string } {
    this.disposeOwner(owner);
    const raw = readLimited(path);
    try { inspectEnvelope(raw); } catch (e) { raw.fill(0); throw e; }
    const token = randomUUID(), fileName = basename(path);
    this.files.set(token, { owner, raw, fileName, touched: this.now() });
    return { fileToken: token, fileName };
  }
  async unlock(owner: number, fileToken: string, password: string): Promise<TransferPreview> {
    this.prune(); const file = this.files.get(fileToken);
    if (!file || file.owner !== owner) throw new TransferError('PREVIEW_EXPIRED', '所选文件已失效，请重新选择');
    // exclusive() marks this owner busy before unlock starts, so prune alone
    // cannot enforce the file's idle timeout at this boundary.
    if (this.now() - file.touched > TRANSFER_LIMITS.ttl) { this.dispose(owner, fileToken); throw new TransferError('PREVIEW_EXPIRED', '所选文件已失效，请重新选择'); }
    file.touched = this.now();
    const generation = this.generations.get(owner) ?? 0;
    const payload = await decryptProject(file.raw, password);
    if (generation !== (this.generations.get(owner) ?? 0) || this.files.get(fileToken) !== file) throw new TransferError('PREVIEW_EXPIRED', '本次导入已取消，请重新选择文件');
    const token = randomUUID();
    for (const [k, v] of this.previews) if (v.owner === owner) this.previews.delete(k);
    this.previews.set(token, { owner, touched: this.now(), payload, paths: new Set(), rules: new Set() });
    this.dispose(owner, fileToken);
    return this.toPreview(token, payload);
  }
  private toPreview(token: string, p: PortableProject): TransferPreview {
    const dirs = p.directories.length ? p.directories : [{ ref: NEW_MAIN_DIR_REF, label: '主目录', path: '', isDefault: true }];
    return {
      token, project: p.project, suggestedName: uniqueName(p.project.name, this.d.projects.listProjects().map(p => p.name), 100),
      directories: dirs.map(d => ({ ref: d.ref, label: d.label, sourcePath: d.path, isDefault: d.isDefault })),
      resources: [
        ...p.databases.map(d => ({ ref: d.ref, label: d.label || d.database || d.host, kind: 'database' as const, env: d.env, host: d.host, port: d.port, username: d.username, detail: `${d.vendor} · ${d.database}`, credentials: ['密码'] })),
        ...p.servers.map(s => ({ ref: s.ref, label: s.label || s.host, kind: 'server' as const, env: s.env, host: s.host, port: s.port, username: s.username, detail: s.authType === 'key' ? 'SSH · 私钥' : 'SSH · 密码', credentials: [s.authType === 'key' ? '私钥' : '密码', ...(p.credentials[s.ref]?.passphrase !== undefined ? ['私钥口令'] : []), ...(s.sudoPolicy === 'separate' ? ['sudo 密码'] : [])] })),
      ],
      profiles: p.profiles.map(p => ({ ref: p.ref, name: p.name, runner: p.runner, executable: p.executable, env: p.env.map(e => ({ name: e.name, secret: e.secret, hasValue: true })) })),
      capabilities: p.capabilities,
      counts: { directories: dirs.length, databases: p.databases.length, servers: p.servers.length, profiles: p.profiles.length },
    };
  }
  private selection(projectId: string, profileIds: string[]) {
    if (!z.array(z.string().min(1).max(100)).max(50).safeParse(profileIds).success || new Set(profileIds).size !== profileIds.length) throw new TransferError('INVALID_DRAFT', 'AI 配置选择无效');
    const p = this.d.projects.getProject(projectId);
    const profiles = profileIds.map(id => this.d.profiles.get(id));
    return { p, profiles };
  }
  describeExport(projectId: string, profileIds: string[]): ExportDescription {
    const { p, profiles } = this.selection(projectId, profileIds);
    const missing: ExportDescription['missing'] = [];
    const resource = (ref: string, label: string, kind: string, exists: boolean, allowEmpty = false) => { if (!exists) missing.push({ ref, label, kind, allowEmpty }); };
    for (const db of p.databases) resource(`db-${db.id}`, db.label || db.host, '密码', db.hasPassword, true);
    for (const s of p.servers) {
      let key = false;
      if (s.privateKeyPath) try { const stat = statSync(s.privateKeyPath); accessSync(s.privateKeyPath, constants.R_OK); key = stat.isFile() && stat.size > 0 && stat.size <= TRANSFER_LIMITS.key; } catch { /* Missing key is shown without exposing its content. */ }
      resource(`server-${s.id}`, s.label || s.host, s.authType === 'key' ? '私钥' : '密码', s.authType === 'key' ? key : s.hasPassword, s.authType === 'password');
      if (s.sudoPolicy === 'separate') resource(`server-${s.id}`, s.label || s.host, 'sudo 密码', s.hasSudoPassword);
    }
    for (const profile of profiles) for (const e of profile.env) if (e.secret) resource(`ai-${profile.id}`, profile.name, `变量 ${e.name}`, e.hasValue);
    return {
      project: { name: p.name, aliases: p.aliases, description: p.description, rulesPath: p.rulesPath },
      directories: p.dirs.map(d => ({ ref: `dir-${d.id}`, label: d.label, sourcePath: d.path, isDefault: d.isDefault })),
      resources: [
        ...p.databases.map(d => ({ ref: `db-${d.id}`, label: d.label || d.host, kind: 'database' as const, env: d.env, host: d.host, port: d.port, username: d.username, detail: `${d.vendor} · ${d.database}`, credentials: [d.hasPassword ? '密码' : '缺少密码'] })),
        ...p.servers.map(s => ({ ref: `server-${s.id}`, label: s.label || s.host, kind: 'server' as const, env: s.env, host: s.host, port: s.port, username: s.username, detail: 'SSH', credentials: [s.authType === 'key' ? '私钥' : '密码', ...(s.hasPassphrase ? ['私钥口令'] : []), ...(s.sudoPolicy === 'separate' ? ['sudo 密码'] : [])] })),
      ],
      profiles: profiles.map(p => ({ ref: p.id, name: p.name, runner: p.runner, executable: p.executable, env: p.env.map(e => ({ name: e.name, secret: e.secret, hasValue: e.hasValue })) })),
      capabilities: this.capabilities(projectId),
      counts: { directories: p.dirs.length, databases: p.databases.length, servers: p.servers.length, profiles: profiles.length }, missing,
    };
  }
  private capabilities(projectId: string): PortableProject['capabilities'] {
    const rows = this.d.db.select().from(projectCapabilities).where(eq(projectCapabilities.projectId, projectId)).all();
    return TRANSFER_CAPABILITIES.map(id => ({ id, enabled: rows.find(c => c.capabilityId === id)?.enabled ?? true }));
  }
  snapshot(projectId: string, profileIds: string[], emptyPasswordRefs: string[]): PortableProject {
    const input = exportSchema.safeParse({ projectId, profileIds, emptyPasswordRefs });
    if (!input.success) throw new TransferError('INVALID_DRAFT', '导出选择无效');
    try { this.d.secrets.assertAvailable(); } catch { throw new TransferError('SECRET_STORAGE_UNAVAILABLE', '系统安全存储不可用，请解锁系统钥匙串后重试'); }
    return this.d.db.transaction(() => {
      const description = this.describeExport(projectId, profileIds);
      const empty = new Set(emptyPasswordRefs);
      if (empty.size !== emptyPasswordRefs.length || emptyPasswordRefs.some(ref => !description.missing.some(m => m.ref === ref && m.allowEmpty))) throw new TransferError('INVALID_DRAFT', '无密码资源确认已变化，请重新检查');
      if (description.missing.some(m => !m.allowEmpty || !empty.has(m.ref))) throw new TransferError('MISSING_CREDENTIAL', `请补齐凭据或明确确认无密码：${description.missing.filter(m => !m.allowEmpty || !empty.has(m.ref)).map(m => `${m.label}（${m.kind}）`).join('、')}`);
      const { p, profiles } = this.selection(projectId, profileIds);
      const credentials: PortableProject['credentials'] = {};
      const password = (ref: string, key: string) => { const value = this.d.secrets.get(key); if (value === null && !empty.has(ref)) throw new TransferError('MISSING_CREDENTIAL', '关联密码缺失，请补齐后重试'); return value ?? ''; };
      const databases = p.databases.map(d => {
        const ref = `db-${d.id}`; credentials[ref] = { password: password(ref, secretKeys.databasePassword(d.id)) };
        const { id: _id, projectId: _project, hasPassword: _has, lastTest: _test, ...fields } = d;
        return { ref, ...fields };
      });
      const servers = p.servers.map(s => {
        const ref = `server-${s.id}`, keys = secretKeys.serverKeys(s.id);
        const c: PortableProject['credentials'][string] = {};
        if (s.authType === 'password') c.password = password(ref, keys.password);
        else {
          if (!s.privateKeyPath) throw new TransferError('MISSING_CREDENTIAL', '私钥文件缺失');
          const key = readLimited(pathIdentity(s.privateKeyPath), TRANSFER_LIMITS.key);
          try { c.privateKey = { encoding: 'base64', data: key.toString('base64') }; } finally { key.fill(0); }
          const passphrase = this.d.secrets.get(keys.passphrase); if (passphrase !== null) c.passphrase = passphrase;
        }
        if (s.sudoPolicy === 'separate') { const sudo = this.d.secrets.get(keys.sudo); if (sudo === null) throw new TransferError('MISSING_CREDENTIAL', 'sudo 密码缺失'); c.sudoPassword = sudo; }
        credentials[ref] = c;
        const { id: _id, projectId: _project, hasPassword: _pw, hasPassphrase: _pass, hasSudoPassword: _sudo, lastTest: _test, ...fields } = s;
        return { ref, ...fields, privateKeyPath: null };
      });
      const portableProfiles = profiles.map(p => {
        const ref = `ai-${p.id}`, env: Record<string, string> = {};
        for (const e of p.env) if (e.secret) { const value = this.d.secrets.get(aiSecretKey(p.id, e.name)); if (value === null) throw new TransferError('MISSING_CREDENTIAL', 'AI 配置凭据缺失'); env[e.name] = value; }
        if (Object.keys(env).length) credentials[ref] = { env };
        return { ref, name: p.name, runner: p.runner, executable: p.executable, args: p.args, color: p.color, env: p.env.map(e => ({ name: e.name, secret: e.secret, value: e.secret ? null : (e.value ?? '') })) };
      });
      const result = validatePayload({ schemaVersion: 1, exportedAt: new Date(this.now()).toISOString(), producer: { name: 'WillYou', appVersion: this.d.appVersion, platform: process.platform }, project: description.project, directories: p.dirs.map(d => ({ ref: `dir-${d.id}`, label: d.label, path: d.path, isDefault: d.isDefault })), databases, servers, profiles: portableProfiles, capabilities: description.capabilities, credentials });
      this.d.checkpoint?.('snapshot'); return result;
    });
  }
  async exportTo(path: string, projectId: string, profileIds: string[], emptyPasswordRefs: string[], passphrase: string) {
    const snapshot = this.snapshot(projectId, profileIds, emptyPasswordRefs);
    const raw = await encryptProject(snapshot, passphrase);
    try { atomicWrite(path, raw, () => this.d.checkpoint?.('export-write')); }
    catch { throw new TransferError('FILE_IO_FAILED', '无法保存项目文件，请检查磁盘空间和写入权限后重试'); }
    return { path, fileName: basename(path), sha256: createHash('sha256').update(raw).digest('hex') };
  }
  allowDirectory(owner: number, token: string, path: string) { this.preview(owner, token).paths.add(path); }
  allowRules(owner: number, token: string, path: string) { this.preview(owner, token).rules.add(path); }
  private commandAvailable(command: string): boolean {
    const paths = isAbsolute(command) ? [command] : (this.d.env().PATH ?? '').split(':').filter(Boolean).map(p => join(p, command));
    return paths.some(path => { try { accessSync(path, constants.X_OK); return statSync(path).isFile(); } catch { return false; } });
  }
  validateDraft(owner: number, token: string, input: TransferDraft): DraftValidation {
    const session = this.preview(owner, token), p = session.payload;
    const parsed = transferDraftSchema.safeParse(input);
    if (!parsed.success) throw new TransferError('INVALID_DRAFT', '导入选项无效，请检查名称和目录');
    const draft = parsed.data;
    const issues: DraftValidation['issues'] = [];
    if (this.d.projects.listProjects().some(p => p.name.toLowerCase() === draft.name.toLowerCase())) issues.push({ field: 'name', message: '已有同名项目，请更换名称' });
    const refs = (p.directories.length ? p.directories : [{ ref: NEW_MAIN_DIR_REF }]).map(d => d.ref);
    if (new Set(draft.directories.map(d => d.ref)).size !== refs.length || draft.directories.length !== refs.length || draft.directories.some(d => !refs.includes(d.ref))) throw new TransferError('INVALID_DRAFT', '目录映射不完整或包含未知目录');
    const selected = new Set(draft.selectedProfileRefs);
    if (selected.size !== draft.selectedProfileRefs.length || draft.selectedProfileRefs.some(ref => !p.profiles.some(profile => profile.ref === ref))) throw new TransferError('INVALID_DRAFT', 'AI 配置选择无效');
    if (draft.executables.length !== selected.size || new Set(draft.executables.map(e => e.ref)).size !== selected.size || draft.executables.some(e => !selected.has(e.ref))) throw new TransferError('INVALID_DRAFT', 'AI 命令映射不完整');
    const occupied = this.d.db.select({ path: projectDirs.path }).from(projectDirs).innerJoin(projects, eq(projectDirs.projectId, projects.id)).where(isNull(projects.archivedAt)).all().map(d => pathIdentity(d.path));
    const seen = new Set<string>();
    const directories = draft.directories.map(d => {
      const path = d.mode === 'source' ? (p.directories.find(source => source.ref === d.ref)?.path ?? '') : (d.localPath ?? '');
      const status = inspectDir(path);
      let issue: string | null = null;
      if (!path || !isAbsolute(path) || (d.mode === 'local' && !session.paths.has(path))) issue = '请选择本机代码文件夹后继续';
      else if (!status.available) issue = '目录不存在或不可读取，请选择可用目录';
      else {
        const identity = pathIdentity(path);
        if (occupied.includes(identity)) issue = '目录已被其他项目使用，请重新选择';
        else if (seen.has(identity)) issue = '本次导入的代码目录不能重复';
        seen.add(identity);
      }
      if (issue) issues.push({ field: `directories.${d.ref}`, message: issue });
      return { ref: d.ref, path, status, issue };
    });
    if (draft.rulesPath) {
      let available = false;
      try { accessSync(draft.rulesPath, constants.R_OK); available = statSync(draft.rulesPath).isFile(); } catch { /* report below */ }
      if (!isAbsolute(draft.rulesPath) || !available || (draft.rulesPath !== p.project.rulesPath && !session.rules.has(draft.rulesPath))) issues.push({ field: 'rulesPath', message: '规则文件不可用，请重新选择或清空' });
    }
    const profiles = draft.executables.map(e => {
      const profile = p.profiles.find(p => p.ref === e.ref)!;
      const parsed = aiProfileInputSchema.safeParse({ ...profile, executable: e.executable, isDefault: false });
      if (!parsed.success) issues.push({ field: `profiles.${e.ref}`, message: 'AI 命令无效，请填写命令名或可执行文件路径' });
      const command = e.executable || RUNNERS[profile.runner].command;
      return { ref: e.ref, command, available: parsed.success && this.commandAvailable(command) };
    });
    return { valid: issues.length === 0, issues, directories, profiles, counts: { directories: directories.length, databases: p.databases.length, servers: p.servers.length, profiles: selected.size } };
  }
  getResult(requestId: string): ImportResult | null {
    if (!z.string().uuid().safeParse(requestId).success) throw new TransferError('INVALID_DRAFT', '操作标识无效');
    const row = this.d.db.select().from(projectImportReceipts).where(eq(projectImportReceipts.requestId, requestId)).get();
    return row ? JSON.parse(row.result) as ImportResult : null;
  }
  commit(owner: number, token: string, requestId: string, input: TransferDraft): ImportResult {
    if (!z.string().uuid().safeParse(requestId).success) throw new TransferError('INVALID_DRAFT', '操作标识无效');
    const parsed = transferDraftSchema.safeParse(input);
    if (!parsed.success) throw new TransferError('INVALID_DRAFT', '导入选项无效');
    const draft = parsed.data;
    const fingerprint = createHash('sha256').update(JSON.stringify({ owner, token, draft })).digest('hex');
    const old = this.d.db.select().from(projectImportReceipts).where(eq(projectImportReceipts.requestId, requestId)).get();
    if (old) { if (old.fingerprint !== fingerprint) throw new TransferError('REQUEST_CONFLICT', '此操作已提交，不能更换导入选项后重试'); return JSON.parse(old.result) as ImportResult; }
    if (this.committing) throw new TransferError('BUSY', '正在导入项目，请稍候');
    const session = this.preview(owner, token), p = session.payload;
    const validation = this.validateDraft(owner, token, draft);
    if (!validation.valid) throw new TransferError('INVALID_DRAFT', validation.issues[0].message);
    try { this.keys.recover(); } catch { throw new TransferError('KEY_IO_FAILED', '受管密钥恢复尚未完成，请检查本机存储后重试'); }
    try { this.d.secrets.assertAvailable(); } catch { throw new TransferError('SECRET_STORAGE_UNAVAILABLE', '系统安全存储不可用，请解锁系统钥匙串后重试'); }
    this.committing = true;
    const id = randomUUID(), ts = this.now();
    const keyIds = new Map(p.servers.filter(s => s.authType === 'key').map(s => [s.ref, randomUUID()]));
    let committed = false;
    try {
      if (keyIds.size) {
        this.keys.begin(requestId, [...keyIds.values()]); this.d.checkpoint?.('journal');
        for (const [ref, sid] of keyIds) { const key = strictBase64(p.credentials[ref].privateKey!.data); try { this.keys.write(requestId, sid, key); } finally { key.fill(0); } }
        this.d.checkpoint?.('keys');
      }
      const result = this.d.db.transaction(() => {
        const check = this.validateDraft(owner, token, draft);
        if (!check.valid) throw new TransferError('INVALID_DRAFT', check.issues[0].message);
        this.d.db.insert(projects).values({ id, name: draft.name, aliases: JSON.stringify(p.project.aliases), description: p.project.description, rulesPath: draft.rulesPath || null, configVersion: 1, archivedAt: null, createdAt: ts, updatedAt: ts }).run();
        for (const d of check.directories) {
          const source = p.directories.find(s => s.ref === d.ref);
          this.d.db.insert(projectDirs).values({ id: randomUUID(), projectId: id, label: source?.label ?? '主目录', path: d.path, isDefault: source?.isDefault ?? true, createdAt: ts, updatedAt: ts }).run();
        }
        for (const d of p.databases) {
          const { ref, ...fields } = d, rid = randomUUID();
          this.d.db.insert(projectDatabases).values({ ...fields, aliases: JSON.stringify(fields.aliases), id: rid, projectId: id, createdAt: ts, updatedAt: ts }).run();
          this.d.secrets.set(secretKeys.databasePassword(rid), p.credentials[ref].password!);
        }
        for (const s of p.servers) {
          const { ref, ...fields } = s, sid = keyIds.get(ref) ?? randomUUID(), privateKeyPath = keyIds.has(ref) ? this.keys.path(sid) : null;
          this.d.db.insert(projectServers).values({ ...fields, aliases: JSON.stringify(fields.aliases), privateKeyPath, id: sid, projectId: id, createdAt: ts, updatedAt: ts }).run();
          if (privateKeyPath) this.d.db.insert(importedKeys).values({ serverId: sid, path: privateKeyPath, createdAt: ts }).run();
          const c = p.credentials[ref], keys = secretKeys.serverKeys(sid);
          if (c.password !== undefined) this.d.secrets.set(keys.password, c.password);
          if (c.passphrase !== undefined) this.d.secrets.set(keys.passphrase, c.passphrase);
          if (c.sudoPassword !== undefined) this.d.secrets.set(keys.sudo, c.sudoPassword);
        }
        this.d.checkpoint?.('rows');
        for (const c of p.capabilities) this.d.db.insert(projectCapabilities).values({ id: randomUUID(), projectId: id, capabilityId: c.id, enabled: c.enabled }).run();
        const profileIds: string[] = [], names = this.d.profiles.list().map(p => p.name);
        for (const ref of draft.selectedProfileRefs) {
          const profile = p.profiles.find(p => p.ref === ref)!, pid = randomUUID(), name = uniqueName(profile.name, names, 60);
          names.push(name); profileIds.push(pid);
          const env = profile.env.map(e => { if (e.secret) this.d.secrets.set(aiSecretKey(pid, e.name), p.credentials[ref].env![e.name]); return { ...e }; });
          this.d.db.insert(aiProfiles).values({ id: pid, name, runner: profile.runner, executable: draft.executables.find(e => e.ref === ref)!.executable || null, commandPending: !check.profiles.find(p => p.ref === ref)!.available, args: JSON.stringify(profile.args), env: JSON.stringify(env), color: profile.color, isDefault: false, createdAt: ts, updatedAt: ts }).run();
        }
        this.d.checkpoint?.('secrets');
        const warnings = check.profiles.filter(p => !p.available).map(c => `AI 命令 ${c.command} 尚未安装或不可执行，请在设置中调整`);
        const result: ImportResult = { requestId, projectId: id, name: draft.name, profileIds, counts: check.counts, warnings };
        this.d.db.insert(projectImportReceipts).values({ requestId, fingerprint, result: JSON.stringify(result), createdAt: ts }).run();
        return result;
      });
      committed = true;
      this.d.checkpoint?.('committed');
      if (keyIds.size) this.keys.finish(requestId);
      this.dispose(owner, token);
      return result;
    } catch (error) {
      if (!committed && keyIds.size) {
        try { this.keys.rollback(requestId, [...keyIds.values()]); }
        catch { throw new TransferError('KEY_IO_FAILED', '导入未完成，密钥清理待恢复；请重新启动应用后重试'); }
      }
      if (error instanceof TransferError) throw error;
      throw new TransferError('COMMIT_FAILED', committed ? '导入已提交，正在恢复操作结果，请重试获取结果' : '项目未导入，已回滚本次修改，请检查安全存储和磁盘后重试');
    } finally { this.committing = false; }
  }
}
