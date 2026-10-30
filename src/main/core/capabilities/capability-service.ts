import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { and, eq, sql } from 'drizzle-orm';
import type { CapabilityPreview, RuntimeSkill, RuntimeSnapshot, SkillVersion, StandardSkill } from '@shared/capabilities';
import { DB_VENDORS } from '@shared/projects';
import type { Runner } from '@shared/types';
import type { AppDb } from '../../db/client';
import { projectCapabilities, projects, skillVersions } from '../../db/schema';
import type { SecretsStore } from '../../secrets';
import type { AiProfileService, ResolvedProfile } from '../ai/ai-profile-service';
import type { ProjectService } from '../projects/project-service';
import { secretKeys } from '../projects/secret-keys';
import { stateRootFor } from '../tasks/native-sessions';
import { BUNDLED_SKILLS, runtimeFiles, sha256, treeHash, type BundledSkill } from './assets';
import { discoverCapabilities } from './discovery';
import { readOwnedTree, writeOwnedTree } from './files';
import { CLAUDE_PNG_ADAPTER, imageInputLaunchSchema, imageInputMode, type ImageInputLaunch } from '@shared/terminal-image';

export const MCP_CAPABILITY = 'smartdd-project-context';
export const RUNTIME_ISOLATION = ['SMARTDD_', 'PROJECT_DB_CONFIG', 'REMOTE_SERVERS_CONFIG'];

