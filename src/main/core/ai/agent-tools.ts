import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { access, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { isAbsolute } from 'node:path';
import { codeAgentKindSchema, type CliLogin, type CodeAgentKind, type CodeAgentTool } from '@shared/ai-agents';
import { loginShell, PARENT_AGENT_VARS, planLaunchEnv } from '../../launch-env';
import { detectRunner } from './runner-detect';
import type { AgentService } from './agent-service';

export interface CliProbeResult { code: number | null; stdout: string; stderr: string; timedOut?: boolean }
export interface CliLoginResult { login: CliLogin; error: string | null; loginSourceEnv?: CodeAgentTool['loginSourceEnv'] }
export interface ToolDetection { tool: CodeAgentTool; error: string | null }

function plain(value: string): string { return value.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').trim(); }

/** Only known, verified protocol values get a subscription/API label. Raw output never leaves main. */
export function parseCliLogin(kind: CodeAgentKind, result: CliProbeResult): CliLoginResult {
  if (result.timedOut) return { login: 'none', error: '登录检测超时，请重新检测' };
  if (result.code === 1) return { login: 'none', error: null };
  if (result.code !== 0) return { login: 'none', error: '无法检测登录状态，请在终端检查后重试' };
  if (kind === 'codex') {
    const text = plain(`${result.stdout}\n${result.stderr}`);
    if (/^Logged in using ChatGPT$/m.test(text)) return { login: 'subscription', error: null };
    if (/^(?:API key configured\s*[-–]|Logged in using an API key\b)/m.test(text)) return { login: 'api', error: null };
    return { login: 'local', error: null };
  }
  try {
    const value: unknown = JSON.parse(plain(result.stdout));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not-object');
    const row = value as Record<string, unknown>;
    if (row.loggedIn === false) return { login: 'none', error: null };
    if (row.loggedIn !== true && typeof row.authMethod !== 'string') throw new Error('missing-auth-state');
    if (['api_key', 'api_key_helper', 'oauth_token'].includes(String(row.authMethod))) {
      // Use the CLI's post-shell auth report, never infer from inherited env presence.
      // The allowlist also prevents raw output/values being serialized as source labels.
      const loginSourceEnv = row.authMethod === 'api_key' && row.apiKeySource === 'ANTHROPIC_API_KEY' ? 'ANTHROPIC_API_KEY' as const : undefined;
      return { login: 'api', error: null, ...(loginSourceEnv ? { loginSourceEnv } : {}) };
    }
    // Claude subscription/Console output has not been calibrated: do not guess.
    return { login: 'local', error: null };
  } catch { return { login: 'none', error: '登录状态格式无法识别，请重新检测' }; }
}

/** Uses the same login/interactive shell and post-rc exec semantics as native-login tasks. */
export function probeNativeCli(executable: string, args: string[], base: Record<string, string>): Promise<CliProbeResult> {
  const marker = `__WILLYOU_AUTH_${randomUUID().replaceAll('-', '')}__`;
  const env = { ...base }; for (const name of PARENT_AGENT_VARS) delete env[name];
  const launch = planLaunchEnv(env, {}, []);
  return new Promise((resolve) => {
    execFile(loginShell(), ['-l', '-i', '-c', 'builtin printf "%s\\n" "$1"; shift; exec "$@"', 'willyou-native-login', marker, executable, ...args],
      { env: launch.env, timeout: 10000, maxBuffer: 256 * 1024 }, (error, stdout, stderr) => {
        const output = String(stdout), offset = output.indexOf(`${marker}\n`);
        const code = error ? (typeof error.code === 'number' ? error.code : null) : 0;
        resolve({ code, stdout: offset < 0 ? '' : output.slice(offset + marker.length + 1), stderr: String(stderr), timedOut: Boolean(error?.killed) });
      });
  });
}

type Dependencies = {
  env: () => Record<string, string>;
  discover?: typeof detectRunner;
  probe?: typeof probeNativeCli;
  executable?: (path: string) => Promise<boolean>;
};

export class AgentToolService {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private readonly agents: AgentService, private readonly dependencies: Dependencies) {}

  refresh(): Promise<ToolDetection[]> { return this.serialize(() => this.refreshNow()); }

  customPath(kind: string, path: string | null,toolId?:string): Promise<ToolDetection> { return this.serialize(() => this.customPathNow(kind, path,toolId)); }

  private async refreshNow(): Promise<ToolDetection[]> {
    const stored = this.agents.tools(), requests = [...stored.filter((tool) => codeAgentKindSchema.safeParse(tool.kind).success)];
    for (const kind of ['claude', 'codex'] as const) if (!requests.some((tool) => tool.kind === kind)) requests.push({ id: `tool-${kind}`, kind, executable: kind, customPath: null, version: null, installed: false, login: 'none' });
    const env = this.detectEnv(), results: ToolDetection[] = [];
    for (const request of requests) results.push(await this.inspect(request, env));
    this.agents.recordTools(results.map((result) => result.tool));
    return results;
  }

  private async customPathNow(kindInput: string, path: string | null,toolId?:string): Promise<ToolDetection> {
    const kind = codeAgentKindSchema.parse(kindInput);
    if (path !== null && (!isAbsolute(path) || /[\x00-\x1f\x7f]/.test(path))) throw new Error('请选择本机可执行文件的绝对路径');
    const existing = this.agents.tools().find((tool) => tool.kind === kind&&(!toolId||tool.id===toolId));
    if(toolId&&!existing)throw new Error('Code Agent 已删除或类型变化，请重新检测');
    const request: CodeAgentTool = { ...(existing ?? { id: `tool-${kind}`, kind, version: null, installed: false, login: 'none' }), executable: path ?? kind, customPath: path };
    const result = await this.inspect(request, this.detectEnv());
    // A rejected file selection must not discard the user's last working tool.
    if (result.tool.installed || path === null) this.agents.recordTool(result.tool);
    return result;
  }

  private serialize<T>(action: () => Promise<T>): Promise<T> {
    const result = this.tail.then(action, action);
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }

  private detectEnv(): Record<string, string> {
    const env = { ...this.dependencies.env() };
    for (const name of PARENT_AGENT_VARS) delete env[name];
    return env;
  }

  private async inspect(request: CodeAgentTool, env: Record<string, string>): Promise<ToolDetection> {
    const kind = codeAgentKindSchema.parse(request.kind);
    const discovered = await (this.dependencies.discover ?? detectRunner)(kind, request.customPath ?? null, { env });
    const missing = (error: string): ToolDetection => ({ tool: { ...request, installed: false, version: null, login: 'none', loginSourceEnv: undefined }, error });
    if (!discovered.path) return missing('没有检测到可执行的 Code Agent');
    const executable = this.dependencies.executable ?? (async (path: string) => {
      try { if (!(await stat(path)).isFile()) return false; await access(path, constants.X_OK); return true; } catch { return false; }
    });
    if (!await executable(discovered.path)) return missing('所选文件不可执行');
    const probe = this.dependencies.probe ?? probeNativeCli;
    const version = await probe(discovered.path, ['--version'], env);
    if (version.code !== 0 || version.timedOut) return missing('所选 Code Agent 无法启动或版本检测失败');
    const versionText = plain(`${version.stdout}\n${version.stderr}`).split(/\r?\n/).find(Boolean) ?? '';
    const numericVersion = /\b\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?\b/.exec(versionText)?.[0];
    if (!numericVersion) return missing('无法识别 Code Agent 版本');
    const login = parseCliLogin(kind, await probe(discovered.path, kind === 'claude' ? ['auth', 'status'] : ['login', 'status'], env));
    const tool = { ...request, executable: discovered.path, version: numericVersion, installed: true, login: login.login, loginSourceEnv: login.loginSourceEnv };
    return { tool, error: login.error };
  }
}
