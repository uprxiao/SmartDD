// M11 T17: real packaged App + real Codex 0.166.0 + the real v2 ZenTao capability
// against the approved private ZenTao site. Covers the v1 -> v2 mapping entry and the
// live work_list / object_get / resource reads, including declared scope, cursor paging
// and bounded resource chunks.
//
// Prerequisites (declared, not covered here): the authenticated connection and the
// project selection are prepared through the original IPC contract with credentials the
// operator placed in a private file outside this repository. The driver never prints,
// echoes, stores or hashes the secret; it records presence and length only.
//
// The model is a loopback synthetic fixture. It chooses the exact declared tool calls
// from the real native tool list that Codex advertises; it is not real model reasoning,
// not a UI form acceptance, and it does not cover the mail half of T17.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { openElectron } from "../lib/electron-harness.mjs";
import {
 installAppFocusGuard,
 isAppFocusYield,
} from "../lib/app-focus-guard.mjs";
import { focusNewInstalledWindow } from "./fixtures/dmg-install-ui.mjs";

const requestedApp = process.env.WILLYOU_ACCEPTANCE_APP,
 cli = process.env.WILLYOU_CODEX_CLI;
assert(
 requestedApp && cli,
 "Set WILLYOU_ACCEPTANCE_APP and WILLYOU_CODEX_CLI to this private package and isolated Codex executable",
);
// Accept either the .app bundle or the Mach-O executable inside it.
const executable = requestedApp.endsWith(".app")
 ? join(
    requestedApp,
    "Contents/MacOS",
    requestedApp
     .split("/")
     .at(-1)
     .replace(/\.app$/, ""),
   )
 : requestedApp;
assert(
 existsSync(executable),
 "Acceptance executable is missing: " + executable,
);
const appRoot = resolve(dirname(executable), "../..");
assert(
 /^\/private\/tmp\//.test(appRoot),
 "Use a private copy of the App under /private/tmp",
);
assert(
 /^[a-f0-9]{64}$/.test(process.env.WILLYOU_ACCEPTANCE_ASAR_SHA ?? ""),
 "Pin the actual ASAR SHA256 before acceptance",
);

// --- private credentials: read once, before the environment scrub, never recorded ---
const defaultCred = join(homedir(), ".smartdd-zen.env");
const credPath =
 process.env.WILLYOU_ZEN_CRED ?? (existsSync(defaultCred) ? defaultCred : null);
