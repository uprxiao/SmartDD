import { randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import type { AgentLaunchPlan } from './agent-launch-plan';

function jsonFile(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2 * 1024 * 1024) throw new Error('智能体管理配置文件无效，请检查后重试');
  let value: unknown;
  try { value = JSON.parse(readFileSync(path, 'utf8')); } catch { throw new Error('智能体管理配置 JSON 已损坏，请检查后重试'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('智能体管理配置格式无效');
  return value as Record<string, unknown>;
}

function privateDirectory(base: string, path: string): void {
  const rest = relative(base, path);
  if (rest === '..' || rest.startsWith(`..${sep}`) || resolve(path) === resolve(base)) throw new Error('管理配置超出 WillYou 私有目录');
  let current = base;
  for (const part of rest.split(sep)) {
    current = join(current, part);
    if (!existsSync(current)) mkdirSync(current, { mode: 0o700 });
    const stat = lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink() || process.getuid && stat.uid !== process.getuid()) throw new Error('智能体管理目录身份异常');
  }
}

function atomicJson(path: string, value: unknown): void {
  if (existsSync(path)) {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || process.getuid && stat.uid !== process.getuid()) throw new Error('智能体管理配置文件身份异常');
  }
  const temp = join(dirname(path), `.willyou-${randomUUID()}.tmp`);
  try { writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); renameSync(temp, path); }
  finally { try { unlinkSync(temp); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; } }
}

/** Only host-owned per-run catalogs and per-Agent Claude settings. Never accepts
 * the user's native CLI root as a destination and never writes any credentials.
 */
export function materializeAgentPlan(plan: AgentLaunchPlan, userData: string, cwd: string): void {
  if (!plan.files.length && !plan.claudeRoot) return;
  const base = realpathSync(userData), managed = join(base, 'agents');
  const keyValues = Object.entries(plan.profile.env).filter(([name]) => ['OPENAI_API_KEY','ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN'].includes(name)).map(([,value]) => value);
  const serialized = JSON.stringify(plan.files);
  if (keyValues.some((key) => key && [key, JSON.stringify(key).slice(1,-1), encodeURIComponent(key)].some((form) => serialized.includes(form)))) throw new Error('管理配置包含认证值，已拒绝写入');
  for (const file of plan.files) {
    const rest = relative(managed, resolve(file.path));
    if (!rest || rest === '..' || rest.startsWith(`..${sep}`)) throw new Error('管理配置超出 WillYou 私有目录');
  }
  if (plan.claudeRoot) {
    const rest = relative(join(managed, 'claude'), resolve(plan.claudeRoot));
    if (!/^[a-f0-9]{32}$/.test(rest)) throw new Error('Claude 管理目录身份异常');
    privateDirectory(base, plan.claudeRoot);
    if (existsSync(join(plan.claudeRoot, '.credentials.json'))) throw new Error('Claude 管理目录含有残留认证，请移除后重试');
    const settings = jsonFile(join(plan.claudeRoot, 'settings.json'));
    if (['env','apiKeyHelper','headersHelper','awsAuthRefresh','awsCredentialExport','forceLoginMethod'].some((key) => Object.hasOwn(settings, key))) throw new Error('Claude 管理目录含有残留认证配置，请检查后重试');
    const native = jsonFile(join(plan.claudeRoot, '.claude.json'));
    if (['oauthAccount','apiKey','primaryApiKey','apiKeyHelper'].some((key) => Object.hasOwn(native, key))) throw new Error('Claude 管理目录含有残留认证，请检查后重试');
    const projects = native.projects && typeof native.projects === 'object' && !Array.isArray(native.projects) ? native.projects as Record<string, unknown> : {};
    const previous = projects[cwd];
    atomicJson(join(plan.claudeRoot, '.claude.json'), { ...native, hasCompletedOnboarding: true,
      projects: { ...projects, [cwd]: { ...(previous && typeof previous === 'object' && !Array.isArray(previous) ? previous : {}), hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true } } });
    for (const file of plan.files) {
      privateDirectory(base, dirname(file.path));
      atomicJson(file.path, file.path === join(plan.claudeRoot, 'settings.json') ? { ...settings, ...(file.value as object) } : file.value);
    }
  } else {
    for (const file of plan.files) {
      privateDirectory(base, dirname(file.path));
      if (existsSync(file.path)) throw new Error('本次运行配置已存在，请重新创建运行');
      atomicJson(file.path, file.value);
    }
  }
}
