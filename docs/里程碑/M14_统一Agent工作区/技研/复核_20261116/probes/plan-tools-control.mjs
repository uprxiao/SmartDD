// V18 对照：各 permissionMode 下 init 工具列表是否含 EnterPlanMode/ExitPlanMode（只问一句，不写文件）。
import {mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {runClaude} from './lib/agents.mjs';
const out = join(import.meta.dirname, 'evidence', 'v18-control'); rmSync(out, {recursive: true, force: true}); mkdirSync(out, {recursive: true});
const R = {};
for (const mode of ['default', 'acceptEdits', 'dontAsk', 'bypassPermissions']) {
  const cwd = join(out, mode); mkdirSync(cwd, {recursive: true});
  const extra = {permissionMode: mode, ...(mode === 'bypassPermissions' ? {allowDangerouslySkipPermissions: true} : {}), canUseTool: async (_n, input) => ({behavior: 'allow', updatedInput: input})};
  let r; try { r = await runClaude({cwd, out, actor: mode, prompt: '只回答：ok', maxTurns: 1, extra}); } catch (e) { r = {messages: [], error: String(e.message).slice(0, 120)}; }
  const init = r.messages.find(m => m.type === 'system' && m.subtype === 'init');
  R[mode] = {initMode: init?.permissionMode, planTools: (init?.tools || []).filter(t => /Plan/.test(t)), toolCount: init?.tools?.length, err: r.error};
  console.log(mode, JSON.stringify(R[mode]));
}
writeFileSync(join(out, 'summary.json'), JSON.stringify(R, null, 2));