const parseCred = (text) => {
 const out = {};
 for (const line of text.split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const at = trimmed.indexOf("=");
  if (at <= 0) continue;
  out[trimmed.slice(0, at).trim()] = trimmed
   .slice(at + 1)
   .trim()
   .replace(/^["']|["']$/g, "");
 }
 return out;
};
let cred = {};
if (credPath) {
 assert(existsSync(credPath), "WILLYOU_ZEN_CRED points at a missing file");
 cred = parseCred(await readFile(credPath, "utf8"));
}
const account =
 process.env.WILLYOU_ZEN_USER ??
 cred.ZENTAO_USER ??
 cred.WILLYOU_ZEN_USER ??
 cred.USERNAME;
const secret =
 process.env.WILLYOU_ZEN_SECRET ??
 cred.ZENTAO_SECRET ??
 cred.WILLYOU_ZEN_SECRET ??
 cred.PASSWORD;
assert(
 account && secret,
 "Provide the real ZenTao account and credential outside the repository: ~/.smartdd-zen.env with ZENTAO_USER=/ZENTAO_SECRET=, or WILLYOU_ZEN_USER/WILLYOU_ZEN_SECRET (or WILLYOU_ZEN_CRED=<file>)",
);
const baseUrl = (
 process.env.WILLYOU_ZEN_BASE ?? "http://192.168.106.185/biz/"
).replace(/\/?$/, "/");
const siteHost = (() => {
 try {
  return new URL(baseUrl).hostname;
 } catch {
  throw new Error("WILLYOU_ZEN_BASE is not a valid absolute URL: " + baseUrl);
 }
})();
const connectionName = process.env.WILLYOU_ZEN_CONNECTION ?? "M11 T17 本人只读";
const projectName = "M11 T17 禅道 v2 隔离项目";
const scopeTarget = "79967";
const scopeNegative = ["79303", "79489"];

const root = await mkdtemp("/private/tmp/willyou-m11-t17-zentao-");
const home = join(root, "home"),
 state = join(root, "codex"),
 cwd = join(root, "project"),
 userData = join(root, "userdata");
const sha = (b) => createHash("sha256").update(b).digest("hex");
const marker = "M11_T17_ZENTAO_" + root.split("-").at(-1);
const result = {
 schema: "m11-t17-zentao-v2-v1",
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
 baseUrl,
 account,
 scopeTarget,
 scopeNegative,
 kindCovered: ["bug"],
 credential: {
  source: credPath ? "private-file" : "environment",
  secretPresent: true,
  secretLength: secret.length,
  secretRecorded: false,
 },
 layer:
  "A: real packaged App + real Codex 0.166.0 + real v2 ZenTao MCP capability against the approved private site, read-only; model response is a private synthetic fixture that selects the declared calls; connection test/save and project selection are IPC prerequisites",
 isolation: {
  minimalDriverEnv: true,
  freshHome: true,
  freshCodexHome: true,
  freshUserData: true,
  noDailyCredentialsCopied: true,
  proxy:
   "unreachable loopback except localhost; direct route to the approved site",
  secretHandling: "read once before the scrub, never printed or persisted",
 },
 marker,
 requests: [],
 calls: [],
 checks: [],
 status: "running",
 formalCasePassesAdded: 0,
};
assert.equal(result.asarSha256, process.env.WILLYOU_ACCEPTANCE_ASAR_SHA);
result.cli = {
 path: cli,
 version: execFileSync(cli, ["--version"], { encoding: "utf8" }).trim(),
 entrySha256: sha(await readFile(cli)),
};
assert.equal(result.cli.version, "codex-cli 0.166.0");

for (const p of [home, state, cwd, join(cwd, ".git")])
 await mkdir(p, { recursive: true });

let stage = "setup",
 app,
 task,
 project,
 profile,
 connection;
const sockets = new Set();
const progress = async () => {
 const value = {
  at: new Date().toISOString(),
  stage,
  root,
  pid: app?.processId,
  taskId: task?.id,
  calls: result.calls.length,
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
const unwrap = (reply) => {
 assert(
  reply?.ok,
  "Original operation failed: " + (reply?.code ?? reply?.message),
 );
 return reply.value;
};
// The packaged registry loads and verifies its fixed bundles asynchronously, so an
// early call can legitimately answer CAPABILITY_UNAVAILABLE. Wait for a bounded window
// instead of treating the first answer as a product failure.
const invokeSettled = async (channel, ...args) => {
 const end = Date.now() + 120000;
 let reply;
 for (;;) {
  reply = await app.invoke(channel, ...args);
  if (reply?.ok) return reply;
  if (
   !["CAPABILITY_UNAVAILABLE", "RESOURCE_RECOVERY_REQUIRED"].includes(
    reply?.code,
   )
  )
   return reply;
  if (Date.now() > end)
   throw new Error(
    channel + " stayed unavailable (" + reply.code + ") for 120s",
   );
  await new Promise((r) => setTimeout(r, 250));
 }
};

const CAPABILITY = {
 work_list: "zentao.object.list",
 object_get: "zentao.object.get",
 resource: "zentao.resource.read",
};
const LEGACY_TOOLS = [
 "smartdd_zentao_work_list_v1",
 "smartdd_zentao_object_get_v1",
 "smartdd_zentao_resource_v1",
];
const CLI = "willyou-app zentao";
const shellQuote = (text) => "'" + text.replace(/'/g, `'"'"'`) + "'";
const cliJson = (path, params) =>
 CLI + " " + path + " --json " + shellQuote(JSON.stringify(params));

const issued = [];
const envelopes = new Map();
const textOf = (output) => {
 if (typeof output === "string") return output;
 if (Array.isArray(output))
  return output
   .map((v) => (typeof v === "string" ? v : (v?.text ?? "")))
   .join("");
 if (output && typeof output === "object")
  return output.text ?? JSON.stringify(output);
 return "";
};
const envelopeOf = (text) => {
 const at = text.indexOf("{");
 try {
  return JSON.parse(text.slice(Math.max(0, at)));
 } catch {
  return { schema: "unparsable", rawHead: text.slice(0, 200) };
 }
};
const isError = (value) =>
 value?.schema === "willyou-app-error" || value?.error;
const nextStep = () => {
 const last = issued.at(-1);
 if (!last)
  return {
   command: "willyou-app --list",
   capability: "capabilities/list",
   note: "capability-list",
  };
 const at = envelopes.get(last.callId);
 if (issued.length === 1)
  return {
   command: CLI + " object list --kind bug --limit 2",
   capability: CAPABILITY.work_list,
   note: "page1",
  };
 if (issued.length === 2) {
  const cursor = at?.data?.nextCursor ?? null;
  return {
   command: cursor
    ? cliJson("object list", { kind: "bug", limit: 2, cursor })
    : null,
   capability: CAPABILITY.work_list,
   note: cursor ? "page2" : "page2-no-cursor",
  };
 }
 if (issued.length === 3)
  return {
   command: cliJson("object list", { kind: "bug", limit: 200 }),
   capability: CAPABILITY.work_list,
   note: "full-scope",
  };
 if (issued.length === 4) {
  const items = at?.data?.items ?? [];
  const target = items.find((i) => i.id === scopeTarget) ?? items[0];
  return {
   command: target
    ? cliJson("object get", { kind: "bug", reference: target.reference })
    : null,
   capability: CAPABILITY.object_get,
   note: "object " + (target?.id ?? "none"),
  };
 }
 if (issued.length === 5) {
  if (!at?.data?.body) {
   result.bodyMissing = true;
   return null;
  }
  return {
   command: cliJson("resource read", {
    resource: at.data.body,
    offset: 0,
    length: 4096,
   }),
   capability: CAPABILITY.resource,
   note: "resource-offset-0",
   resource: at.data.body,
  };
 }
 if (issued.length >= 6) {
  const data = at?.data;
  if (!data || data.eof || data.nextOffset === null || issued.length >= 8)
   return null;
  return {
   command: cliJson("resource read", {
    resource: last.resource,
    offset: data.nextOffset,
    length: 4096,
   }),
   capability: CAPABILITY.resource,
   note: "resource-offset-" + data.nextOffset,
   resource: last.resource,
  };
 }
 return null;
};

const server = createServer((incoming, res) => {
 let chunks = [],
  bytes = 0;
 incoming.on("data", (b) => {
  bytes += b.length;
  if (bytes > 8 * 1024 * 1024) incoming.destroy();
  else chunks.push(b);
 });
 incoming.on("end", async () => {
  if (!incoming.url?.endsWith("/responses")) {
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
  const raw = JSON.stringify(body);
  const taskRequest = raw.includes(marker);
  // The profile health probe runs a real Codex exec asking for an exact connectivity code.
  const probeCode =
   /Reply with exactly ([A-Za-z0-9_-]+)/.exec(raw)?.[1] ?? null;
  const tools = (body.tools ?? []).flatMap((t) =>
   t.type === "namespace"
    ? (t.tools ?? []).map((v) => ({ ...v, namespace: t.name }))
    : [t],
  );
  const zentaoTools = tools.filter((t) =>
   (t.name ?? "").startsWith("smartdd_zentao_"),
  );
  if (zentaoTools.length)
   writeFile(
    join(root, "native-tool-definitions.json"),
    JSON.stringify(zentaoTools, null, 2) + "\n",
   ).catch(() => {});
  result.requests.push({
   at: new Date().toISOString(),
   kind: taskRequest ? "agent-task" : "fixture",
   model: body.model,
   requestBytes: bytes,
   sha256: sha(raw),
   toolNames: tools.map((t) => t.name ?? t.type),
   zentaoToolNames: zentaoTools.map((t) => t.name),
  });
  // Absorb the real tool output for every call this fixture issued.
  for (const item of body.input ?? []) {
   if (item.type !== "function_call_output") continue;
   const known = issued.find((c) => c.callId === item.call_id);
   if (!known || envelopes.has(item.call_id)) continue;
   const text = textOf(item.output);
   const value = envelopeOf(text);
   envelopes.set(item.call_id, value);
   known.text = text.slice(0, 4000);
   known.outputSha256 = sha(text);
   known.outputLength = text.length;
   known.envelope = isError(value) ? value : undefined;
   known.capabilityId = value?.capabilityId ?? null;
  }
  const send = (type, value) =>
   res.write(
    "event: " + type + "\ndata: " + JSON.stringify({ type, ...value }) + "\n\n",
   );
  const respondText = (text) => {
   const id = "msg_m11_t17_" + result.requests.length,
    message = {
     id,
     type: "message",
     role: "assistant",
     status: "completed",
     content: [{ type: "output_text", text, annotations: [] }],
    };
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
  };
  if (!taskRequest) {
   respondText(probeCode ?? "M11_T17_FIXTURE_OK");
   return;
  }
  let step;
  try {
   step = nextStep();
  } catch (error) {
   result.fixtureFailure = { code: "STEP_SELECTION", message: String(error) };
   respondText(marker + "_FIXTURE_FAILED");
   return;
  }
  if (!step) {
   result.fixtureComplete = true;
   respondText(marker + "_DONE");
   return;
  }
  const shell = tools.find((t) => t.name === "exec_command");
  if (!shell) {
   result.fixtureFailure = {
    code: "TOOL_MISSING",
    message: "Native request is missing the exec_command shell tool",
   };
   respondText(marker + "_FIXTURE_FAILED");
   return;
  }
  const callId = "call_m11_t17_" + issued.length;
  const call = {
   type: "function_call",
   id: "fc_m11_t17_" + issued.length,
   call_id: callId,
   name: "exec_command",
   arguments: JSON.stringify({
    cmd: step.command,
    max_output_tokens: 12000,
   }),
   status: "completed",
  };
  issued.push({
   callId,
   command: step.command,
   capability: step.capability,
   note: step.note,
   resource: step.resource,
   at: new Date().toISOString(),
  });
  result.calls = issued.map((c) => ({
   callId: c.callId,
   command: c.command,
   capability: c.capability,
   note: c.note,
   at: c.at,
   capabilityId: c.capabilityId ?? null,
   outputLength: c.outputLength ?? null,
   outputSha256: c.outputSha256 ?? null,
   failure: c.envelope ?? null,
  }));
  send("response.created", {
   response: {
    id: "resp_m11_t17_" + issued.length,
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
    id: "resp_m11_t17_" + issued.length,
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    status: "completed",
    model: body.model,
    output: [call],
    usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
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
await writeFile(join(state, "config.toml"), config);

const privateEnv = {
 PATH: process.env.PATH,
 // safeStorage resolves the login keychain through the real home; app data, Codex state
 // and the project stay isolated through userData/CODEX_HOME and the private cwd.
 HOME: homedir(),
 ZDOTDIR: home,
 CODEX_HOME: state,
 CLAUDE_CONFIG_DIR: join(home, ".claude"),
 HTTP_PROXY: "",
 HTTPS_PROXY: "",
 ALL_PROXY: "",
 // Every backend this run needs stays on the direct route.
 NO_PROXY: ["127.0.0.1", "localhost", siteHost].join(","),
 SHELL: "/bin/zsh",
};
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
  if (result.fixtureFailure) throw new Error(result.fixtureFailure.message);
  value = await fn();
  if (value) return value;
  await new Promise((r) => setTimeout(r, 150));
 } while (Date.now() < end);
 throw new Error("Bounded state wait timed out: " + stage);
}
async function click(selector, text) {
 const point = await app.evaluate(
  `(()=>{const e=Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(e=>e.getBoundingClientRect().width&&e.getBoundingClientRect().height&&${text === undefined ? "true" : `e.textContent.trim()===${JSON.stringify(text)}`});if(!e)throw Error('Control missing: '+${JSON.stringify(selector)});e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;if(e.matches(':disabled')||!e.contains(document.elementFromPoint(x,y)))throw Error('Control blocked');return{x,y};})()`,
 );
 for (const type of ["mouseMoved", "mousePressed", "mouseReleased"])
  await app.cdp("Input.dispatchMouseEvent", {
   type,
   ...point,
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
async function readRunPlan() {
 return poll(
  async () =>
   app.mainEvaluate(
    `(()=>{const req=process.getBuiltinModule('module').createRequire(process.resourcesPath+'/app.asar/package.json');const DB=req('better-sqlite3'),db=new DB(${JSON.stringify(join(userData, "smartdd.db"))},{readonly:true});try{const row=db.prepare("SELECT plan_json FROM capability_resource_operations WHERE kind='application-run-plan' ORDER BY created_at DESC LIMIT 1").get();return row?JSON.parse(row.plan_json):null}finally{db.close()}})()`,
   ),
  15000,
 );
}

async function packageState(appId) {
 return app.mainEvaluate(
  `(()=>{const req=process.getBuiltinModule('module').createRequire(process.resourcesPath+'/app.asar/package.json');const DB=req('better-sqlite3'),db=new DB(${JSON.stringify(join(userData, "smartdd.db"))},{readonly:true});try{const row=db.prepare("SELECT state FROM capability_resources WHERE kind='application-package' AND relative_path LIKE ? ORDER BY generation DESC LIMIT 1").get(${JSON.stringify(appId + "/%")});return row?row.state:null}finally{db.close()}})()`,
 );
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
 await app.evaluate(`document.title='A · M11 T17 · 禅道 v2 真实读取';true`);

 stage = "prerequisites";
 await progress();
 project = await app.invoke(
  "projects.create",
  {
   name: projectName,
   aliases: [],
   description: "M11 T17 private real-ZenTao read-only prerequisite",
   rulesPath: null,
  },
  [{ label: "isolated", path: cwd }],
 );
 result.projectId = project.id;
 const catalog = unwrap(await invokeSettled("applications.catalog"));
 const zentao = catalog.find((x) => x.appId === "zentao");
 assert(zentao, "Catalog does not list the ZenTao application");
 unwrap(
  await invokeSettled("applications.setAdded", "zentao", true, zentao.revision),
 );
 const candidate = unwrap(
  await invokeSettled("applications.testConnection", {
   name: connectionName,
   expectedRevision: 0,
   config: { kind: "zentao", baseUrl, username: account, authMode: "password" },
   secret,
  }),
 );
 result.connectionTest = {
  ok: true,
  identity: candidate.identity,
  impacts: candidate.compatibility.impacts.length,
  expiresAt: candidate.expiresAt,
 };
 unwrap(
  await invokeSettled(
   "applications.saveConnection",
   "zentao",
   candidate.operationId,
   candidate.candidateHash,
   candidate.compatibility.impacts.length
    ? candidate.compatibility.planHash
    : undefined,
  ),
 );
 connection = unwrap(
  await invokeSettled("applications.connections", "zentao"),
 ).find((c) => c.id === candidate.connectionId);
 assert(connection?.hasSecret, "Saved connection has no credential");
 assert.equal(connection.authorization, "connected");
 result.connection = {
  id: connection.id,
  availability: connection.authorization,
  config: connection.config,
  identityRevision: connection.identityRevision,
  hasSecret: connection.hasSecret,
  testedAt: connection.testedAt,
 };
 checked(
  "Real ZenTao connection tested and saved through the original IPC contract with the operator-provided private credential",
  {
   identity: candidate.identity.providerId,
   impacts: candidate.compatibility.impacts.length,
  },
 );
 unwrap(
  await invokeSettled("applications.select", {
   projectId: project.id,
   appId: "zentao",
   enabled: true,
   expectedRevision: 0,
   connections: { zentao: connection.id },
  }),
 );
 const selection = unwrap(
  await invokeSettled("applications.projectSettings", project.id, "zentao"),
 );
 assert(selection.enabled);
 assert.equal(selection.connections.zentao, connection.id);
 checked(
  "Project selection enables only this project and this saved connection",
 );

 stage = "application-package";
 await progress();
 result.applicationPackageState = await poll(async () => {
  const state = await packageState("zentao");
  return state === "ready" ? state : null;
 }, 60000);
 checked(
  "The ZenTao package finished verification before the session was created",
  {
   state: result.applicationPackageState,
  },
 );

 const args = [
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
  name: "M11 T17 私有 Codex 0.166.0",
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
 assert.equal(health.check.status, "ok");

 stage = "composer";
 await progress();
 const origin = await app.evaluate("performance.timeOrigin");
 await app.cdp("Page.reload");
 await app.waitFor(
  `performance.timeOrigin!==${origin}&&document.readyState==='complete'&&!!document.querySelector('[data-testid=home-input]')`,
  15000,
 );
 await app.evaluate(`document.title='A · M11 T17 · 禅道 v2 真实读取';true`);
 // The page collectors do not survive a reload; re-arm before driving the terminal.
 await app.arm();
 await app.waitFor(
  `document.querySelector('[data-testid=home-project]')?.textContent.includes(${JSON.stringify(projectName)})&&document.querySelector('[data-testid=home-profile]')?.textContent.includes('M11 T17 私有 Codex')`,
  15000,
 );
 const prompt =
  marker +
  "：用本项目的禅道能力列出我被指派的 Bug（先按每页两条分页，再取完整列表），打开其中一条的详情并读取正文首个分块。全程只读，返回 " +
  marker +
  "_DONE。";
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
 assert.equal(
  (await app.invoke("tasks.list", { includeArchived: true })).length,
  0,
 );
 stage = "ui-task-launch";
 await progress();
 await click("[data-testid=home-launch]");
 task = await poll(async () => {
  const list = await app.invoke("tasks.list", { includeArchived: true });
  return list.length === 1 ? list[0] : null;
 }, 20000);
 result.taskId = task.id;
 checked("Real composer input and launch button created exactly one Task", {
  taskId: task.id,
 });
 stage = "launch-plan";
 await progress();
 const launchPlan = await readRunPlan();
 const snapshotPackages = await app.mainEvaluate(
  `(()=>{const req=process.getBuiltinModule('module').createRequire(process.resourcesPath+'/app.asar/package.json');const DB=req('better-sqlite3'),db=new DB(${JSON.stringify(join(userData, "smartdd.db"))},{readonly:true});try{const row=db.prepare("SELECT json_array_length(json_extract(snapshot_json,'$.packages')) AS n FROM capability_session_snapshots WHERE snapshot_hash=?").get(${JSON.stringify(launchPlan.snapshotHash)});return row?row.n:null}finally{db.close()}})()`,
 );
 result.launchPlan = {
  snapshotHash: launchPlan.snapshotHash,
  applications: launchPlan.applications,
  allowed: launchPlan.allowed,
  grades: launchPlan.grades,
  snapshotPackages,
 };
 assert(
  launchPlan.applications.length > 0,
  "The run plan dropped the selected ZenTao application: " +
   JSON.stringify({ applications: launchPlan.applications, grades: launchPlan.grades, snapshotPackages }),
 );

 stage = "native-task-response";
 await progress();
 await poll(async () => {
  const current = await app.invoke("tasks.get", task.id);
  task = current;
  const text = current.ptyId ? await app.output(current.ptyId) : "";
  await writeFile(join(root, "terminal-current.txt"), text);
  return (
   issued.length >= 4 &&
   result.fixtureComplete === true &&
   issued.every((c) => envelopes.has(c.callId))
  );
 }, 180000);
 result.finalTask = await app.invoke("tasks.get", task.id);
 result.nativeTools = result.requests.at(-1)?.toolNames ?? [];
 await app.screenshot(join(root, "task-native-response.png"));

 stage = "assertions";
 await progress();
 const defs = result.nativeTools;
 assert(defs.includes("exec_command"), "The native session has no shell tool");
 assert(
  !defs.some((n) => LEGACY_TOOLS.includes(n)),
  "The native session still advertises a v1 tool",
 );
 const capabilitySurface = issued[0]?.text ?? "";
 for (const id of Object.values(CAPABILITY))
  assert(
   capabilitySurface.includes(id),
   "The session capability surface is missing " + id,
  );
 for (const name of LEGACY_TOOLS)
  assert(
   !capabilitySurface.includes(name),
   "A legacy v1 tool is still advertised: " + name,
  );
 checked(
  "Every v1 ZenTao capability maps to an exposed v2 capability with no legacy tool left",
  {
   capabilities: Object.values(CAPABILITY),
   nativeTools: defs,
  },
 );

 const values = new Map([...envelopes].map(([id, v]) => [id, v]));
 const byCapability = (name) =>
  issued
   .filter((c) => c.capability === name)
   .map((c) => ({ call: c, value: values.get(c.callId) }));
 for (const each of byCapability(CAPABILITY.work_list).concat(
  byCapability(CAPABILITY.object_get),
  byCapability(CAPABILITY.resource),
 )) {
  assert(
   !isError(each.value),
   "Capability returned an error: " + JSON.stringify(each.value).slice(0, 400),
  );
  assert.equal(each.value.schema, "willyou-app-result-v2");
  assert.equal(each.value.contractMajor, 2);
  assert.equal(each.value.operation.origin, "cli");
  assert.equal(each.value.operation.effectState, "read-only");
  assert.equal(each.value.capabilityId, each.call.capability);
 }
 checked(
  "All live reads returned the unified v2 envelope through the real CLI origin",
  {
   calls: issued.length,
  },
 );

 const [page1, page2, full] = byCapability(CAPABILITY.work_list).map(
  (x) => x.value.data,
 );
 assert(page1, "First work_list page missing");
 assert(page1.items.length > 0, "First work_list page is empty");
 assert(page1.items.length <= 2);
 assert(full, "Full work_list read missing");
 if (full.total !== null && full.total <= 200)
  assert.equal(
   full.complete,
   true,
   "Full read is not complete although the declared limit covers every row",
  );
 assert(full.items.length > 0);
 assert(full.total === null || full.total >= full.items.length);
 const ids = full.items.map((i) => i.id);
 assert(
  ids.includes(scopeTarget),
  "Assigned target bug " + scopeTarget + " is missing",
 );
 for (const negative of scopeNegative)
  assert(
   !ids.includes(negative),
   "Out-of-scope bug " + negative + " leaked into the new entry",
  );
 assert(
  full.items.every(
   (i) => typeof i.assignedTo === "string" && i.assignedTo.length > 0,
  ),
  "Full work_list read returned an item without an assignee",
 );
 result.workList = {
  page1: {
   ids: page1.items.map((i) => i.id),
   nextCursor: !!page1.nextCursor,
   total: page1.total,
  },
  page2: page2
   ? { ids: page2.items.map((i) => i.id), nextCursor: !!page2.nextCursor }
   : null,
  full: {
   ids,
   total: full.total,
   complete: full.complete,
   problems: full.problems,
   assignees: [...new Set(full.items.map((i) => i.assignedTo))],
   checkedAt: full.checkedAt,
  },
 };
 if (page2) {
  assert(
   page2.items.length <= 2,
   "Cursor page did not honour the requested limit",
  );
  const overlap = page2.items
   .map((i) => i.id)
   .filter((id) => page1.items.some((p) => p.id === id));
  assert.equal(overlap.length, 0, "Cursor page repeated page one items");
 } else {
  assert.equal(
   issued[1].note,
   "page2-no-cursor",
   "Paging was skipped for an unexpected reason",
  );
 }
 checked("Cursor paging honours the page limit and does not repeat rows", {
  page1: page1.items.length,
  page2: page2 ? page2.items.length : 0,
 });

 const object = byCapability(CAPABILITY.object_get)[0].value.data;
 assert.equal(object.kind, "bug");
 assert.equal(object.id, scopeTarget);
 assert.equal(object.complete, true);
 assert(Array.isArray(object.missing));
 assert.equal(object.fields?.id, scopeTarget);
 assert.equal(object.fields?.status, "active");
 assert(
  object.fields?.product !== undefined && object.fields?.project !== undefined,
 );
 assert(
  object.body && typeof object.body.size === "number" && object.body.size > 0,
 );
 assert(Array.isArray(object.attachments));
 result.objectRead = {
  id: object.id,
  complete: object.complete,
  missing: object.missing,
  fieldKeys: Object.keys(object.fields ?? {}),
  fieldsSha256: sha(JSON.stringify(object.fields)),
  body: object.body,
  attachments: object.attachments.map((a) => ({
   filename: a.filename,
   size: a.resource?.size,
  })),
  reference: object.reference,
 };
 checked(
  "Object detail matches the recorded M10 baseline for the same assigned bug",
  {
   id: object.id,
   attachments: object.attachments.length,
   bodySize: object.body.size,
  },
 );

 const chunks = byCapability(CAPABILITY.resource).map((x) => x.value.data);
 assert(
  !result.bodyMissing,
  "object_get returned no readable body although the recorded baseline bug carries a steps field",
 );
 assert(chunks.length >= 1);
 let stitched = "";
 for (const [index, chunk] of chunks.entries()) {
  assert.equal(chunk.encoding, "utf8");
  assert(chunk.length > 0 && chunk.length <= 4096);
  assert.equal(Buffer.byteLength(chunk.data, "utf8"), chunk.length);
  assert.equal(chunk.resourceId, object.body.id);
  assert.equal(chunk.revision, object.body.revision);
  assert.equal(chunk.offset, index === 0 ? 0 : chunks[index - 1].nextOffset);
  if (!chunk.eof) assert.equal(chunk.nextOffset, chunk.offset + chunk.length);
  stitched += chunk.data;
 }
 const lastChunk = chunks.at(-1);
 if (lastChunk.eof) assert.equal(lastChunk.nextOffset, null);
 const stitchedBytes = Buffer.byteLength(stitched, "utf8");
 assert(stitched.length > 0);
 if (lastChunk.eof)
  assert.equal(
   stitchedBytes,
   object.body.size,
   "Bounded reads do not reconstruct the whole resource",
  );
 result.resourceRead = {
  chunks: chunks.map((c) => ({
   offset: c.offset,
   length: c.length,
   eof: c.eof,
   nextOffset: c.nextOffset,
  })),
  stitchedBytes,
  stitchedSha256: sha(stitched),
  declaredSize: object.body.size,
  head: stitched.slice(0, 120),
 };
 checked(
  "Bounded resource chunks keep offset/length/eof arithmetic and reconstruct the declared resource",
  {
   chunks: chunks.length,
   stitchedBytes,
   declaredSize: object.body.size,
  },
 );

 result.runPlan = await readRunPlan();
 assert.equal(
  result.runPlan.applications.find((a) => a.appId === "zentao").effectiveEntry,
  "cli",
 );
 const session = await app.invoke("applications.session", task.id);
 assert(session.ok, session.message);
 const zentaoEvidence = session.value.applications.find(
  (a) => a.appId === "zentao",
 );
 assert(
  zentaoEvidence,
  "Session diagnostics do not list the ZenTao application",
 );
 assert(
  zentaoEvidence.evidence.successfulToolRequests >= 3,
  "Host operation audit did not record the live reads",
 );
 result.sessionEvidence = {
  effectiveEntry: zentaoEvidence.effectiveEntry,
  successfulToolRequests: zentaoEvidence.evidence.successfulToolRequests,
  failedToolRequests: zentaoEvidence.evidence.failedToolRequests ?? 0,
 };
 checked(
  "Host operation audit and run plan record the live reads as MCP read-only",
  {
   successful: zentaoEvidence.evidence.successfulToolRequests,
  },
 );
 assert.deepEqual(app.rendererErrors, []);
 result.status = "passed-real-zentao-v2-reads";
} catch (error) {
 result.status = isAppFocusYield(error) ? "deferred-focus-loss" : "failed";
 result.failedStage = stage;
 result.error = String(error);
 result.stack = error.stack?.split("\n").slice(0, 12).join("\n");
 process.exitCode = isAppFocusYield(error) ? 2 : 1;
 if (app)
  try {
   if (task?.id)
    result.failureSession = await app.invoke("applications.session", task.id);
   if (task?.ptyId)
    await writeFile(
     join(root, "terminal-failure.txt"),
     await app.output(task.ptyId),
    );
   result.dom = await app.evaluate("document.body.innerText").catch(() => null);
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
 console.log(
  JSON.stringify({
   status: result.status,
   stage,
   checks: result.checks.length,
   calls: issued.length,
   error: result.error,
   result: join(root, "result.json"),
  }),
 );
}
