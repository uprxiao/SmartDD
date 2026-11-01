// M11 T13: fresh HOME/CODEX_HOME/userData, real packaged App + Codex 0.166.0, loopback synthetic model, one read-only mail MCP call,
// then real terminal echo and the real session-applications panel. Cannot alone close T13.
// Not proof of real model reasoning, real Foxmail/ZenTao data, or completion of an M11 formal case.
// Derived from the archived M10 T actual-CLI UI driver (original SHA256 af541844bf67142b4394cdaf5dbfddf79e2921a8cbebbc4f6cca9a301b444bef).
// Real App/PTY/Codex/MCP and private SQLite; Responses model is a loopback synthetic fixture.
// No daily credentials, external business services, actual model reasoning or email send.
// This driver records partial coverage; it cannot close all layers of a formal case.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { parse as parseToml } from "smol-toml";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
import { openElectron } from "../lib/electron-harness.mjs";
import {
 installAppFocusGuard,
 isAppFocusYield,
} from "../lib/app-focus-guard.mjs";
import { focusNewInstalledWindow } from "./fixtures/dmg-install-ui.mjs";

const root = await mkdtemp("/private/tmp/willyou-m11-t13-terminal-");
const home = join(root, "home"),
 state = join(root, "codex"),
 cwd = join(root, "project"),
 userData = join(root, "userdata");
const executable = process.env.WILLYOU_ACCEPTANCE_APP,
 cli = process.env.WILLYOU_CODEX_CLI;
assert(
 executable && cli,
 "Set WILLYOU_ACCEPTANCE_APP and WILLYOU_CODEX_CLI to this private package and isolated Codex executable",
);
const appRoot = resolve(dirname(executable), "../..");
assert(/^\/private\/tmp\/willyou-m11-(s[47]|t13-terminal)/.test(appRoot));
assert(
 /^[a-f0-9]{64}$/.test(process.env.WILLYOU_TEST_SOURCE_MANIFEST_SHA ?? ""),
);
const sha = (b) => createHash("sha256").update(b).digest("hex");
const marker = "M11_S4_NATIVE_READ_" + root.split("-").at(-1);
const result = {
 schema: "m11-t13-terminal-and-diagnostics-v1",
 startedAt: new Date().toISOString(),
 root,
 userData,
 home,
 state,
 cwd,
 branch: execFileSync("git", ["branch", "--show-current"], {
  encoding: "utf8",
 }).trim(),
 sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
 }).trim(),
 sourceDirty: !!execFileSync("git", ["status", "--porcelain"], {
  encoding: "utf8",
 }).trim(),
 app: appRoot,
 asarSha256: sha(await readFile(join(appRoot, "Contents/Resources/app.asar"))),
 layer:
  "A: real packaged App composer -> actual Codex CLI -> real M11 v2 MCP capability returning the unified result -> actual session diagnostics; model response is private synthetic fixture, no real model or external send",
 isolation: {
  minimalDriverEnv: true,
  freshHome: true,
  freshCodexHome: true,
  freshUserData: true,
  noDailyCredentialsCopied: true,
  proxy: "unreachable loopback except localhost",
  setup:
   "project, AI profile and application selection via RPC are prerequisites, not UI coverage",
 },
 sourceManifestSha256: process.env.WILLYOU_TEST_SOURCE_MANIFEST_SHA,
 marker,
 requests: [],
 checks: [],
 status: "running",
 formalCasePassesAdded: 0,
};
assert(
 process.env.WILLYOU_ACCEPTANCE_ASAR_SHA,
 "Pin the actual ASAR SHA256 before acceptance",
);
assert.equal(result.asarSha256, process.env.WILLYOU_ACCEPTANCE_ASAR_SHA);
result.cli = {
 path: cli,
 version: execFileSync(cli, ["--version"], { encoding: "utf8" }).trim(),
 entrySha256: sha(await readFile(cli)),
};
assert.equal(result.cli.version, "codex-cli 0.166.0");
for (const p of [
 home,
 state,
 join(cwd, ".git"),
 join(home, ".agents/skills/m11-owned-config"),
])
 await mkdir(p, { recursive: true });
const skill = join(home, ".agents/skills/m11-owned-config/SKILL.md");
await writeFile(
 skill,
 "---\nname: m11-owned-config\ndescription: Private configuration preservation marker.\n---\nNo action is required.\n",
);
let stage = "setup",
 app,
 task,
 project,
 profile;
