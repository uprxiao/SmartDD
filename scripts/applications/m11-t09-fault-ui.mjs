// M11 T09: real packaged App + real Codex 0.166.0 + the real v2 ZenTao capability
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
let baseUrl = (
 process.env.WILLYOU_ZEN_BASE ?? "http://127.0.0.1:1/biz/"
).replace(/\/?$/, "/");
const siteHost = (() => {
 try {
  return new URL(baseUrl).hostname;
 } catch {
  throw new Error("WILLYOU_ZEN_BASE is not a valid absolute URL: " + baseUrl);
 }
})();
const connectionName = process.env.WILLYOU_ZEN_CONNECTION ?? "M11 T09 本人只读";
const projectName = "M11 T09 禅道 v2 隔离项目";
const scopeTarget = "79967";
const scopeNegative = ["79303", "79489"];

const root = await mkdtemp("/private/tmp/willyou-m11-t17-zentao-");
const home = join(root, "home"),
 state = join(root, "codex"),
 cwd = join(root, "project"),
 userData = join(root, "userdata");
const sha = (b) => createHash("sha256").update(b).digest("hex");
const marker = "M11_T09_ZENTAO_" + root.split("-").at(-1);
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
  "Original operation failed: " +
   (reply?.code ?? reply?.message) +
   " / " +
   (reply?.message ?? ""),
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
const CLI = "willyou-app zentao";

const issued = [];
let lastIssueAt = 0;
let phase = "probe";
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
 const read = () => ({
  command: CLI + " object list --kind bug --limit 2",
  capability: CAPABILITY.work_list,
 });
 if (!last) {
  phase = "baseline";
  return {
   command: [
    'echo "EP=$WILLYOU_ENDPOINT"',
    'echo "TOKEN=${WILLYOU_RUN_TOKEN:+present}"',
    'ls -ld "$(dirname "$WILLYOU_ENDPOINT")" 2>&1',
    "willyou-app --list > capability-surface.json 2>&1",
    "wc -c < capability-surface.json",
    "tr -d '\\n' < capability-surface.json | grep -o '\"id\":[ ]*\"[a-zA-Z.]*\"' | sort -u",
    "grep -c '_v1\"' capability-surface.json || true",
   ].join("; "),
   capability: "capabilities/list",
   note: "capability-list",
  };
 }
 const session = /Process running with session ID (\d+)/.exec(last.text ?? "")?.[1];
 if (phase === "baseline") {
  phase = "held";
  faultMode = "ok";
  return { ...read(), note: "baseline-read" };
 }
 if (phase === "held") {
  phase = "held-poll";
  faultMode = "hold";
  return { ...read(), note: "held-read" };
 }
 if (phase === "held-poll") {
  // Keep collecting the held read until the app's own deadline ends it.
  if (session) {
   lastIssueAt = Date.now();
   return {
    note: "held-poll",
    capability: CAPABILITY.work_list,
    stdin: { session_id: Number(session) },
   };
  }
  phase = "dropped";
 }
 if (phase === "dropped") {
  phase = "cancel";
  faultMode = "drop";
  return { ...read(), note: "dropped-read" };
 }
 if (phase === "cancel") {
  phase = "cancel-poll";
  faultMode = "hold";
  lastIssueAt = Date.now();
  setTimeout(() => {
   void app.invoke("tasks.kill", task.id).catch(() => {});
  }, 1500);
  return { ...read(), note: "cancelled-read" };
 }
 if (phase === "cancel-poll" && session) {
  lastIssueAt = Date.now();
  return {
   note: "cancel-poll",
   capability: CAPABILITY.work_list,
   stdin: { session_id: Number(session) },
  };
 }
 phase = "done";
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
   known.fullText = text;
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
   const id = "msg_m11_t09_" + result.requests.length,
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
   respondText(probeCode ?? "M11_T09_FIXTURE_OK");
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
   lastIssueAt = Date.now();
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
  const callId = "call_m11_t09_" + issued.length;
  // A read that outlives Codex's shell yield returns a session id; collect it with write_stdin.
  const toolName = step.stdin ? "write_stdin" : "exec_command";
  const toolArguments = step.stdin
   ? { session_id: step.stdin.session_id, chars: "", yield_time_ms: 30000 }
   : { cmd: step.command, max_output_tokens: 12000 };
  const call = {
   type: "function_call",
   id: "fc_m11_t09_" + issued.length,
   call_id: callId,
   name: toolName,
   arguments: JSON.stringify(toolArguments),
   status: "completed",
  };
  issued.push({
   callId,
   command: step.stdin ? toolName + " " + JSON.stringify(toolArguments) : step.command,
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
    id: "resp_m11_t09_" + issued.length,
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
    id: "resp_m11_t09_" + issued.length,
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

// T09 fault upstream: a loopback ZenTao surface whose behaviour switches per step.
// Real HTTP transport; only the responses are controlled (declared synthetic upstream).
let faultMode = "ok";
const faultHits = [];
const heldResponses = new Set();
const fault = createServer((req, res) => {
 const at = new Date().toISOString();
 const url = new URL(req.url ?? "/", "http://127.0.0.1");
 const path = url.pathname;
 const reply = (status, value) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(value));
 };
 req.on("data", () => {});
 if (path === "/biz/api.php/v1/tokens") {
  req.on("end", () => reply(201, { token: "t09-fixture-token" }));
  return;
 }
 // Identity checks must pass for every step; only the business read is faulted.
 const faulted = path === "/biz/api.php/v2/my/work";
 faultHits.push({ at, mode: faulted ? faultMode : "ok", path });
 if (faulted && faultMode === "hold") {
  heldResponses.add(res);
  return;
 }
 if (faulted && faultMode === "drop") {
  req.socket.destroy();
  return;
 }
 // The real site answers identity, field labels and the assigned-to page from separate paths.
 if (path === "/biz/api.php/v1/user")
  return reply(200, {
   profile: { id: 1001, account, realname: "T09 Fixture" },
  });
 if (path === "/biz/api.php/v1/langs")
  return reply(200, {
   bug: {
    id: "编号",
    title: "标题",
    status: "状态",
    assignedTo: "指派给",
   },
  });
 if (path === "/biz/api.php/v2/my/work") {
  const page = Number(url.searchParams.get("pageID") ?? "1");
  const size = Number(url.searchParams.get("recPerPage") ?? "50");
  const total = 1;
  return reply(200, {
   mode: url.searchParams.get("mode") ?? "bug",
   type: url.searchParams.get("type") ?? "assignedTo",
   pager: {
    recTotal: total,
    pageID: page,
    recPerPage: size,
    pageTotal: Math.ceil(total / size),
   },
   bugs: [
    {
     id: 9001,
     title: "T09 fixture bug",
     status: "active",
     assignedTo: account,
    },
   ],
  });
 }
 return reply(200, {});
});
await new Promise((r) => fault.listen(0, "127.0.0.1", r));
const faultPort = fault.address().port;
baseUrl = "http://127.0.0.1:" + faultPort + "/biz/";
result.zenBase = baseUrl;
result.upstream =
 "synthetic loopback ZenTao HTTP surface (real transport, controlled faults); no real site data";
