// Explicit local QA setup. Synthetic values only; never bundled into WillYou.
import { mkdirSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { encryptProject } from '../../src/main/core/projects/transfer-format';
import { transferFixture } from '../../src/main/core/projects/transfer-fixtures';
import { generateSshTestKey } from '../../src/main/test-ssh-keys';

async function main() {
  const root = process.argv[2];
  if (!root || !isAbsolute(root) || !resolve(root).startsWith('/private/tmp/willyou-m8-')) throw Error('Provide an isolated /private/tmp/willyou-m8-* QA directory');
  mkdirSync(root, { recursive: true, mode: 0o700 });
  for (const name of ['sender-main', 'sender-web', 'a-main', 'a-web', 'b-main', 'b-web', 'c-main', 'c-web']) mkdirSync(join(root, name), { recursive: true });
  const rule = join(root, 'AGENTS-QA.md'); writeFileSync(rule, '# Synthetic QA project\nOnly inspect this isolated test project.\n');
  const f = transferFixture();
  f.project = { name: 'M8 合成验收', aliases: ['AIS 示例'], description: '导入导出端到端测试，仅合成数据', rulesPath: rule };
  f.directories = [
    { ref: 'dir-1', label: '主目录', path: join(root, 'sender-main'), isDefault: true },
    { ref: 'dir-2', label: 'Web 目录', path: join(root, 'sender-web'), isDefault: false },
  ];
  f.databases.push({ ...f.databases[0], ref: 'db-2', env: 'test', label: '离线 PostgreSQL', vendor: 'postgres', port: 1, schema: 'public', isDefault: false });
  f.credentials['db-2'] = { password: '' };
  f.profiles.push({ ref: 'ai-2', name: '本机测试命令', runner: 'codex', executable: '/bin/cat', env: [], args: [], color: null });
  const key = generateSshTestKey('synthetic-key-passphrase');
  f.servers.push({ ...f.servers[0], ref: 'ssh-2', label: '隔离私钥', authType: 'key', defaultRoot: false, sudoPolicy: 'none' });
  f.credentials['ssh-2'] = { privateKey: { encoding: 'base64', data: Buffer.from(key.private).toString('base64') }, passphrase: 'synthetic-key-passphrase' };
  const save = async (name: string, input = f) => writeFileSync(join(root, name), await encryptProject(input, '12345678'), { mode: 0o600 });
  await save('T1.willyou');
  const empty = transferFixture(); empty.profiles = []; delete empty.credentials['ai-1']; empty.directories = []; empty.project.name = 'M8 零目录'; await save('T0.willyou', empty);
  const missing = structuredClone(f); missing.project.rulesPath = '/missing/rules/AGENTS.md'; missing.directories[0].path = '/missing/code'; await save('T-paths.willyou', missing);
  const raw = await encryptProject(f, '12345678'); const altered = JSON.parse(raw.toString()); altered.cipher.tag = Buffer.alloc(16).toString('base64');
  writeFileSync(join(root, 'T-tampered.willyou'), JSON.stringify(altered), { mode: 0o600 });
  writeFileSync(join(root, 'T-malformed.willyou'), '{"format":"willyou.project","version":2}', { mode: 0o600 });
  writeFileSync(join(root, 'existing.willyou'), 'Existing QA file must survive cancellation', { mode: 0o600 });
  console.log(JSON.stringify({ root, fixtures: ['T1.willyou', 'T0.willyou', 'T-paths.willyou', 'T-tampered.willyou', 'T-malformed.willyou'], synthetic: true }));
}
void main();