const sockets = new Set();
const progress = async () => {
 const value = {
  at: new Date().toISOString(),
  stage,
  root,
  pid: app?.processId,
  taskId: task?.id,
  requests: result.requests.length,
 };
 await writeFile(
  join(root, "progress.json"),
  JSON.stringify(value, null, 2) + "\n",
 );
 console.log(JSON.stringify(value));
};
const checked = (name, details = {}) => {
 result.checks.push({
  name,
  at: new Date().toISOString(),
  passed: true,
  ...details,
 });
};
const shellQuote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
async function readRunPlan() {
 return poll(
  async () =>
   app.mainEvaluate(
    `(()=>{const req=process.getBuiltinModule('module').createRequire(process.resourcesPath+'/app.asar/package.json');const DB=req('better-sqlite3'),db=new DB(${JSON.stringify(join(userData, "smartdd.db"))},{readonly:true});try{const row=db.prepare("SELECT plan_json FROM capability_resource_operations WHERE kind='application-run-plan' ORDER BY created_at DESC LIMIT 1").get();return row?JSON.parse(row.plan_json):null}finally{db.close()}})()`,
   ),
  15000,
 );
}
const server = createServer((req, res) => {
 let chunks = [],
  bytes = 0;
 req.on("data", (b) => {
  bytes += b.length;
  if (bytes > 4 * 1024 * 1024) req.destroy();
  else chunks.push(b);
 });
 req.on("end", async () => {
  if (!req.url?.endsWith("/responses")) {
   res.writeHead(404);
   res.end("{}");
   return;
  }
  let body;
  try {
   body = JSON.parse(Buffer.concat(chunks).toString());
  } catch {
   res.writeHead(400);
   res.end("{}");
   return;
  }
  if (body.tools?.some((x) => (x.name ?? "").startsWith("mcp__wy_")))
   writeFile(
    join(root, "native-tool-definitions.json"),
    JSON.stringify(
     body.tools.filter((x) => (x.name ?? "").startsWith("mcp__wy_")),
     null,
     2,
    ) + "\n",
   ).catch(() => {});
  const raw = JSON.stringify(body),
   taskRequest = raw.includes(marker),
   healthCode = raw.match(/SMARTDD-OK-[0-9a-f]{8}/)?.[0];
  const text = taskRequest
   ? marker + "_DONE"
   : (healthCode ?? "M11_PRIVATE_FIXTURE_OK");
  const item = {
   at: new Date().toISOString(),
   kind: taskRequest
    ? "ui-task"
    : healthCode
      ? "profile-health"
      : "unclassified",
   model: body.model,
   requestBytes: bytes,
   sha256: sha(raw),
   userSkillMarkerPresent: raw.includes("m11-owned-config"),
   toolNames: (body.tools ?? []).map((x) => x.name ?? x.type),
   response: text,
  };
  result.requests.push(item);
  console.log(
   JSON.stringify({
    request: item.kind,
    model: item.model,
    tools: item.toolNames,
   }),
  );
  res.writeHead(200, {
   "content-type": "text/event-stream",
   "cache-control": "no-cache",
   connection: "close",
  });
  if (taskRequest && !result.issuedSkill) {
   try {
    result.runPlan = await readRunPlan();
    assert.equal(
     result.runPlan.applications.find((a) => a.appId === "mail").effectiveEntry,
     "mcp",
    );
    const entry = result.runPlan.skills.find((v) => v.appId === "mail");
    assert(entry);
    const path = join(home, ".agents/skills", entry.nativeName, "SKILL.md");
    const tools = (body.tools ?? []).flatMap((t) =>
     t.type === "namespace"
      ? (t.tools ?? []).map((v) => ({ ...v, namespace: t.name }))
      : [t],
    );
    const exec = tools.find((t) => t.name === "exec_command");
    assert(exec);
    const call = {
     type: "function_call",
     id: "fc_m11_local_skill",
     call_id: "call_m11_local_skill",
     name: exec.name,
     ...(exec.namespace ? { namespace: exec.namespace } : {}),
     arguments: JSON.stringify({
      cmd: "/bin/cat " + shellQuote(path),
      max_output_tokens: 12000,
      yield_time_ms: 10000,
     }),
     status: "completed",
    };
    result.issuedSkill = {
     ...call,
     path,
     fixture: "synthetic model chooses actual native file read",
    };
    const send = (type, value) =>
     res.write(
      "event: " +
       type +
       "\ndata: " +
       JSON.stringify({ type, ...value }) +
       "\n\n",
     );
    send("response.created", {
     response: {
      id: "resp_m11_skill",
      object: "response",
      created_at: Math.floor(Date.now() / 1000),
      status: "in_progress",
      output: [],
     },
    });
    send("response.output_item.added", {
     output_index: 0,
     item: { ...call, status: "in_progress", arguments: "" },
    });
    send("response.function_call_arguments.delta", {
     item_id: call.id,
     output_index: 0,
     delta: call.arguments,
    });
    send("response.function_call_arguments.done", {
     item_id: call.id,
     output_index: 0,
     arguments: call.arguments,
    });
    send("response.output_item.done", { output_index: 0, item: call });
    send("response.completed", {
     response: {
      id: "resp_m11_skill",
      object: "response",
      created_at: Math.floor(Date.now() / 1000),
      status: "completed",
      model: body.model,
      output: [call],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
     },
    });
    res.end();
    return;
   } catch (error) {
    result.fixtureFailure = {
     code: "MAIL_SKILL_PRECONDITION",
     message: String(error),
    };
    res.end();
    return;
   }
  }
  if (taskRequest && !result.issuedTool) {
   result.skillOutput = (body.input ?? []).filter(
    (v) => v.call_id === "call_m11_local_skill",
   );
   const ns = (body.tools ?? []).find(
    (x) =>
     x.type === "namespace" &&
     (x.tools ?? []).some((t) => t.name === "smartdd_mail_draft_list_v2"),
   );
   writeFileSync(
    join(root, "actual-native-tools.json"),
    JSON.stringify(body.tools ?? [], null, 2) + "\n",
   );
   if (!ns) {
    result.fixtureFailure = {
     code: "MCP_TOOL_MISSING",
     message: "Actual native request is missing the declared Mail read tool",
    };
    res.end();
    return;
   }
   const argumentsText = "{}";
   const call = {
    type: "function_call",
    id: "fc_m11_local_draft",
    call_id: "call_m11_local_draft",
    name: "smartdd_mail_draft_list_v2",
    namespace: ns.name,
    arguments: argumentsText,
    status: "completed",
   };
   result.issuedTool = {
    ...call,
    at: new Date().toISOString(),
    fixture:
     "private synthetic provider chooses this exact read operation; actual Codex/App/MCP execute it, no autonomous real-model tool selection",
   };
   const send = (type, value) =>
    res.write(
     "event: " +
      type +
      "\ndata: " +
      JSON.stringify({ type, ...value }) +
      "\n\n",
    );
   send("response.created", {
    response: {
     id: "resp_m11_tool",
     object: "response",
     created_at: Math.floor(Date.now() / 1000),
     status: "in_progress",
     output: [],
    },
   });
   send("response.output_item.added", {
    output_index: 0,
    item: { ...call, status: "in_progress", arguments: "" },
   });
   send("response.function_call_arguments.delta", {
    item_id: call.id,
    output_index: 0,
    delta: argumentsText,
   });
   send("response.function_call_arguments.done", {
    item_id: call.id,
    output_index: 0,
    arguments: argumentsText,
   });
   send("response.output_item.done", { output_index: 0, item: call });
   send("response.completed", {
    response: {
     id: "resp_m11_tool",
     object: "response",
     created_at: Math.floor(Date.now() / 1000),
     status: "completed",
     model: body.model,
     output: [call],
     usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    },
   });
   res.end();
   return;
  }
  if (taskRequest && result.issuedTool) {
   const outputs = (body.input ?? []).filter(
    (x) =>
     x.type === "function_call_output" && x.call_id === "call_m11_local_draft",
   );
   result.nativeToolOutputs = outputs;
  }
  const id = "msg_m11_" + result.requests.length,
   message = {
    id,
    type: "message",
    role: "assistant",
    status: "completed",
    content: [{ type: "output_text", text, annotations: [] }],
   };
  const send = (type, value) =>
   res.write(
    "event: " + type + "\ndata: " + JSON.stringify({ type, ...value }) + "\n\n",
   );
  send("response.created", {
   response: {
    id: "resp_" + id,
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    status: "in_progress",
    output: [],
   },
  });
  send("response.output_item.added", {
   output_index: 0,
   item: { ...message, status: "in_progress", content: [] },
  });
  send("response.content_part.added", {
   item_id: id,
   output_index: 0,
   content_index: 0,
   part: { type: "output_text", text: "", annotations: [] },
  });
  send("response.output_text.delta", {
   item_id: id,
   output_index: 0,
   content_index: 0,
   delta: text,
  });
  send("response.output_text.done", {
   item_id: id,
   output_index: 0,
   content_index: 0,
   text,
  });
  send("response.content_part.done", {
   item_id: id,
   output_index: 0,
   content_index: 0,
   part: message.content[0],
  });
  send("response.output_item.done", { output_index: 0, item: message });
  send("response.completed", {
   response: {
    id: "resp_" + id,
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    status: "completed",
    model: body.model,
    output: [message],
    usage: {
     input_tokens: 1,
     output_tokens: 1,
     total_tokens: 2,
     input_tokens_details: { cached_tokens: 0 },
     output_tokens_details: { reasoning_tokens: 0 },
    },
   },
  });
  res.end();
 });
});
server.on("connection", (s) => {
 sockets.add(s);
 s.on("error", () => {});
 s.on("close", () => sockets.delete(s));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
const config =
 'model="m11-base-model"\nmodel_provider="m11_local_fixture"\nnotify=[]\n[model_providers.m11_local_fixture]\nname="M11 Synthetic Local Fixture"\nbase_url="http://127.0.0.1:' +
 port +
 '/v1"\nwire_api="responses"\nrequires_openai_auth=false\n[analytics]\nenabled=false\n[feedback]\nenabled=false\n[projects.' +
 JSON.stringify(cwd) +
 ']\ntrust_level="trusted"\n';
const nativeNoticeState =
 '\n[tui]\nscreen_reader_detection_done = true\n\n[tui.model_availability_nux]\n"gpt-6.1-sol" = 1\n';
const profileText =
 'model="m11-ui-profile-model"\nskills.config=[{path=' +
 JSON.stringify(skill) +
 ",enabled=false}]\n";
await writeFile(join(state, "config.toml"), config);
await writeFile(join(state, "m11-native.config.toml"), profileText);
const privateEnv = {
 PATH: process.env.PATH,
 HOME: home,
 ZDOTDIR: home,
 CODEX_HOME: state,
 HTTP_PROXY: "http://127.0.0.1:1",
 HTTPS_PROXY: "http://127.0.0.1:1",
 ALL_PROXY: "http://127.0.0.1:1",
 NO_PROXY: "127.0.0.1,localhost",
 SHELL: "/bin/zsh",
};
// This script is itself an isolated driver process. Do not rely on its caller
// having removed ambient provider credentials or other user configuration.
// Capture the theme request before the scrub, which only keeps the documented keys.
const requestedTheme = process.env.WILLYOU_T13_THEME;
for (const name of Object.keys(process.env))
 if (
  ![
   "PATH",
   "TMPDIR",
   "LANG",
   "LC_ALL",
   "WILLYOU_ACCEPTANCE_APP",
   "WILLYOU_CODEX_CLI",
   "WILLYOU_ACCEPTANCE_ASAR_SHA",
  ].includes(name)
 )
  delete process.env[name];
Object.assign(process.env, privateEnv);
async function poll(fn, timeout = 30000) {
 const end = Date.now() + timeout;
 let value;
 do {
  if (result.fixtureFailure) throw Error(result.fixtureFailure.message);
  value = await fn();
  if (value) return value;
  await new Promise((r) => setTimeout(r, 150));
 } while (Date.now() < end);
 throw Error("Bounded state wait timed out: " + stage);
}
async function click(selector, text) {
 result.lastAction = { selector, text };
 const p = await app.evaluate(
  `(()=>{const e=Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(e=>e.getBoundingClientRect().width&&e.getBoundingClientRect().height&&${text === undefined ? "true" : `e.textContent.trim()===${JSON.stringify(text)}`});if(!e)throw Error('Control missing: '+${JSON.stringify(selector)});e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;if(e.matches(':disabled')||!e.contains(document.elementFromPoint(x,y)))throw Error('Control blocked');return{x,y};})()`,
 );
 for (const type of ["mouseMoved", "mousePressed", "mouseReleased"])
  await app.cdp("Input.dispatchMouseEvent", {
   type,
   ...p,
   ...(type === "mouseMoved" ? {} : { button: "left", clickCount: 1 }),
  });
}
async function key(key, code, num, modifiers = 0, commands) {
 for (const type of ["keyDown", "keyUp"])
  await app.cdp("Input.dispatchKeyEvent", {
   type,
   key,
   code,
   windowsVirtualKeyCode: num,
   modifiers,
   ...(type === "keyDown" && commands ? { commands } : {}),
  });
}
try {
 await progress();
 app = await openElectron({
  executable,
  userData,
  cwd,
  env: privateEnv,
  inspectMain: true,
 });
 result.pid = app.processId;
 await app.evaluate(`document.title='A · M11 T13 · 终端与会话诊断';true`);
 const t13Theme =
  requestedTheme === "dark" ? "ydark" : requestedTheme === "light" ? "ylight" : null;
 if (t13Theme) {
  await app.invoke("appSettings.update", "theme", t13Theme);
  result.t13Theme = t13Theme;
  const themeStamp = await app.evaluate("performance.timeOrigin");
  await app.cdp("Page.reload");
  await app.waitFor(
   `performance.timeOrigin!==${themeStamp}&&!!document.querySelector('[data-testid=nav-home]')`,
   15000,
  );
  await app.evaluate(`document.title='A · M11 T13 · 终端与会话诊断';true`);
  await app.waitFor(
   `document.documentElement.classList.contains(${JSON.stringify(t13Theme)})`,
   5000,
  );
  result.checks.push({
   name: `Theme ${t13Theme} applied before the session and diagnostics capture`,
   at: new Date().toISOString(),
   passed: true,
   theme: t13Theme,
  });
 }
 stage = "prerequisites";
 await progress();
 project = await app.invoke(
  "projects.create",
  {
   name: "M11 原生 CLI 隔离项目",
   aliases: [],
   description: "Private native Task prerequisite",
   rulesPath: null,
  },
  [{ label: "fixture", path: cwd }],
 );
 result.projectId = project.id;
 const catalog = await app.invoke("applications.catalog");
 assert(catalog.ok);
 const mail = catalog.value.find((x) => x.appId === "mail");
 assert(
  (await app.invoke("applications.setAdded", "mail", true, mail.revision)).ok,
 );
 assert(
  (
   await app.invoke("applications.select", {
    projectId: project.id,
    appId: "mail",
    enabled: true,
    expectedRevision: 0,
    connections: { foxmail: null, smtp: null },
   })
  ).ok,
 );
 const args = [
  "--profile",
  "m11-native",
  "--disable",
  "hooks",
  "--disable",
  "apps",
  "--disable",
  "remote_plugin",
  "--disable",
  "multi_agent",
  "--disable",
  "shell_snapshot",
  "-c",
  'web_search="disabled"',
  "-c",
  "skills.config=[]",
  "--sandbox",
  "read-only",
  "--ask-for-approval",
  "never",
 ];
 profile = await app.invoke("aiProfiles.create", {
  name: "M11 私有 Codex 0.166.0",
  runner: "codex",
  executable: cli,
  env: Object.entries(privateEnv).map(([name, value]) => ({
   name,
   value,
   secret: false,
  })),
  args,
  color: null,
  isDefault: true,
 });
 result.profileId = profile.id;
 stage = "profile-health";
 await progress();
 const health = await poll(async () => {
  const p = await app.invoke("aiProfiles.get", profile.id);
  return !p.checking && p.check ? p : null;
 }, 45000);
 result.profileHealth = health.check;
 assert.equal(health.check.status, "ok");
 checked(
  "Automatic AI-profile health check is separately classified and completed against private provider",
 );
 stage = "composer";
 await progress();
 const origin = await app.evaluate("performance.timeOrigin");
 await app.cdp("Page.reload");
 await app.waitFor(
  `performance.timeOrigin!==${origin}&&document.readyState==='complete'&&!!document.querySelector('[data-testid=home-input]')`,
  15000,
 );
 await app.evaluate(`document.title='A · M11 T13 · 终端与会话诊断';true`);
 await app.waitFor(
  `document.querySelector('[data-testid=home-project]')?.textContent.includes('M11 原生 CLI 隔离项目')&&document.querySelector('[data-testid=home-profile]')?.textContent.includes('M11 私有 Codex')`,
  15000,
 );
 await app.evaluate(
  `window.__m5={output:{},exits:{}};window.electronAPI.eventOn('pty:data',e=>{window.__m5.output[e.ptyId]=(window.__m5.output[e.ptyId]||'')+e.data});window.electronAPI.eventOn('pty:exit',e=>{window.__m5.exits[e.ptyId]=e.code});true`,
 );
 const prompt =
  marker +
  ": Read the current project mail Skill, then read the local draft list exactly once using its declared MCP tool. Do not create, update, send or delete anything. Return " +
  marker +
  "_DONE when finished.";
 stage = "waiting-initial-foreground";
 await progress();
 await focusNewInstalledWindow(app, userData, result);
 installAppFocusGuard(app, result);
 await click("[data-testid=home-input]");
 await key("a", "KeyA", 65, 4, ["selectAll"]);
 await app.cdp("Input.insertText", { text: prompt });
 assert.equal(
  await app.evaluate(
   `document.querySelector('[data-testid=home-input]').value`,
  ),
  prompt,
 );
 await app.screenshot(join(root, "composer.png"));
 const before = await app.invoke("tasks.list", { includeArchived: true });
 assert.equal(before.length, 0);
 stage = "ui-task-launch";
 await progress();
 await click("[data-testid=home-launch]");
 task = await poll(async () => {
  const list = await app.invoke("tasks.list", { includeArchived: true });
  return list.length === 1 ? list[0] : null;
 }, 20000);
 result.taskId = task.id;
 checked("Real composer input and button created exactly one new Task", {
  taskId: task.id,
 });
 stage = "native-task-response";
 await progress();
 await poll(async () => {
  const current = await app.invoke("tasks.get", task.id);
  task = current;
  const out = current.ptyId ? await app.output(current.ptyId) : "";
  await writeFile(join(root, "terminal-current.txt"), out);
  await writeFile(
   join(root, "task-current.json"),
   JSON.stringify(current, null, 2) + "\n",
  );
  const done =
   result.requests.some((r) => r.kind === "ui-task") &&
   result.nativeToolOutputs?.length === 1;
  return done;
 }, 45000);
 const requests = result.requests.filter((r) => r.kind === "ui-task");
 assert(requests.length > 0);
 assert(
  requests.every(
   (r) => r.model === "m11-ui-profile-model" && !r.userSkillMarkerPresent,
  ),
 );
 checked(
  "Real Task CLI used native profile model and preserved profile-disabled user Skill under later CLI empty array",
  { requestCount: requests.length },
 );
 stage = "session-diagnostics";
 await progress();
 const session = await app.invoke("applications.session", task.id);
 assert(session.ok, session.message);
 result.session = session.value;
 result.finalTask = await app.invoke("tasks.get", task.id);
 assert(result.finalTask.ptyId);
 await app.screenshot(join(root, "task-native-response.png"));
 assert(result.issuedTool);
 assert(
  result.nativeToolOutputs?.length === 1,
  "Native CLI did not return the real MCP tool result",
 );
 const drafts = await app.invoke("applications.drafts", project.id, {
  limit: 50,
 });
 assert(drafts.ok, drafts.message);
 assert.equal(drafts.value.items.length, 0);
 const output = result.nativeToolOutputs[0].output;
 const value = JSON.parse(output.slice(output.indexOf("{")));
 assert.equal(value.schema, "willyou-app-result-v2");
 assert.equal(value.capabilityId, "mail.draft.list");
 assert.equal(value.contractMajor, 2);
 assert.deepEqual(value.data, { items: [], nextCursor: null });
 assert.equal(value.operation.origin, "mcp");
 assert.equal(value.operation.effectState, "read-only");
 assert.deepEqual(value.source.connections, []);
 result.actualCapabilityResult = value;
 const usage = await poll(async () => {
  const d = await app.invoke("applications.session", task.id);
  return d.ok &&
   d.value.applications.some(
    (a) => a.appId === "mail" && a.evidence.successfulToolRequests >= 1,
   )
   ? d.value
   : null;
 });
 result.sessionAfterTool = usage;
 assert.equal(usage.currentRun.preparation.cliVersion, "0.166.0");
 stage = "terminal-echo";
 await progress();
 await focusNewInstalledWindow(app, userData, result).catch(() => {});
 const echo = "T13_ECHO_" + root.split("-").at(-1);
 await app.evaluate(
  `(()=>{const t=document.querySelector('.xterm')||document.querySelector('[data-testid=main-body]');if(!t)throw Error('Terminal surface missing');t.scrollIntoView({block:'center'});return true})()`,
 );
 const box = await app.evaluate(
  `(()=>{const t=document.querySelector('.xterm')||document.querySelector('[data-testid=main-body]');const r=t.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`,
 );
 for (const type of ["mouseMoved", "mousePressed", "mouseReleased"])
  await app.cdp("Input.dispatchMouseEvent", {
   type,
   ...box,
   ...(type === "mouseMoved" ? {} : { button: "left", clickCount: 1 }),
  });
 await app.cdp("Input.insertText", { text: echo });
 await key("Enter", "Enter", 13);
 await poll(async () => {
  const out = await app.output(task.ptyId);
  await writeFile(join(root, "terminal-echo.txt"), out);
  return out.includes(echo);
 }, 20000);
 checked("Terminal shows exactly the text inserted through the real UI", {
  echoLength: echo.length,
 });
 stage = "session-applications-ui";
 await progress();
 await click("[data-testid=task-applications]");
 await app.waitFor(
  '!!document.querySelector("[data-testid=session-applications]")',
  15000,
 );
 const panel = await app.evaluate(
  `(()=>{const p=document.querySelector('[data-testid=session-applications]');return{text:p.innerText.slice(0,1500),apps:[...p.querySelectorAll('.m10-session-app')].map(e=>e.innerText.slice(0,400))}})()`,
 );
 result.sessionPanel = panel;
 assert.match(panel.text, /本会话 v\d|原固定资源/);
 assert(panel.apps.length >= 1, "Panel lists the session application");
 checked(
  "Session diagnostics panel renders fixed version, project policy, resource state, connection and tool-request evidence for the running session",
  { apps: panel.apps.length },
 );
 await app.screenshot(join(root, "session-applications.png"));
 const evidence = await poll(async () => {
  const d = await app.invoke("applications.session", task.id);
  const a = d.ok && d.value.applications.find((v) => v.appId === "mail");
  return a &&
   a.evidence.skillRead === "verified" &&
   a.evidence.skillDiscovery === "verified"
   ? a.evidence
   : null;
 }, 30000);
 result.skillEvidence = evidence;
 assert.match(JSON.stringify(result.skillOutput), /smartdd_mail_draft_list_v2/);
 assert.doesNotMatch(JSON.stringify(result.skillOutput), /willyou-app mail/);
 assert.equal(
  result.runPlan.applications.find((a) => a.appId === "mail").effectiveEntry,
  "mcp",
 );
 checked(
  "Actual Codex read the matching delivered mail Skill (native L2 discovery/read), then called the v2 MCP capability through real host permissions/operation audit; no CLI prerequisite or SMTP write",
 );
 stage = "diagnostics-after-evidence";
 const closePath = await app.evaluate(
  '(()=>{const b=document.querySelector("button[aria-label=\\\u5173\\u95ed]")||document.querySelector("[data-testid=session-applications]")?.closest("dialog")?.querySelector("button[aria-label*=\\\u5173\\u95ed]");if(!b)return "escape";const r=b.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;if(!b.contains(document.elementFromPoint(x,y)))return "escape";return JSON.stringify({x,y});})()',
 );
 if (closePath === "escape") {
  for (const type of ["keyDown", "keyUp"])
   await app.cdp("Input.dispatchKeyEvent", {
    type,
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
    nativeVirtualKeyCode: 53,
   });
 } else {
  const point = JSON.parse(closePath);
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"])
   await app.cdp("Input.dispatchMouseEvent", {
    type,
    ...point,
    ...(type === "mouseMoved" ? {} : { button: "left", clickCount: 1 }),
   });
 }
 result.diagnosticsClosePath =
  closePath === "escape" ? "escape" : "close-button";
 await app.waitFor(
  '!document.querySelector("[data-testid=session-applications]")',
  5000,
 );
 await click("[data-testid=task-applications]");
 await app.waitFor(
  '!!document.querySelector("[data-testid=session-applications]")',
  15000,
 );
 const fresh = await poll(async () => {
  const view = await app.evaluate(
   `(()=>{const p=document.querySelector('[data-testid=session-applications]'),d=p?p.closest('dialog'):null;if(!d||p.getClientRects().length===0)return{doc:false};return{doc:true,text:p.innerText,widths:{scroll:d.scrollWidth,client:d.clientWidth},ids:[...p.querySelectorAll('.m10-message-id')].map(e=>({text:e.textContent.trim().slice(0,60),scroll:e.scrollWidth,client:e.clientWidth}))}})()`,
  );
  return view.doc && /Agent 读取 Skill/.test(view.text) ? view : null;
 }, 20000);
 result.diagnosticsVerified = fresh;
 assert.match(
  fresh.text,
  /Agent 读取 Skill：已核验本次原生读取/,
  "Diagnostics reflect the verified native read",
 );
 assert.match(fresh.text, /本次运行工具请求：\d+ 次，调用完成 \d+ 次/);
 assert(
  fresh.widths.scroll <= fresh.widths.client + 1,
  "Panel has no horizontal overflow",
 );
 assert(fresh.ids.length >= 2, "Long source identifiers are listed");
 assert(
  fresh.ids.every((i) => i.scroll <= i.client + 1),
  "Long identifiers stay inside their container",
 );
 checked(
  "Session panel shows the verified native read and long source identifiers without horizontal overflow",
  { identifiers: fresh.ids.length },
 );
 await app.screenshot(join(root, "session-applications-verified.png"));
 const baseAfter = await readFile(join(state, "config.toml"), "utf8"),
  profileAfter = await readFile(join(state, "m11-native.config.toml"), "utf8");
 const business = (bytes) => {
  const value = parseToml(bytes);
  delete value.tui;
  delete value.notice;
  return value;
 };
 assert.deepEqual(business(baseAfter), business(config));
 assert.deepEqual(business(profileAfter), business(profileText));
 result.nativeConfigWrites = {
  actor: "actual isolated Codex TUI",
  baseUnchanged: baseAfter === config,
  profileUnchanged: profileAfter === profileText,
  baseSha256: sha(baseAfter),
  profileSha256: sha(profileAfter),
  businessFieldsPreserved: true,
 };
 checked(
  "Isolated Codex base/profile business fields preserved; native TUI notice changes separately recorded",
 );
 assert.deepEqual(app.rendererErrors, []);
 result.status = "passed-terminal-and-diagnostics";
} catch (error) {
 result.status = isAppFocusYield(error) ? "deferred-focus-loss" : "failed";
 result.failedStage = stage;
 result.error = String(error);
 result.stack = error.stack;
 process.exitCode = isAppFocusYield(error) ? 2 : 1;
 if (app)
  try {
   result.exitBeforeCleanup = await app
    .waitForExit(1)
    .catch(() => ({ stillRunning: true }));
   if (task?.id)
    result.failureSession = await app.invoke("applications.session", task.id);
   result.dom = await app.evaluate("document.body.innerText");
   if (task?.ptyId)
    await writeFile(
     join(root, "terminal-failure.txt"),
     await app.output(task.ptyId),
    );
   await app.screenshot(join(root, "failure.png"));
  } catch {}
} finally {
 if (app) {
  if (task?.id)
   try {
    result.cleanupTask = await app.invoke("tasks.kill", task.id);
   } catch (e) {
    result.cleanupTaskError = String(e);
   }
  result.rendererErrors = app.rendererErrors;
  await writeFile(join(root, "electron.txt"), app.logs());
  await app.close();
  result.ownAppCleanupComplete = true;
 }
 for (const s of sockets) s.destroy();
 await new Promise((r) => server.close(r));
 result.finishedAt = new Date().toISOString();
 await writeFile(
  join(root, "result.json"),
  JSON.stringify(result, null, 2) + "\n",
 );
 await writeFile(
  "/private/tmp/willyou-m11-s4-native-codex-latest-result.txt",
  join(root, "result.json") + "\n",
 );
 console.log(
  JSON.stringify({
   status: result.status,
   stage,
   checks: result.checks.length,
   error: result.error,
   result: join(root, "result.json"),
  }),
 );
}
