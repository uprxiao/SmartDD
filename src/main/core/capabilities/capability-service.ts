import { parseDocument } from 'yaml';
import { randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { and, eq, ne, sql } from 'drizzle-orm';
import type { CapabilityPreview, RuntimeSkill, RuntimeSnapshot, SkillVersion, StandardSkill } from '@shared/capabilities';
import { DB_VENDORS } from '@shared/projects';
import type { Runner } from '@shared/types';
import type { AppDb } from '../../db/client';
import { projectCapabilities, projects, skillVersions } from '../../db/schema';
import type { SecretsStore } from '../../secrets';
import type { AiProfileService, ResolvedProfile } from '../ai/ai-profile-service';
import type { ProjectService } from '../projects/project-service';
import { secretKeys } from '../projects/secret-keys';
import { projectCapabilityEnabled, projectCapabilitySettingId } from '../projects/project-capability-setting';
import { stateRootFor } from '../tasks/native-sessions';
import { BUNDLED_SKILLS, runtimeFiles, sha256, treeHash, type BundledSkill } from './assets';
import { discoverCapabilities } from './discovery';
import { readOwnedTree, writeOwnedTree } from './files';
import { projectSkillName } from '../applications/session-projector';
import { registerOriginalRun,type OriginalRunCleanup } from './original-run-lifetime';

export const MCP_CAPABILITY = 'smartdd-project-context';
export const RUNTIME_ISOLATION = ['SMARTDD_', 'PROJECT_DB_CONFIG', 'REMOTE_SERVERS_CONFIG'];

export interface PreparedRuntime {
  /** Native-only historical runs must retain the original task evidence verbatim. */
  persistSnapshot?: false;
  args: string[];
  env: Record<string, string>;
  secretValues: string[];
  snapshot: RuntimeSnapshot;
  wrap: (command: string, args: string[]) => { command: string; args: string[] };
  check: () => RuntimeSnapshot['selfCheck'] | null;
  release: () => void;
}

/** Trusted M10 caller has already reserved resources and projected these exact source versions. */
export interface ManagedCapabilityPlacement {
  runId: string;
  runtimeHash: string;
  mcpName: string | null;
  skills: RuntimeSkill[];
  projections: Record<string,{ path: string;nativeName: string;format?:'legacy-tree-v1';files: Readonly<Record<string,Uint8Array>> }>;
}

export interface CapabilityDeps {
  db: AppDb;
  projects: ProjectService;
  secrets: SecretsStore;
  userData: string;
  bundles?: BundledSkill[];
}

const json = (value: unknown): string => JSON.stringify(value, null, 2) + '\n';
const envId = (id: string): string => id.replace(/[^A-Za-z0-9]/g, '_').toUpperCase();

export class CapabilityService {
  private readonly bundles: BundledSkill[];
  private readonly root: string;
  private readonly backupRoot: string;
  private readonly runtimeRoot: string;
  private readonly activeRuns = new Set<string>();
  private readonly managedRuns = new Set<string>();
  private readonly runCleanups = new Map<string,() => void>();

  constructor(private readonly d: CapabilityDeps) {
    this.bundles = d.bundles ?? BUNDLED_SKILLS;
    this.root = join(d.userData, 'capabilities');
    this.backupRoot = join(this.root, 'conflicts');
    const scripts = runtimeFiles();
    this.runtimeRoot = join(this.root, 'runtime', treeHash(scripts));
    writeOwnedTree(this.runtimeRoot, scripts, this.backupRoot);
    for (const bundle of this.bundles) this.install(bundle);
  }

  private install(bundle: BundledSkill): void {
    const id = `${bundle.id}:${bundle.hash}`;
    writeOwnedTree(this.packageRoot(id), bundle.files, this.backupRoot);
    if (this.d.db.select().from(skillVersions).where(eq(skillVersions.id, id)).get()) return;
    const active = !this.d.db.select().from(skillVersions).where(and(eq(skillVersions.skillId, bundle.id), eq(skillVersions.active, true))).get();
    this.d.db.insert(skillVersions).values({ id, skillId: bundle.id, name: bundle.name, version: bundle.version, hash: bundle.hash, installedAt: Date.now(), active }).run();
  }

  private packageRoot(id: string): string {
    // IDs only come from this table / catalog, never a renderer-supplied path.
    if (!/^[a-z0-9-]+:[a-f0-9]{64}$/.test(id)) throw new Error('Skill 版本标识无效');
    return join(this.root, 'packages', id.replace(':', '/'));
  }

  list(projectId?: string): StandardSkill[] {
    if (projectId) this.d.projects.getProject(projectId);
    const installed = this.d.db.select().from(skillVersions).all();
    return this.bundles.map((bundle) => {
      const versions = installed.filter((v) => v.skillId === bundle.id);
      const current = versions.find((v) => v.active);
      if (!current) throw new Error(`Skill 没有活动版本：${bundle.id}`);
      return { id: bundle.id, name: bundle.name, description: bundle.description, source: bundle.source, enabled: projectId ? this.enabled(projectId, bundle.id) : true,
        current, versions, availableVersion: bundle.version, updateAvailable: current.hash !== bundle.hash };
    });
  }

  enabled(projectId: string, capabilityId: string): boolean {
    const rows = this.d.db.select().from(projectCapabilities).where(and(eq(projectCapabilities.projectId, projectId), eq(projectCapabilities.capabilityId, capabilityId))).all();
    return projectCapabilityEnabled(rows, projectId, capabilityId);
  }

  setEnabled(projectId: string, capabilityId: string, enabled: boolean): void {
    this.d.projects.getProject(projectId);
    if (typeof enabled !== 'boolean' || (!this.bundles.some((s) => s.id === capabilityId) && capabilityId !== MCP_CAPABILITY)) throw new Error('能力设置无效');
    this.d.db.transaction(() => {
      const id = projectCapabilitySettingId(projectId, capabilityId);
      this.d.db.delete(projectCapabilities).where(and(eq(projectCapabilities.projectId, projectId), eq(projectCapabilities.capabilityId, capabilityId), ne(projectCapabilities.id, id))).run();
      this.d.db.insert(projectCapabilities).values({ id, projectId, capabilityId, enabled }).onConflictDoUpdate({ target: projectCapabilities.id, set: { enabled } }).run();
      this.d.db.update(projects).set({ configVersion: sql`${projects.configVersion} + 1`, updatedAt: Date.now() }).where(eq(projects.id, projectId)).run();
    });
  }

  upgrade(skillId: string): void {
    const bundle = this.bundles.find((s) => s.id === skillId);
    if (!bundle) throw new Error('未知标准 Skill');
    this.install(bundle);
    this.d.db.transaction(() => {
      this.d.db.update(skillVersions).set({ active: false }).where(eq(skillVersions.skillId, skillId)).run();
      this.d.db.update(skillVersions).set({ active: true }).where(eq(skillVersions.id, `${skillId}:${bundle.hash}`)).run();
    });
  }

  preview(projectId: string | undefined, profile: ResolvedProfile, base: Record<string, string>, cwd?: string): CapabilityPreview {
    const project = projectId ? this.d.projects.getProject(projectId) : undefined;
    const env = { ...base, ...profile.env };
    const home = env.HOME || homedir();
    const dir = cwd ?? project?.dirs.find((d) => d.isDefault)?.path ?? project?.dirs[0]?.path ?? home;
    const skills = this.list(projectId);
    const issues: string[] = [];
    if (skills.some((s) => s.id === 'project-db-diagnostics' && s.enabled)) {
      for (const db of project?.databases ?? []) if (!db.hasPassword) issues.push(`数据库「${db.label || db.database}」未保存密码`);
    }
    if (skills.some((s) => s.id === 'remote-password-ssh' && s.enabled)) {
      for (const server of project?.servers ?? []) {
        if (server.authType === 'password' && !server.hasPassword) issues.push(`服务器「${server.label || server.host}」未保存密码`);
        if (server.authType === 'key' && (!server.privateKeyPath || !existsSync(server.privateKeyPath))) issues.push(`服务器「${server.label || server.host}」私钥不可用`);
        if (server.sudoPolicy === 'separate' && !server.hasSudoPassword) issues.push(`服务器「${server.label || server.host}」未保存 sudo 密码`);
      }
    }
    return { skills, mcpEnabled: projectId ? this.enabled(projectId, MCP_CAPABILITY) : true, issues,
      discovered: discoverCapabilities({ runner: profile.runner, cwd: dir, home, stateRoot: stateRootFor(profile.runner, profile.env, base),
        claudeConfigExplicit: Boolean(env.CLAUDE_CONFIG_DIR), path: env.PATH ?? '', args: profile.args }) };
  }

  selection(projectId: string,previous?: RuntimeSnapshot | null): RuntimeSkill[] {
    if (previous?.projectId === projectId) return previous.skills.map(s => ({ ...s }));
    return this.list(projectId).map(s => ({ skillId: s.id,name: s.name,versionId: s.current.id,version: s.current.version,hash: s.current.hash,path: '',enabled: s.enabled,loaded: 'unverified' as const }));
  }
  runtimeIdentity(): { hash: string;path: string } { return { hash: this.runtimeRoot.split('/').at(-1)!,path: realpathSync(this.runtimeRoot) }; }

  prepare(input: { projectId: string; taskId: string; runner: Runner; cwd: string; home: string; profileArgs: string[]; previous?: RuntimeSnapshot | null; managed?: ManagedCapabilityPlacement }): PreparedRuntime {
    const project = this.d.projects.getProject(input.projectId);
    if (!isAbsolute(input.home)) throw new Error('HOME 必须是绝对路径');
    // A profile with its own skills.config would replace our per-session disable list.
    if (!input.managed && input.runner === 'codex' && input.profileArgs.some((a) => /^skills(?:\.|\s*=)/.test(a.trim()))) throw new Error('AI 配置包含 skills 覆盖参数，请移除后使用项目能力开关');
    const previous = input.previous?.projectId === project.id ? input.previous : null;
    const selected = input.managed ? input.managed.skills.map(s => ({ ...s })) : this.selection(project.id,previous);
    const capabilityRoot = input.managed ? realpathSync(this.root) : this.root;
    if (input.managed && (!/^[a-f0-9-]{36}$/.test(input.managed.runId) || !/^[a-f0-9]{64}$/.test(input.managed.runtimeHash) || (input.managed.mcpName !== null && !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(input.managed.mcpName)))) throw new Error('受管运行或原上下文桥身份无效');
    const runtimeRoot = input.managed ? join(capabilityRoot,'runtime',input.managed.runtimeHash) : this.runtimeRoot;
    const scriptFiles = input.managed ? readOwnedTree(runtimeRoot) : runtimeFiles();
    if (input.managed && treeHash(scriptFiles) !== input.managed.runtimeHash) throw new Error('原标准运行资源已改变，不能使用当前版本替代');
    const packages = selected.map((s) => {
      if (input.managed && !s.enabled) return { selection: s,files: {} as Record<string,string> };
      const v = this.d.db.select().from(skillVersions).where(eq(skillVersions.id, s.versionId)).get();
      if (!v || v.skillId !== s.skillId || v.hash !== s.hash) throw new Error('原任务的 Skill 版本不可用，不能静默替换');
      const files = readOwnedTree(this.packageRoot(v.id));
      if (treeHash(files) !== v.hash) throw new Error(`Skill 版本内容已改变：${v.name}`);
      return { selection: s, files };
    });
    const runId = input.managed?.runId ?? randomUUID();
    const runRoot = join(capabilityRoot, 'runs', project.id, input.taskId, runId);
    const auditPath = join(capabilityRoot, 'resource-audit', project.id, `${input.taskId}.jsonl`);
    mkdirSync(dirname(auditPath), { recursive: true, mode: 0o700 });
    const hasSkill = (id: string) => selected.some((s) => s.skillId === id && s.enabled);
    const env: Record<string, string> = {};
    const secretValues: string[] = [];
    const bindSecret = (name: string, key: string, required = true): string | undefined => {
      const value = this.d.secrets.get(key);
      if (value === null) {
        if (required) throw new Error(`缺少凭据：${name}。请在项目配置中保存后重试`);
        return undefined;
      }
      env[name] = value;
      secretValues.push(value);
      return name;
    };
    const databases = hasSkill('project-db-diagnostics') ? project.databases.map((db) => ({
      key: db.id, resourceId: db.id, projectId: project.id, name: db.label, label: db.label, aliases: db.aliases, environment: db.env,
      type: DB_VENDORS[db.vendor].transport, vendor: db.vendor, host: db.host, port: db.port, database: db.database, schema: db.schema,
      username: db.username, accessLevel: db.accessLevel,
      passwordEnv: bindSecret(`SMARTDD_DB_${envId(db.id)}_PASSWORD`, secretKeys.databasePassword(db.id)),
    })) : [];
    const readablePaths: string[] = [];
    const servers = hasSkill('remote-password-ssh') ? project.servers.map((s) => {
      const keys = secretKeys.serverKeys(s.id);
      if (s.authType === 'key') {
        if (!s.privateKeyPath || !isAbsolute(s.privateKeyPath) || !existsSync(s.privateKeyPath) || !statSync(s.privateKeyPath).isFile()) throw new Error(`私钥路径不可用：${s.label || s.id}`);
        readablePaths.push(s.privateKeyPath);
      }
      const prefix = `SMARTDD_SSH_${envId(s.id)}_`;
      const passwordEnv = s.authType === 'password' || s.sudoPolicy === 'same-as-login' ? bindSecret(prefix + 'PASSWORD', keys.password) : undefined;
      return { resourceId: s.id, projectId: project.id, ip: s.host, port: s.port, username: s.username, alias: s.label || s.id, aliases: [s.id, ...s.aliases],
        environment: s.env, authType: s.authType, privateKeyPath: s.privateKeyPath, passwordEnv,
        passphraseEnv: s.authType === 'key' ? bindSecret(prefix + 'PASSPHRASE', keys.passphrase, false) : undefined,
        sudoPasswordEnv: s.sudoPolicy === 'separate' ? bindSecret(prefix + 'SUDO', keys.sudo) : s.sudoPolicy === 'same-as-login' ? passwordEnv : undefined,
        defaultRoot: s.defaultRoot, sudoPolicy: s.sudoPolicy, appRoot: s.appRoot, logsPath: s.logsPath,
        deployments: s.logsPath ? { app: { modules: { app: { applicationName: s.label || 'app', logs: { primary: s.logsPath } } } } } : {},
      };
    }) : [];
    const config = { schemaVersion: 1, projectId: project.id, configVersion: project.configVersion, databases, servers };
    const configHash = sha256(json(config));
    const metadata = { schemaVersion: 1, projectId: project.id, configVersion: project.configVersion, configHash };
    const files: Record<string, string> = {};
    const pathEnv: Record<string, string> = {};
    if (hasSkill('project-db-diagnostics')) {
      files['databases.json'] = json({ ...metadata, projects: [{ key: project.id, aliases: [project.name, ...project.aliases], roots: project.dirs.map((d) => d.path), defaultDatabase: project.databases.find((d) => d.isDefault)?.id, databases }] });
      pathEnv.PROJECT_DB_CONFIG = join(runRoot, 'databases.json');
    }
    if (hasSkill('remote-password-ssh')) {
      files['servers.json'] = json({ ...metadata, servers });
      pathEnv.REMOTE_SERVERS_CONFIG = join(runRoot, 'servers.json');
    }
    const args: string[] = [];
    if (input.managed) {
      for (const { selection,files: source } of packages) if (selection.enabled) {
        const projection = input.managed.projections[selection.versionId];
        if (!projection || !isAbsolute(projection.path) || !projection.path.endsWith('/SKILL.md') || !/^[a-z][a-z0-9-]{0,63}$/.test(projection.nativeName) || Object.keys(projection.files).sort().join('\n') !== Object.keys(source).sort().join('\n')) throw new Error('原标准Skill完整投影未准备好');
        for (const [name,text] of Object.entries(source)) {
          const expected = name === 'SKILL.md' && projection.format!=='legacy-tree-v1' ? projectSkillName(Buffer.from(text),projection.nativeName) : Buffer.from(text);
          if(name==='SKILL.md'&&projection.format==='legacy-tree-v1'){
            const front=/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text),doc=front?parseDocument(front[1],{uniqueKeys:true,logLevel:'silent'}):null;
            if(!doc||doc.errors.length||doc.get('name')!==projection.nativeName||treeHash(source)!==selection.hash)throw new Error('原标准Skill名称或完整来源不同');
          }
          if (!expected.equals(Buffer.from(projection.files[name])) || !readFileSync(join(dirname(projection.path),name)).equals(expected)) throw new Error('原标准Skill投影内容不同');
        }
        selection.name = projection.nativeName; selection.path = projection.path;
      }
    } else if (input.runner === 'claude') {
      files['plugin/.claude-plugin/plugin.json'] = json({ name: 'smartdd', version: '1.0.0', description: 'WillYou project capabilities' });
      for (const { selection, files: source } of packages) if (selection.enabled) {
        for (const [path, content] of Object.entries(source)) files[`plugin/skills/${selection.skillId}/${path}`] = content;
        selection.path = join(runRoot, 'plugin', 'skills', selection.skillId, 'SKILL.md');
      }
      if (selected.some((s) => s.enabled)) args.push('--plugin-dir', join(runRoot, 'plugin'));
    } else {
      const skillsRoot = join(input.home, '.agents', 'skills');
      // Materialize all already-installed versions before the first Codex session. A later
      // in-app activation then introduces no new directory to a running session's discovery.
      for (const version of this.d.db.select().from(skillVersions).all()) {
        const source = readOwnedTree(this.packageRoot(version.id));
        if (treeHash(source) !== version.hash) throw new Error(`Skill 版本内容已改变：${version.name}`);
        writeOwnedTree(join(skillsRoot, `smartdd-${version.skillId}-${version.hash.slice(0, 16)}`), source, this.backupRoot);
      }
      for (const { selection, files: source } of packages) {
        if (!selection.enabled) continue;
        const target = join(skillsRoot, `smartdd-${selection.skillId}-${selection.hash.slice(0, 16)}`);
        writeOwnedTree(target, source, this.backupRoot);
        selection.path = join(target, 'SKILL.md');
      }
      // Include all our historical projections so unrelated/old versions don't become active.
      const all = existsSync(skillsRoot) ? readdirSync(skillsRoot).filter((n) => /^smartdd-[a-z0-9-]+-[a-f0-9]{16}$/.test(n)).flatMap((n) => {
        const path = join(skillsRoot, n);
        try { if (JSON.parse(readFileSync(join(path, '.smartdd-owned.json'), 'utf8')).owner === 'SmartDD') return [join(path, 'SKILL.md')]; } catch { /* user's namesake: leave alone */ }
        return [];
      }) : [];
      const config = all.map((path) => `{path=${JSON.stringify(path)},enabled=${selected.some((s) => s.enabled && s.path === path)}}`).join(',');
      if (all.length) args.push('-c', `skills.config=[${config}]`);
    }
    const mcpEnabled = input.managed ? input.managed.mcpName !== null && this.enabled(project.id,MCP_CAPABILITY) : previous ? previous.mcp.length > 0 : this.enabled(project.id,MCP_CAPABILITY);
    const mcpName = input.managed?.mcpName ?? previous?.mcp[0]?.name ?? `smartdd_project_${runId.replaceAll('-', '').slice(0, 12)}`;
    if (mcpEnabled && !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(mcpName)) throw new Error('原上下文桥名称无效，不能改名重建');
    files['context.json'] = json({ ...metadata, name: project.name,
      databases: databases.map(({ resourceId, environment, type, host, port, database, schema, username, accessLevel }) => ({ resourceId, environment, type, host, port, database, schema, username, accessLevel })),
      servers: servers.map(({ resourceId, environment, ip, port, username, appRoot, logsPath }) => ({ resourceId, environment, host: ip, port, username, appRoot, logsPath })),
      skills: selected.filter((s) => s.enabled).map(({ name, path, version }) => ({ name, path, version })), configPaths: pathEnv, rulesPath: project.rulesPath,
    });
    pathEnv.SMARTDD_PROJECT_CONTEXT = join(runRoot, 'context.json');
    pathEnv.SMARTDD_RESOURCE_AUDIT = auditPath;
    if (mcpEnabled && !input.managed) {
      const mcpArgs = [join(runtimeRoot, 'context_mcp.py'), join(runRoot, 'context.json')];
      if (input.runner === 'claude') {
        files['mcp.json'] = json({ mcpServers: { [mcpName]: { command: 'python3', args: mcpArgs } } });
        args.push('--mcp-config', join(runRoot, 'mcp.json'));
      } else {
        args.push('-c', `mcp_servers.${mcpName}.command="python3"`, '-c', `mcp_servers.${mcpName}.args=${JSON.stringify(mcpArgs)}`);
      }
    }
    Object.assign(env, pathEnv, { SMARTDD_PROJECT_ID: project.id, SMARTDD_CONFIG_VERSION: String(project.configVersion) });
    const hashes = Object.fromEntries(Object.entries(files).map(([path, content]) => [join(runRoot, path), sha256(content)]));
    // Also verify immutable runtime code and Codex's external skill projection in the child.
    for (const [name,content] of Object.entries(scriptFiles)) hashes[join(runtimeRoot,name)] = sha256(content);
    if (input.managed) for (const selection of selected) if (selection.enabled) { const p = input.managed.projections[selection.versionId]; for (const [name,bytes] of Object.entries(p.files)) hashes[join(dirname(p.path),name)] = sha256(Buffer.from(bytes)); }
    for (const { selection, files: source } of packages) if (!input.managed && input.runner === 'codex' && selection.enabled) for (const [name, content] of Object.entries(source)) hashes[join(dirname(selection.path), name)] = sha256(content);
    const manifestPath = join(runRoot, 'manifest.json');
    const manifest = json({ ...metadata, runId, files: hashes, requiredEnv: Object.keys(env), pathEnv: { ...pathEnv, SMARTDD_PROJECT_ID: project.id, SMARTDD_CONFIG_VERSION: String(project.configVersion) },
      pythonModules: [...new Set(databases.map((d) => d.type === 'mysql' ? 'pymysql' : 'psycopg2'))], commands: servers.length ? ['ssh'] : [], readablePaths });
    files['manifest.json'] = manifest;
    writeOwnedTree(runRoot, files, this.backupRoot);
    this.activeRuns.add(runRoot); if (input.managed) this.managedRuns.add(runRoot);
    const snapshot: RuntimeSnapshot = { runId, projectId: project.id, configVersion: project.configVersion, configHash, manifestPath, auditPath, skills: selected,
      mcp: mcpEnabled ? [{ name: mcpName, loaded: 'unverified' }] : [], selfCheck: { status: 'pending', issues: [], at: null } };
    const ownedRoot = lstatSync(runRoot);
    const cleanup = (mode: OriginalRunCleanup): void => {
      try {
        if (!existsSync(runRoot)) return;
        const current = lstatSync(runRoot);
        if (!current.isDirectory() || current.isSymbolicLink() || current.dev !== ownedRoot.dev || current.ino !== ownedRoot.ino) return;
        if (mode === 'hold') return;
        if (mode === 'retain-plugin') {
          const actual = readOwnedTree(runRoot),known = new Set([...Object.keys(files),'self-check.json']);
          if (Object.keys(actual).some(name => !known.has(name)) || Object.entries(files).some(([name,bytes]) => actual[name] !== bytes)) return;
          const directories = new Set<string>();
          for (const name of Object.keys(files)) for (let parent = dirname(name); parent !== '.'; parent = dirname(parent)) directories.add(parent);
          for (const dir of ['',...directories]) for (const name of readdirSync(join(runRoot,dir))) {
            const path = join(dir,name);
            if (lstatSync(join(runRoot,path)).isDirectory() && !directories.has(path)) return;
          }
          const marker = '.smartdd-owned.json';
          if (readFileSync(join(runRoot,marker),'utf8') !== JSON.stringify({ owner: 'SmartDD',schema: 1 })) return;
          for (const name of [...Object.keys(actual),marker]) {
            const leaf = lstatSync(join(runRoot,name));
            if (!leaf.isFile() || leaf.isSymbolicLink() || leaf.nlink !== 1) return;
          }
          // Only known ephemeral leaves are removed. The original plugin tree and
          // original root marker keep their paths, bytes, modes and inodes.
          for (const name of [...Object.keys(files),'self-check.json']) {
            if (name.startsWith('plugin/')) continue;
            if (name.includes('/')) return;
            rmSync(join(runRoot,name),{ force: true });
          }
        } else rmSync(runRoot,{ recursive: true,force: true });
      } catch { /* Unknown/replaced paths are retained; never turn cleanup into an overwrite. */ }
    };
    const releaseOwned = input.managed ? () => cleanup('remove') : registerOriginalRun(runRoot,snapshot,cleanup);
    const release = () => { releaseOwned();this.activeRuns.delete(runRoot);this.managedRuns.delete(runRoot);this.runCleanups.delete(runRoot); };
    this.runCleanups.set(runRoot,release);
    const allowedIssues = new Set(['file_hash_mismatch', 'file_unreadable', 'resource_path_unreadable', 'manifest_hash_mismatch', 'manifest_invalid', 'runner_not_found', 'self_check_report_failed',
      ...Object.keys(env).map((n) => `missing_env:${n}`), ...Object.keys(pathEnv).concat(['SMARTDD_PROJECT_ID', 'SMARTDD_CONFIG_VERSION']).map((n) => `wrong_path_env:${n}`),
      'missing_dependency:pymysql', 'missing_dependency:psycopg2', 'missing_command:ssh']);
    return { args, env, secretValues, snapshot,
      wrap: (command, cliArgs) => ({ command: 'python3', args: [join(runtimeRoot, 'launch.py'), manifestPath, sha256(manifest), command, ...cliArgs] }),
      check: () => {
        const file = join(runRoot, 'self-check.json');
        if (!existsSync(file)) return null;
        try {
          const report = JSON.parse(readFileSync(file, 'utf8'));
          if (!['passed', 'failed'].includes(report.status) || !Array.isArray(report.issues) || !report.issues.every((i: unknown) => typeof i === 'string' && allowedIssues.has(i)) || (report.status === 'passed' && report.issues.length > 0)) throw new Error();
          return { status: report.status, issues: report.issues, at: typeof report.at === 'number' ? report.at : Date.now() };
        } catch { return { status: 'failed', issues: ['self_check_report_invalid'], at: Date.now() }; }
      },
      release,
    };
  }

  dispose(): void {
    for (const root of [...this.activeRuns]) if (!this.managedRuns.has(root)) this.runCleanups.get(root)?.();
    // Managed T is released only by the run owner after actual CLI/bridge/executor exit.
  }
}
