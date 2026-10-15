import { createHash } from 'node:crypto';

const sources = import.meta.glob('@root/resources/standard-skills/**', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const runtime = import.meta.glob('@root/resources/runtime/*.py', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

export const sha256 = (content: string | Buffer): string => createHash('sha256').update(content).digest('hex');
export const treeHash = (files: Record<string, string>): string => sha256(JSON.stringify(Object.entries(files).sort(([a], [b]) => a.localeCompare(b))));

export interface BundledSkill {
  id: string;
  name: string;
  description: string;
  source: string;
  version: string;
  hash: string;
  files: Record<string, string>;
}

export const BUNDLED_SKILLS: BundledSkill[] = [
  { id: 'project-db-diagnostics', description: '项目数据库只读诊断', name: 'smartdd-project-db-diagnostics' },
  { id: 'remote-password-ssh', description: '项目 SSH 排查与日志读取', name: 'smartdd-remote-password-ssh' },
].map((item) => {
  const prefix = `/standard-skills/${item.id}/`;
  const files = Object.fromEntries(Object.entries(sources).filter(([path]) => path.includes(prefix)).map(([path, content]) => [path.split(prefix)[1], content]));
  if (!files['SKILL.md']) throw new Error(`内置 Skill 资产缺失：${item.id}`);
  return { ...item, source: `${item.id} → SmartDD`, version: '1.0.0', hash: treeHash(files), files };
});

export const runtimeFiles = (): Record<string, string> => Object.fromEntries(Object.entries(runtime).map(([path, content]) => [path.split('/').at(-1)!, content]));
