// V06 M13 Skill 交付方式在 SDK / app-server 模式下是否原样生效（本机 CLI + 真实模型）。
// 按 M13 现行布局摆放：Claude —— CLAUDE_CONFIG_DIR=托管根 + settingSources ['user']；Skill 分别放在
//   (a) HOME/.claude/skills（M13 library.skillDirectory）(b) 托管根/skills (c) SDK plugins 本地插件（对应 M13 session-plugin）
// Codex —— HOME/.agents/skills（M13 shared-home），经 app-server skills/list 与真实回合核对。
// 每个 Skill 带相对脚本 scripts/stamp.sh，调用后写出唯一标记文件，证明"内容 + 相对资源"都被实际使用。
// 用法：DEEPSEEK_API_KEY=... M14_CLAUDE_SDK=<sdk.mjs> node skills-under-sdk.mjs <outDir>
import {mkdirSync, writeFileSync, existsSync, readFileSync, chmodSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {openCodex, runClaude, versions, redact} from './lib/agents.mjs';

const out = process.argv[2]; mkdirSync(out, {recursive: true});
writeFileSync(join(out, 'versions.json'), JSON.stringify(versions(), null, 2));
const steps = []; const check = (name, ok, detail) => { steps.push({name, ok: !!ok, detail}); console.log(ok ? 'PASS' : 'FAIL', name, typeof detail === 'string' ? detail.slice(0, 160) : JSON.stringify(detail)?.slice(0, 200)); };
function makeSkill(dir, name, marker) {
  mkdirSync(join(dir, name, 'scripts'), {recursive: true});
  writeFileSync(join(dir, name, 'SKILL.md'), `---\nname: ${name}\ndescription: Use when the user asks for the ${name} stamp. Runs the bundled script to write a marker file.\n---\n\n# ${name}\n\nRun the bundled script with bash from this skill's directory: \`bash scripts/stamp.sh <project-dir>\` (resolve scripts/stamp.sh relative to this SKILL.md). Then reply with the marker it prints.\n`);
  writeFileSync(join(dir, name, 'scripts/stamp.sh'), `#!/bin/bash\necho ${marker} > "$1/${name}.stamp"\necho ${marker}\n`); chmodSync(join(dir, name, 'scripts/stamp.sh'), 0o755);
}

// ---------- Claude ----------
{
  const home = join(out, 'claude-home'); const root = join(out, 'claude-managed-root'); const cwd = join(out, 'claude-project');
  for (const d of [home, root, cwd]) mkdirSync(d, {recursive: true});
  const mk = {a: 'M_A_' + randomUUID().slice(0, 8), b: 'M_B_' + randomUUID().slice(0, 8), c: 'M_C_' + randomUUID().slice(0, 8)};
  makeSkill(join(home, '.claude/skills'), 'wy-home-skill', mk.a);
  makeSkill(join(root, 'skills'), 'wy-root-skill', mk.b);
  const plugin = join(out, 'claude-plugin'); mkdirSync(join(plugin, '.claude-plugin'), {recursive: true});
  writeFileSync(join(plugin, '.claude-plugin/plugin.json'), JSON.stringify({name: 'wy-plugin', version: '1.0.0', description: 'WillYou session plugin probe'}));
  makeSkill(join(plugin, 'skills'), 'wy-plugin-skill', mk.c);
  const extra = {tools: ['Bash', 'Read', 'Skill'], settingSources: ['user'], plugins: [{type: 'local', path: plugin}], permissionMode: 'bypassPermissions', allowDangerouslySkipPermissions: true};
  // 发现：只看 init，不需要模型多轮
  const disc = await runClaude({cwd, out, actor: 'claude-discovery', home, prompt: 'Reply with only OK.', maxTurns: 1,
    extra});
  const init = disc.messages.find((m) => m.type === 'system' && m.subtype === 'init');
  const skills = init?.skills ?? []; const slash = init?.slash_commands ?? [];
  writeFileSync(join(out, 'claude-init.json'), redact({skills, slash_commands: slash, plugins: init?.plugins, cwd: init?.cwd}));
  // 注意：runClaude 固定 CLAUDE_CONFIG_DIR=<home>/.claude，与 M13 的"托管根 ≠ HOME/.claude"不同；下面第二次运行改用托管根复现 M13
  check('claude: HOME/.claude/skills discovered when CLAUDE_CONFIG_DIR=HOME/.claude', [...skills, ...slash].some((s) => String(s).includes('wy-home-skill')), {skills, slash});
  check('claude: SDK local plugin skill discovered', [...skills, ...slash].some((s) => String(s).includes('wy-plugin-skill')), {plugins: init?.plugins});
  // M13 实际布局：CLAUDE_CONFIG_DIR = 托管根
  const m13 = await runClaude({cwd, out, actor: 'claude-m13-layout', home, prompt: 'Reply with only OK.', maxTurns: 1,
    extra, claudeConfigDir: root});
  const init2 = m13.messages.find((m) => m.type === 'system' && m.subtype === 'init');
  const s2 = [...(init2?.skills ?? []), ...(init2?.slash_commands ?? [])].map(String);
  writeFileSync(join(out, 'claude-init-m13.json'), redact({skills: init2?.skills, slash_commands: init2?.slash_commands}));
  check('claude(M13 layout): managed root skills discovered', s2.some((s) => s.includes('wy-root-skill')), s2.filter((s) => s.startsWith('wy')));
  check('claude(M13 layout): HOME/.claude/skills NOT read (expected if CLAUDE_CONFIG_DIR overrides)', !s2.some((s) => s.includes('wy-home-skill')), s2.filter((s) => s.startsWith('wy')));
  // 真实模型调用插件 Skill（含相对脚本）
  const inv = await runClaude({cwd, out, actor: 'claude-invoke', home, maxTurns: 8, extra, claudeConfigDir: root,
    prompt: `Use the wy-plugin-skill skill now on project dir ${cwd}. Reply with only the marker it prints.`});
  const stamp = join(cwd, 'wy-plugin-skill.stamp');
  check('claude: real model invoked plugin skill + relative script', existsSync(stamp) && readFileSync(stamp, 'utf8').includes(mk.c) && inv.text.includes(mk.c), {text: inv.text, stamp: existsSync(stamp)});
  const toolNames = inv.messages.flatMap((m) => (m.message?.content ?? []).filter((b) => b.type === 'tool_use').map((b) => b.name));
  check('claude: skill invocation visible as tool_use(Skill) for UI', toolNames.includes('Skill'), toolNames);
}

// ---------- Codex ----------
{
  const cwd = join(out, 'codex-project'); mkdirSync(cwd, {recursive: true});
  const fakeHome = join(out, 'codex-home'); mkdirSync(fakeHome, {recursive: true});
  const mk = 'M_X_' + randomUUID().slice(0, 8);
  // 不能改 HOME（订阅凭据在用户 ~/.codex），因此 Skill 放项目级 .agents/skills 验证同一发现机制；M13 的 HOME/.agents/skills 由 skills/list 的 scope 字段对照
  makeSkill(join(cwd, '.agents/skills'), 'wy-codex-skill', mk);
  const c = await openCodex({cwd, out, actor: 'codex-skills'});
  let list;
  try { list = await c.rpc('skills/list', {cwds: [cwd]}); } catch (e) { list = {error: String(e)}; }
  writeFileSync(join(out, 'codex-skills-list.json'), JSON.stringify(list, null, 1));
  const flat = JSON.stringify(list);
  check('codex: skills/list discovers project .agents/skills', flat.includes('wy-codex-skill'), flat.slice(0, 300));
  check('codex: skills/list also reports user HOME/.agents/skills scope (M13 delivery root)', /"scope":"user"|"user"/.test(flat), (flat.match(/"scope":"[a-z]+"/g) ?? []).slice(0, 5));
  await c.start({sandbox: 'workspace-write'});
  const r = await c.turn(`Use the wy-codex-skill skill on project dir ${cwd}. Reply with only the marker it prints.`);
  await c.close();
  const stamp = join(cwd, 'wy-codex-skill.stamp');
  check('codex: real model invoked skill + relative script', existsSync(stamp) && r.text.includes(mk), {text: r.text, stamp: existsSync(stamp)});
}
writeFileSync(join(out, 'result.json'), redact({steps}));
process.exitCode = steps.every((s) => s.ok) ? 0 : 1;