export interface PreparedRuntime {
  args: string[];
  env: Record<string, string>;
  secretValues: string[];
  snapshot: RuntimeSnapshot;
  wrap: (command: string, args: string[]) => { command: string; args: string[] };
  check: () => RuntimeSnapshot['selfCheck'] | null;
  imageInputLaunch?: () => ImageInputLaunch | null;
  release: () => void;
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
    return this.d.db.select().from(projectCapabilities).where(eq(projectCapabilities.id, `${projectId}:${capabilityId}`)).get()?.enabled ?? true;
  }

  setEnabled(projectId: string, capabilityId: string, enabled: boolean): void {
    this.d.projects.getProject(projectId);
    if (typeof enabled !== 'boolean' || (!this.bundles.some((s) => s.id === capabilityId) && capabilityId !== MCP_CAPABILITY)) throw new Error('能力设置无效');
    this.d.db.transaction(() => {
      const id = `${projectId}:${capabilityId}`;
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

  prepare(input: { projectId: string; taskId: string; runner: Runner; cwd: string; home: string; profileArgs: string[]; previous?: RuntimeSnapshot | null }): PreparedRuntime {
    const project = this.d.projects.getProject(input.projectId);
    if (!isAbsolute(input.home)) throw new Error('HOME 必须是绝对路径');
    // A profile with its own skills.config would replace our per-session disable list.
    if (input.runner === 'codex' && input.profileArgs.some((a) => /^skills(?:\.|\s*=)/.test(a.trim()))) throw new Error('AI 配置包含 skills 覆盖参数，请移除后使用项目能力开关');
    const previous = input.previous?.projectId === project.id ? input.previous : null;
    const selected = previous ? previous.skills.map((s) => ({ ...s })) : this.list(project.id).map((s) => ({ skillId: s.id, name: s.name, versionId: s.current.id, version: s.current.version, hash: s.current.hash, path: '', enabled: s.enabled, loaded: 'unverified' as const }));
    const packages = selected.map((s) => {
      const v = this.d.db.select().from(skillVersions).where(eq(skillVersions.id, s.versionId)).get();
      if (!v || v.skillId !== s.skillId || v.hash !== s.hash) throw new Error('原任务的 Skill 版本不可用，不能静默替换');
      const files = readOwnedTree(this.packageRoot(v.id));
      if (treeHash(files) !== v.hash) throw new Error(`Skill 版本内容已改变：${v.name}`);
      return { selection: s, files };
    });
    const runId = randomUUID();
    const runRoot = join(this.root, 'runs', project.id, input.taskId, runId);
    const auditPath = join(this.root, 'resource-audit', project.id, `${input.taskId}.jsonl`);
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
    if (input.runner === 'claude') {
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
    const mcpEnabled = previous ? previous.mcp.length > 0 : this.enabled(project.id, MCP_CAPABILITY);
    const mcpName = `smartdd_project_${runId.replaceAll('-', '').slice(0, 12)}`;
    files['context.json'] = json({ ...metadata, name: project.name,
      databases: databases.map(({ resourceId, environment, type, host, port, database, schema, username, accessLevel }) => ({ resourceId, environment, type, host, port, database, schema, username, accessLevel })),
      servers: servers.map(({ resourceId, environment, ip, port, username, appRoot, logsPath }) => ({ resourceId, environment, host: ip, port, username, appRoot, logsPath })),
      skills: selected.filter((s) => s.enabled).map(({ name, path, version }) => ({ name, path, version })), configPaths: pathEnv, rulesPath: project.rulesPath,
    });
    pathEnv.SMARTDD_PROJECT_CONTEXT = join(runRoot, 'context.json');
    pathEnv.SMARTDD_RESOURCE_AUDIT = auditPath;
    if (mcpEnabled) {
      const mcpArgs = [join(this.runtimeRoot, 'context_mcp.py'), join(runRoot, 'context.json')];
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
    for (const [name, content] of Object.entries(runtimeFiles())) hashes[join(this.runtimeRoot, name)] = sha256(content);
    for (const { selection, files: source } of packages) if (input.runner === 'codex' && selection.enabled) for (const [name, content] of Object.entries(source)) hashes[join(dirname(selection.path), name)] = sha256(content);
    const manifestPath = join(runRoot, 'manifest.json');
    const manifest = json({ ...metadata, runId, files: hashes, requiredEnv: Object.keys(env), pathEnv: { ...pathEnv, SMARTDD_PROJECT_ID: project.id, SMARTDD_CONFIG_VERSION: String(project.configVersion) },
      pythonModules: [...new Set(databases.map((d) => d.type === 'mysql' ? 'pymysql' : 'psycopg2'))], commands: servers.length ? ['ssh'] : [], readablePaths });
    files['manifest.json'] = manifest;
    writeOwnedTree(runRoot, files, this.backupRoot);
    this.activeRuns.add(runRoot);
    const snapshot: RuntimeSnapshot = { runId, projectId: project.id, configVersion: project.configVersion, configHash, manifestPath, auditPath, skills: selected,
      mcp: mcpEnabled ? [{ name: mcpName, loaded: 'unverified' }] : [], selfCheck: { status: 'pending', issues: [], at: null } };
    const allowedIssues = new Set(['file_hash_mismatch', 'file_unreadable', 'resource_path_unreadable', 'manifest_hash_mismatch', 'manifest_invalid', 'runner_not_found', 'self_check_report_failed',
      ...Object.keys(env).map((n) => `missing_env:${n}`), ...Object.keys(pathEnv).concat(['SMARTDD_PROJECT_ID', 'SMARTDD_CONFIG_VERSION']).map((n) => `wrong_path_env:${n}`),
      'missing_dependency:pymysql', 'missing_dependency:psycopg2', 'missing_command:ssh']);
    let expectedImageMode: ImageInputLaunch['mode'] = 'unknown', verifiedImageIdentity = '';
    return { args, env, secretValues, snapshot,
      wrap: (command, cliArgs) => {
        expectedImageMode = imageInputMode(cliArgs);
        return { command: 'python3', args: [join(this.runtimeRoot, 'launch.py'), manifestPath, sha256(manifest), command, ...cliArgs] };
      },
      imageInputLaunch: () => {
        try {
          const file = join(runRoot, 'image-input-launch.json');
          if (statSync(file).size > 16 * 1024) return null;
          const launch = imageInputLaunchSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
          const current = statSync(launch.executable, { bigint: true });
          if (launch.runId !== runId || launch.mode !== expectedImageMode || !current.isFile() || String(current.dev) !== launch.device || String(current.ino) !== launch.inode || Number(current.size) !== launch.size || String(current.mtimeNs) !== launch.mtimeNs) return null;
          const identity = `${launch.executable}/${launch.device}/${launch.inode}/${launch.size}/${launch.mtimeNs}`;
          if (launch.sha256 === CLAUDE_PNG_ADAPTER.sha256 && verifiedImageIdentity !== identity) {
            if (launch.size !== CLAUDE_PNG_ADAPTER.bytes || sha256(readFileSync(launch.executable)) !== CLAUDE_PNG_ADAPTER.sha256) return null;
            const after = statSync(launch.executable, { bigint: true });
            if (current.dev !== after.dev || current.ino !== after.ino || current.size !== after.size || current.mtimeNs !== after.mtimeNs) return null;
            verifiedImageIdentity = identity;
          }
          return launch;
        } catch { return null; }
      },
      check: () => {
        const file = join(runRoot, 'self-check.json');
        if (!existsSync(file)) return null;
        try {
          const report = JSON.parse(readFileSync(file, 'utf8'));
          if (!['passed', 'failed'].includes(report.status) || !Array.isArray(report.issues) || !report.issues.every((i: unknown) => typeof i === 'string' && allowedIssues.has(i)) || (report.status === 'passed' && report.issues.length > 0)) throw new Error();
          return { status: report.status, issues: report.issues, at: typeof report.at === 'number' ? report.at : Date.now() };
        } catch { return { status: 'failed', issues: ['self_check_report_invalid'], at: Date.now() }; }
      },
      release: () => { rmSync(runRoot, { recursive: true, force: true }); this.activeRuns.delete(runRoot); },
    };
  }

  dispose(): void {
    for (const root of this.activeRuns) rmSync(root, { recursive: true, force: true });
    this.activeRuns.clear();
  }
}
