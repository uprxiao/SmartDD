import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pause } from '../lib/electron-harness.mjs';

const parseEvents = (output) => output.split(/\r?\n/).flatMap((line) => {
  try { const event = JSON.parse(line); return event.type ? [event] : []; } catch { return []; }
});

export async function liveAgents({ app, root, project, other, inputs, record, safe }) {
  const profiles = await app.invoke('aiProfiles.list');
  const work = profiles.find((p) => p.name === 'CC-work');
  const deepseek = profiles.find((p) => p.name === 'CC-deepseek');
  assert(work && deepseek, 'Two configured AI profiles are required');
  const receive = async (launched, label) => {
    const started = Date.now();
    let lastNotice = 0;
    while (Date.now() - started < 360_000) {
      const output = await app.output(launched.ptyId);
      const events = parseEvents(output);
      const result = events.find((e) => e.type === 'result');
      if (result) {
        await writeFile(join(root, `${label}-terminal.txt`), safe(output), { mode: 0o600 });
        assert.equal(result.is_error, false, `${label} model returned an error; see sanitized artifact`);
        assert.equal(result.subtype, 'success', `${label} did not complete successfully`);
        return { events, result, output };
      }
      if (await app.evaluate(`Object.hasOwn(window.__m5.exits, ${JSON.stringify(launched.ptyId)})`)) {
        await writeFile(join(root, `${label}-terminal.txt`), safe(output), { mode: 0o600 });
        throw new Error(`${label} CLI exited before a result; see sanitized artifact`);
      }
      if (Date.now() - lastNotice > 30_000) { console.log(`${label}: waiting for native CLI (${events.filter((e) => e.type === 'assistant').length} assistant events)`); lastNotice = Date.now(); }
      await pause(500);
    }
    await writeFile(join(root, `${label}-terminal.txt`), safe(await app.output(launched.ptyId)), { mode: 0o600 });
    throw new Error(`${label} native CLI timed out`);
  };
  const launch = (p, profile, firstMessage) => app.invoke('tasks.create', { projectId: p.id, dirId: p.dirs[0].id, aiProfileId: profile.id, firstMessage });
  const inspect = async (launched, response, p, profile, label) => {
    const init = response.events.find((e) => e.type === 'system' && e.subtype === 'init');
    assert(init, `${label} CLI initialization evidence missing`);
    const task = await app.invoke('tasks.get', launched.task.id);
    assert.equal(task.runtimeSnapshot.selfCheck.status, 'passed');
    assert(task.injectedEnvNames.includes('SMARTDD_PROJECT_CONTEXT'));
    assert(profile.env.filter((e) => e.secret).every((e) => e.hasValue && e.value === null));
    const events = (await readFile(task.runtimeSnapshot.auditPath, 'utf8')).trim().split('\n').map(JSON.parse);
    assert(events.every((e) => e.projectId === p.id && e.configHash === task.runtimeSnapshot.configHash));
    assert(events.some((e) => e.status === 'connected' && e.kind === 'database'), `${label} database connection audit missing`);
    assert(events.some((e) => e.status === 'connected' && e.kind === 'ssh'), `${label} SSH connection audit missing`);
    const tools = response.events.flatMap((e) => e.message?.content ?? []).filter((c) => c.type === 'tool_use').map((c) => ({ name: c.name, input: c.input }));
    assert(tools.some((t) => t.name.startsWith('mcp__smartdd_project_')), `${label} did not use the injected MCP`);
    assert(init.mcp_servers?.some((m) => m.name.startsWith('smartdd_project_') && m.status === 'connected'));
    assert(init.skills?.some((name) => name.includes('project-db-diagnostics')));
    assert(init.skills?.some((name) => name.includes('remote-password-ssh')));
    await writeFile(join(root, `${label}-audit.json`), JSON.stringify(events, null, 2), { mode: 0o600 });
    const evidence = { taskId: task.id, nativeSessionId: task.nativeSessionId, profile: profile.name, endpoint: profile.env.find((e) => e.name === 'ANTHROPIC_BASE_URL')?.value,
      model: init.model, responseModels: Object.keys(response.result.modelUsage ?? {}), sessionId: init.session_id,
      skills: init.skills, mcp: init.mcp_servers, tools, audit: events, answer: response.result.result };
    await writeFile(join(root, `${label}-evidence.json`), safe(JSON.stringify(evidence, null, 2)), { mode: 0o600 });
    return { task, evidence };
  };
  const marker = `M5-CONTEXT-${randomUUID()}`;
  const prompt = `只读验收 SmartDD 当前项目 AIS 的场景列表查询。禁止写文件、数据库写入、部署、读取密钥或其他项目配置。记住会话校验词 ${marker}。
先调用 smartdd_project MCP 的上下文工具取得当前项目及 skill 路径；读取两个注入的 SKILL.md，并按它们通过 python3 查询开发库、读取开发服务器日志。仅查 SELECT DATABASE(), COUNT(*) FROM SA_SCENE；日志只输出最后 3 行的时间戳（cut -c1-23）及 hostname，不输出日志正文。
源码只需定位这四处：ultrasafe-ais-view-ms/src/dev/aiScene/index.js、ultrasafe-ais-web-ms/src/main/java/com/ultrasafe/ais/web/dev/controller/SceneController.java、同模块 service/SceneService.java 的 querySceneList、ultrasafe-ais-dao/src/main/java/com/ultrasafe/ais/dao/dev/dao/SaSceneDAO.java 的 querySceneList。用 Read 或 Grep 读取相关小段即可。
最后用中文简短给出五项：业务逻辑、数据存储、当前环境、对应页面、实际数据库。指出 IS_DELETED 过滤、默认排序与分页，引用源码路径；区分源码页面核对与浏览器实测。不要扫描历史数据或做额外任务。`;
  const ais = await launch(project, work, prompt);
  const aisResponse = await receive(ais, 'claude-ais');
  const aisEvidence = await inspect(ais, aisResponse, project, work, 'claude-ais');
  assert(aisEvidence.evidence.audit.some((e) => e.host === inputs.dbInput.host));
  assert(aisEvidence.evidence.audit.some((e) => (e.host ?? e.ip) === inputs.serverInput.host));
  assert(/SA_SCENE/.test(aisResponse.result.result));
  record('V2-V3 live agent', 'CC-work invoked the injected Skills and MCP; audited database and SSH targets match AIS development');
  record('V5 agent report', 'Scene-list investigation produced source, database and environment evidence for independent review');
  await app.invoke('tasks.kill', ais.task.id);

  const control = await launch(other, deepseek, `只读验收：调用注入的 smartdd_project MCP 获取当前项目上下文，读取其中两个 SKILL.md。使用注入的数据库 Skill 查询开发库 SELECT DATABASE() AS current_database, CURRENT_USER() AS current_user；使用 SSH Skill 到开发服务器执行 hostname。用 python3 执行 Skill 脚本，不直接连接或读个人配置。只输出当前项目、实际数据库、服务器返回值；不输出任何密码、令牌或环境变量值。禁止写文件、修改数据、访问其他项目。`);
  const controlResponse = await receive(control, 'deepseek-control');
  const controlEvidence = await inspect(control, controlResponse, other, deepseek, 'deepseek-control');
  assert(controlEvidence.evidence.audit.every((e) => !JSON.stringify(e).includes(inputs.dbInput.host) && !JSON.stringify(e).includes(inputs.serverInput.host)));
  assert(controlResponse.result.result.includes('smartdd_m5_control'));
  assert(controlResponse.result.result.includes('SMARTDD_M5_CONTROL_SERVER'));
  record('V4 live agent', 'CC-deepseek selected the control project database and server without reaching AIS');
  assert(aisEvidence.evidence.model.startsWith('claude-'));
  assert(controlEvidence.evidence.model.startsWith('deepseek-'));
  record('V10', 'Existing CC-work and CC-deepseek profiles authenticated with their separate configured endpoints and reported their respective models');
  record('V9 runtime', 'Native Claude initialization confirms both project Skills and connected MCP; both agents actually invoked the context tool');
  await app.invoke('tasks.kill', control.task.id);
  return { ais: aisEvidence, control: controlEvidence, prepareResume: () => {
    // Only the isolated test profile changes; the ordinary profile stays interactive.
    execFileSync('python3', ['-c', `import json,sqlite3,sys
db,id,prompt=sys.argv[1:]
s=sqlite3.connect(db)
args=json.loads(s.execute('SELECT args FROM ai_profiles WHERE id=?',(id,)).fetchone()[0])
args.append(prompt)
s.execute('UPDATE ai_profiles SET args=? WHERE id=?',(json.dumps(args),id));s.commit();s.close()
`, join(root, 'userdata', 'smartdd.db'), work.id, '上一轮开头要求你记住的会话校验词是什么？只回复该校验词，不调用工具，也不要读取任何文件。']);
  }, resume: async (reopened) => {
    app = reopened;
    const saved = await app.invoke('tasks.get', ais.task.id);
    assert.equal(saved.recovery, 'resumable');
    assert((await app.invoke('tasks.list')).some((t) => t.id === ais.task.id));
    const resumed = await app.invoke('tasks.open', { taskId: ais.task.id });
    assert.equal(resumed.task.nativeSessionId, ais.task.nativeSessionId);
    const reply = await receive(resumed, 'claude-resume');
    assert(reply.result.result.includes(marker), 'Native resume did not recall the prior context');
    await app.invoke('tasks.kill', resumed.task.id);
    record('V7', 'After closing and reopening SmartDD, native resume recalled a random marker from the earlier conversation');
    return { taskId: saved.id, nativeSessionId: saved.nativeSessionId, contextRecalled: true };
  } };
}