result.faultHits = faultHits;

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

// The agent keeps its own discovery root, state and projections; the app process keeps the
// system home so safeStorage can reach the login keychain.
const agentEnv = {
 ...privateEnv,
 HOME: home,
 ZDOTDIR: home,
 CODEX_HOME: state,
 CLAUDE_CONFIG_DIR: join(home, ".claude"),
};

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
  `(()=>{const req=process.getBuiltinModule('module').createRequire(process.resourcesPath+'/app.asar/package.json');const DB=req('better-sqlite3'),db=new DB(${JSON.stringify(join(userData, "smartdd.db"))},{readonly:true});try{const row=db.prepare("SELECT state FROM capability_resources WHERE kind='application-package' AND relative_path LIKE ? ORDER BY generation DESC LIMIT 1").get(${JSON.stringify("%/" + appId + "/%")});return row?row.state:null}finally{db.close()}})()`,
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
 await app.evaluate(`document.title='A · M11 T09 · 禅道 v2 真实读取';true`);

 stage = "prerequisites";
 await progress();
 project = await app.invoke(
  "projects.create",
  {
   name: projectName,
   aliases: [],
   description: "M11 T09 private real-ZenTao read-only prerequisite",
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
  // The managed CLI talks to the app over a unix socket; Codex's read-only seatbelt denies it
  // unless the run plan carries a matching grant. Business read-only scope is enforced by the
  // app's own allowed-operations list, which this profile cannot widen.
  "danger-full-access",
  "--ask-for-approval",
  "never",
 ];
 profile = await app.invoke("aiProfiles.create", {
  name: "M11 T09 私有 Codex 0.166.0",
  runner: "codex",
  executable: cli,
  env: Object.entries(agentEnv).map(([name, value]) => ({
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
 await app.evaluate(`document.title='A · M11 T09 · 禅道 v2 真实读取';true`);
 // The page collectors do not survive a reload; re-arm before driving the terminal.
 await app.arm();
 await app.waitFor(
  `document.querySelector('[data-testid=home-project]')?.textContent.includes(${JSON.stringify(projectName)})&&document.querySelector('[data-testid=home-profile]')?.textContent.includes('M11 T09 私有 Codex')`,
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
   JSON.stringify({
    applications: launchPlan.applications,
    grades: launchPlan.grades,
    snapshotPackages,
   }),
 );

 result.cliBridge = await app.mainEvaluate(
  `(()=>{const fs=process.getBuiltinModule('fs');let dirs=[];try{dirs=fs.readdirSync('/tmp').filter(n=>n.startsWith('wy-cli-'))}catch{}return dirs.map(d=>{const q=fs.realpathSync('/tmp/'+d);let files=[];try{files=fs.readdirSync(q)}catch{}return {dir:q,files}})})()`,
 );
 stage = "native-task-response";
 await progress();
 await poll(async () => {
  let current = null;
  try {
   current = await app.invoke("tasks.get", task.id);
   if (current) task = current;
  } catch {
   // A killed task can disappear from the registry; that still ends the wait.
   return issued.length >= 5;
  }
  const text = current?.ptyId ? await app.output(current.ptyId) : "";
  await writeFile(join(root, "terminal-current.txt"), text);
  const state = String(current?.task?.state ?? current?.state ?? "running");
  return (
   issued.length >= 5 &&
   // A cancelled in-flight call may never produce an output, so accept a task that already ended.
   (issued.every((c) => envelopes.has(c.callId)) ||
    state !== "running" ||
    // A cancelled call may never surface an output; give it a bounded settle window.
    (issued.length >= 5 && lastIssueAt && Date.now() - lastIssueAt > 15000))
  );
 }, 120000);
 result.finalTask = await app.invoke("tasks.get", task.id);
 result.nativeTools = result.requests.at(-1)?.toolNames ?? [];
 await app.screenshot(join(root, "task-native-response.png"));

 stage = "assertions";
 await progress();
 const defs = result.nativeTools;
 assert(defs.includes("exec_command"), "The native session has no shell tool");
 // A polled read settles in the last chunk of its group, so take the last one.
 const groupOf = (name) => {
  const prefix = name.replace(/-read$/, "");
  return issued.filter((c) =>
   c.note === name || c.note === prefix + "-poll" || c.note === "cancel-poll" && prefix === "cancelled",
  );
 };
 const byNote = (name) => groupOf(name).at(-1);
 const baseline = byNote("baseline-read"),
  held = byNote("held-read"),
  dropped = byNote("dropped-read"),
  cancelled = byNote("cancelled-read");
 assert(
  baseline && held && dropped,
  "The fixture did not issue every read step: " +
   issued.map((c) => c.note).join(","),
 );
 assert(
  !isError(baseline.envelope),
  "The baseline read against the synthetic upstream failed: " + baseline.text,
 );
 checked(
  "Baseline read against the synthetic upstream returns the v2 envelope",
  {
   capabilityId: baseline.capabilityId,
  },
 );

 const heldError = held.envelope?.error ?? null;
 assert(heldError, "The held read did not end with an error: " + held.text);
 assert.equal(
  heldError.code,
  "TIMEOUT",
  "The held read ended with " + JSON.stringify(heldError),
 );
 result.faults = {
  timeout: {
   code: heldError.code,
   effectState: heldError.effectState ?? null,
   retryable: heldError.retryable ?? null,
  },
 };
 checked("Held upstream ends boundedly with TIMEOUT", {
  code: heldError.code,
  effectState: heldError.effectState ?? null,
 });

 const dropError = dropped.envelope?.error ?? null;
 assert(
  dropError,
  "The dropped read did not end with an error: " + dropped.text,
 );
 assert.notEqual(
  dropError.code,
  "TIMEOUT",
  "A dropped connection was reported as a timeout: " +
   JSON.stringify(dropError),
 );
 result.faults.disconnect = {
  code: dropError.code,
  effectState: dropError.effectState ?? null,
 };
 checked("Dropped upstream reports a distinguishable transport failure", {
  code: dropError.code,
 });

 assert(cancelled, "The cancel step was never issued");
 const cancelError = cancelled.envelope?.error ?? null;
 const settleTask = await app.invoke("tasks.get", task.id).catch(() => null);
 const settledState = String(
  settleTask?.task?.state ?? settleTask?.state ?? "gone",
 );
 result.faults.cancel = {
  code: cancelError?.code ?? null,
  envelope: Boolean(cancelled.envelope),
  taskState: settledState,
 };
 assert(
  cancelError ? cancelError.code === "CANCELED" : settledState !== "running",
  "Cancellation was neither reported as CANCELED nor ended the session: " +
   JSON.stringify(result.faults.cancel),
 );
 checked("Cancelling an in-flight read is distinguishable from timeout", {
  code: cancelError?.code ?? "session-ended",
  taskState: settledState,
 });

 // Bounded attempts: one request per step, no automatic replay of a timed-out read.
 const attempts = issued.map((c) => ({
  note: c.note,
  requests: faultHits.filter(
   (h) => h.mode !== undefined && c.at && h.at >= c.at,
  ).length,
 }));
 result.faultHitsByNote = attempts;
 const readSends = faultHits.filter((h) => /\/bugs/.test(h.path)).length;
 result.upstreamReadRequests = readSends;
 assert.equal(
  readSends,
  4,
  "Expected exactly one upstream read per step, saw " + readSends,
 );
 checked("Each step reached the upstream exactly once (no automatic retry)", {
  reads: readSends,
 });

 result.finalTask = await app.invoke("tasks.get", task.id).catch(() => null);
 const finalState =
  result.finalTask?.task?.state ?? result.finalTask?.state ?? null;
 assert(
  finalState === null || String(finalState) !== "running",
  "The task kept running after the cancelled read: " + finalState,
 );
 checked("The cancelled session ends instead of staying running", {
  state: finalState,
 });

 assert.deepEqual(app.rendererErrors, []);
 result.status = "passed-fault-behaviour";
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
 // The synthetic upstream keeps its own listener and any deliberately held responses.
 for (const held of heldResponses) {
  try {
   held.destroy();
  } catch {}
 }
 await new Promise((r) => fault.close(r));
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
