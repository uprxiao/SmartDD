// M11 actual ZenTao entry: CLI or controlled unknown-version MCP fallback. Fresh private state, real App/Codex, synthetic model/HTTP.
// Not proof of real model reasoning, real Foxmail/ZenTao data, or completion of an M11 formal case.
// Derived from the archived M10 T actual-CLI UI driver (original SHA256 af541844bf67142b4394cdaf5dbfddf79e2921a8cbebbc4f6cca9a301b444bef).
// Real App/PTY/Codex/MCP and private SQLite; Responses model is a loopback synthetic fixture.
// No daily credentials, external business services, actual model reasoning or email send.
// This driver records partial coverage; it cannot close all layers of a formal case.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { parse as parseToml } from "smol-toml";
import { createServer } from "node:http";
import { execFileSync, spawnSync } from "node:child_process";
import {
 mkdtemp,
 mkdir,
 readFile,
 writeFile,
 readdir,
 stat,
} from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
import { openElectron } from "../lib/electron-harness.mjs";
import {
 installAppFocusGuard,
 isAppFocusYield,
} from "../lib/app-focus-guard.mjs";
import { focusNewInstalledWindow } from "./fixtures/dmg-install-ui.mjs";
import { captureBudgetService } from "./fixtures/budget-main-capture.mjs";
import {
 installM11GatewayProbe,
 m11GatewaySnapshot,
 m11GatewayFault,
 useM11ForeignTokenOnNextRun,
 replayM11OutsideManagedTree,
 restoreM11GatewayProbe,
} from "./fixtures/m11-gateway-probe.mjs";

const mode = process.env.WILLYOU_M11_ZEN_MODE ?? "cli",
 unknown = mode === "unknown-mcp",
 cliLoss = mode === "cli-loss",
 scopeDenial = mode === "scope-denial",
 restartHost = mode === "app-restart-host",
 appRestart = mode === "app-restart" || restartHost,
 stopReplay = mode === "ui-stop-replay",
 permissionReplay =
  mode === "ui-disable-replay" || mode === "ui-disconnect-replay",
 gatewayEvidence = mode === "gateway-evidence",
 revocation = stopReplay || permissionReplay || gatewayEvidence;
assert(
 [
  "cli",
  "unknown-mcp",
  "cli-loss",
  "scope-denial",
  "app-restart",
  "app-restart-host",
  "ui-stop-replay",
  "ui-disable-replay",
  "ui-disconnect-replay",
  "gateway-evidence",
 ].includes(mode),
);
const root = await mkdtemp("/private/tmp/willyou-m11-s7-native-");
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
assert(appRoot.startsWith("/private/tmp/willyou-m11-s7/"));
assert(
 /^[a-f0-9]{64}$/.test(process.env.WILLYOU_TEST_SOURCE_MANIFEST_SHA ?? ""),
);
const sha = (b) => createHash("sha256").update(b).digest("hex");
const marker = "M11_S7_CLI_READ_" + root.split("-").at(-1);
const result = {
 schema: "m11-s7-packaged-native-entry-v2",
 mode,
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
  "A: real packaged App composer -> actual Codex0.166 engine -> actual " +
  (unknown ? "MCP fallback with controlled reported version99" : "native CLI") +
  " -> unified capability result/diagnostics; private synthetic model and HTTP, no external send",
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
if (restartHost)
 result.layer +=
  "; native quit gesture/dialog UI NOT covered: explicit I-layer own-dialog response fixture exercises the real App.quit lifecycle only";
if (revocation) {
 result.layer +=
  "; own original constructor capture and pass-through in-memory token observer; authentication rules unchanged";
 result.externalDriverFiles = await Promise.all(
  [
   "./m11-zen-cli-ui.mjs",
   "./fixtures/m11-gateway-probe.mjs",
   "./fixtures/budget-main-capture.mjs",
   "../lib/electron-harness.mjs",
  ].map(async (path) => ({
   path,
   sha256: sha(await readFile(new URL(path, import.meta.url))),
  })),
 );
}
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
const modelCallId = (step) =>
 "call_m11_" + (result.fixtureTurn ?? "cli") + "_" + step;
const currentCapabilityResult = (outputs) =>
 capabilityResult(
  outputs?.filter((v) => v.type === "function_call_output").at(-1),
 );
let profileCommand = cli;
if (unknown) {
 profileCommand = join(root, "codex-reported-99");
 const wrapper = [
  "#!/bin/sh",
  'if [ "$1" = "--version" ]; then echo "codex-cli 99.0.0"; exit 0; fi',
  "exec " + shellQuote(cli) + ' "$@"',
  "",
 ].join("\n");
 await writeFile(profileCommand, wrapper, { mode: 0o700 });
 result.reportedVersionFixture = {
  reported: "99.0.0",
  actualEngine: "0.166.0",
  path: profileCommand,
  sha256: sha(await readFile(profileCommand)),
  boundary:
   "Only --version is controlled; all actual task and MCP execution uses the pinned0.166 engine. Not compatibility certification of a real99 binary.",
 };
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
function capabilityResult(value, depth = 0) {
 if (depth > 10) return null;
 if (value && typeof value === "object") {
  if (value.schema === "willyou-app-result-v2") return value;
  for (const v of Object.values(value)) {
   const got = capabilityResult(v, depth + 1);
   if (got) return got;
  }
 } else if (typeof value === "string") {
  for (const text of [value, ...value.split("\n")])
   try {
    const got = capabilityResult(JSON.parse(text), depth + 1);
    if (got) return got;
   } catch {}
 }
 return null;
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
  if (req.url?.startsWith("/zt/")) {
   const url = new URL(req.url, "http://127.0.0.1"),
    reply = (value, status = 200) => {
     res.writeHead(status, { "content-type": "application/json" });
     res.end(JSON.stringify(value));
    };
   const foreign = url.pathname.startsWith("/zt/b/");
   if (req.headers.token !== "M11_SYNTHETIC_ZT") return reply({}, 401);
   result.providerReads = (result.providerReads ?? 0) + 1;
   (result.providerPaths ??= []).push(url.pathname);
   if (url.pathname.endsWith("/v1/user"))
    return reply({
     profile: { id: "7", account: foreign ? "tester-b" : "tester" },
    });
   if (url.pathname.endsWith("/v2/my/work")) {
    const kind = url.searchParams.get("mode"),
     rows =
      kind === "bug"
       ? [
          {
           id: foreign ? "79292" : "79291",
           title: foreign ? "Foreign synthetic Bug" : "Synthetic CLI Bug",
           status: "active",
           assignedTo: { account: "tester" },
          },
         ]
       : [];
    return reply({
     mode: kind,
     type: "assignedTo",
     pager: {
      recTotal: rows.length,
      pageID: 1,
      recPerPage: Number(url.searchParams.get("recPerPage")),
      pageTotal: rows.length ? 1 : 0,
     },
     [kind === "bug" ? "bugs" : "stories"]: rows,
    });
   }
   return reply({}, 404);
  }
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
  if (taskRequest) {
   result.issuedTools ??= [];
   if (scopeDenial && result.issuedTools.length) {
    const previous = result.issuedTools.length - 1,
     outputs = (body.input ?? []).filter(
      (v) =>
       v.type === "function_call_output" && v.call_id === modelCallId(previous),
     );
    (result.outputsByStep ??= {})[previous] = outputs;
    if (previous === 6) result.nativeToolOutputs = outputs;
    if (previous >= 1 && previous <= 5)
     (result.scope.providerCountsAfterDenials ??= []).push({
      step: previous,
      providerReads: result.providerReads,
     });
   }

   const tools = (body.tools ?? []).flatMap((t) =>
    t.type === "namespace"
     ? (t.tools ?? []).map((v) => ({ ...v, namespace: t.name }))
     : [t],
   );
   const exec =
    tools.find((t) => t.name === "exec" && t.type === "custom") ??
    tools.find((t) => t.name === "exec_command");
   if (!exec) {
    result.fixtureFailure = {
     code: "EXEC_TOOL_MISSING",
     message: "The actual Codex request did not declare the native exec tool",
    };
    res.end();
    return;
   }
   if (result.issuedTools.length < (scopeDenial ? 7 : cliLoss ? 3 : 2)) {
    try {
     if (!result.runPlan) {
      result.runPlan = await readRunPlan();
      assert.equal(
       result.runPlan.applications.find((a) => a.appId === "zentao")
        .effectiveEntry,
       unknown ? "mcp" : "cli",
       "Effective entry must match the reported-version policy",
      );
     }
     const path = join(
      home,
      ".agents/skills",
      result.runPlan.skills.find(
       (v) => v.appId === "zentao" && v.skillId === "bug-analysis",
      ).nativeName,
      "SKILL.md",
     );
     const step = result.issuedTools.length;
     if (scopeDenial && step === 1)
      result.scope.providerReadsBeforeDenials = result.providerReads;
     const command =
       scopeDenial && step >= 1 && step <= 5
        ? result.scope.requests[step - 1].command
        : step === 0
          ? (unknown
             ? 'test -z "${WILLYOU_RUN_TOKEN:-}" && test -z "${WILLYOU_ENDPOINT:-}" && '
             : "") +
            "/bin/cat " +
            shellQuote(path)
          : cliLoss && step === 2
            ? "env WILLYOU_ENDPOINT=" +
              shellQuote(join(root, "intentionally-unavailable-cli.sock")) +
              " willyou-app zentao object list --kind bug"
            : (result.turnCommand ??
              "willyou-app zentao object list --kind bug"),
      input =
       "text(await tools.exec_command({cmd:" +
       JSON.stringify(command) +
       ",max_output_tokens:12000,yield_time_ms:10000}));";
     let call;
     if (unknown && step === 1) {
      const namespace = (body.tools ?? []).find(
       (t) =>
        t.type === "namespace" &&
        (t.tools ?? []).some(
         (tool) => tool.name === "smartdd_zentao_work_list_v2",
        ),
      );
      assert(
       namespace,
       "Actual native request must declare the fallback MCP tool",
      );
      call = {
       type: "function_call",
       id: "fc_m11_" + step,
       call_id: modelCallId(step),
       name: "smartdd_zentao_work_list_v2",
       namespace: namespace.name,
       arguments: JSON.stringify({ kind: "bug" }),
       status: "completed",
      };
     } else
      call =
       exec.type === "custom"
        ? {
           type: "custom_tool_call",
           id: "ct_m11_" + step,
           call_id: modelCallId(step),
           name: exec.name,
           ...(exec.namespace ? { namespace: exec.namespace } : {}),
           input,
           status: "completed",
          }
        : {
           type: "function_call",
           id: "fc_m11_" + step,
           call_id: modelCallId(step),
           name: exec.name,
           ...(exec.namespace ? { namespace: exec.namespace } : {}),
           arguments: JSON.stringify({
            cmd: command,
            max_output_tokens: 12000,
            yield_time_ms: 10000,
           }),
           status: "completed",
          };
     result.issuedTools.push({
      ...call,
      fixture:
       "loopback synthetic provider chooses the exact read; actual Codex/exec/" +
       (unknown && step === 1 ? "MCP" : "native CLI") +
       "/host/provider execute it",
     });
     if (step === 1)
      result.skillOutput = (body.input ?? []).filter(
       (v) => v.call_id === modelCallId(0),
      );
     if (cliLoss && step === 2)
      result.providerReadsBeforeLoss = result.providerReads;
     if (cliLoss && step === 2)
      result.nativeToolOutputs = (body.input ?? []).filter(
       (v) => v.call_id === modelCallId(1),
      );
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
       id: "resp_m11_tool_" + step,
       object: "response",
       created_at: Math.floor(Date.now() / 1000),
       status: "in_progress",
       output: [],
      },
     });
     send("response.output_item.added", {
      output_index: 0,
      item: {
       ...call,
       status: "in_progress",
       ...(call.type === "custom_tool_call"
        ? { input: "" }
        : { arguments: "" }),
      },
     });
     if (call.type === "custom_tool_call") {
      send("response.custom_tool_call_input.delta", {
       item_id: call.id,
       output_index: 0,
       delta: input,
      });
      send("response.custom_tool_call_input.done", {
       item_id: call.id,
       output_index: 0,
       input,
      });
     } else {
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
     }
     send("response.output_item.done", { output_index: 0, item: call });
     send("response.completed", {
      response: {
       id: "resp_m11_tool_" + step,
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
      code: "CLI_FIXTURE_PRECONDITION",
      message: String(error),
     };
     res.end();
     return;
    }
   }
   if (cliLoss)
    result.cliLossOutputs = (body.input ?? []).filter(
     (v) => v.type === "function_call_output" && v.call_id === modelCallId(2),
    );
   else if (!scopeDenial)
    result.nativeToolOutputs = (body.input ?? []).filter(
     (v) => v.call_id === modelCallId(1),
    );
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
 "model=" +
 JSON.stringify(unknown ? "m11-ui-profile-model" : "m11-base-model") +
 "\n" +
 (unknown
  ? 'default_permissions=":workspace"\nskills.config=[{path=' +
    JSON.stringify(skill) +
    ",enabled=false}]\n"
  : "") +
 'model_provider="m11_local_fixture"\nnotify=[]\n[model_providers.m11_local_fixture]\nname="M11 Synthetic Local Fixture"\nbase_url="http://127.0.0.1:' +
 port +
 '/v1"\nwire_api="responses"\nrequires_openai_auth=false\n[analytics]\nenabled=false\n[feedback]\nenabled=false\n[projects.' +
 JSON.stringify(cwd) +
 ']\ntrust_level="trusted"\n';
const nativeNoticeState =
 '\n[tui]\nscreen_reader_detection_done = true\n\n[tui.model_availability_nux]\n"gpt-6.1-sol" = 1\n';
const profileText =
 'model="m11-ui-profile-model"\ndefault_permissions="m11_user"\nskills.config=[{path=' +
 JSON.stringify(skill) +
 ',enabled=false}]\n[permissions.m11_user]\nextends=":workspace"\n[permissions.m11_user.filesystem]\n' +
 JSON.stringify(join(root, "denied")) +
 '="deny"\n[permissions.m11_user.network]\nenabled=false\n';
await mkdir(join(root, "denied"));
await writeFile(join(root, "denied/private.txt"), "M11 denied sentinel");
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
 NO_PROXY:
  "127.0.0.1,localhost" +
  (process.env.WILLYOU_ZEN_BASE
   ? "," + URL.parse(process.env.WILLYOU_ZEN_BASE)?.hostname
   : ""),
 SHELL: "/bin/zsh",
};
// This script is itself an isolated driver process. Do not rely on its caller
// having removed ambient provider credentials or other user configuration.
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
 const find = `Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(e=>e.getBoundingClientRect().width&&e.getBoundingClientRect().height&&${text === undefined ? "true" : `e.textContent.trim()===${JSON.stringify(text)}`})`;
 await app.waitFor(
  `(()=>{const e=${find};if(!e||e.matches(':disabled')||document.getAnimations().some(a=>a.playState==='running'&&a.effect?.getTiming().iterations!==Infinity))return false;e.scrollIntoView({block:'nearest',behavior:'instant'});const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})()`,
  8000,
 );
 const p = await app.evaluate(
  `(()=>{const e=${find};if(!e||e.matches(':disabled'))throw Error('Control changed after readiness');const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;if(!e.contains(document.elementFromPoint(x,y)))throw Error('Control blocked');return{x,y};})()`,
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
async function requireOperationRun(value, plan) {
 const row = await app.mainEvaluate(
  `(()=>{const req=process.getBuiltinModule('module').createRequire(process.resourcesPath+'/app.asar/package.json'),DB=req('better-sqlite3'),db=new DB(${JSON.stringify(join(userData, "smartdd.db"))},{readonly:true});try{return db.prepare('SELECT run_id,task_id,state,app_id FROM application_data_operations WHERE operation_id=?').get(${JSON.stringify(value.operation.id)})}finally{db.close()}})()`,
  { label: "m11-current-operation-run" },
 );
 assert.deepEqual(row, {
  run_id: plan.runId,
  task_id: plan.taskId,
  state: "succeeded",
  app_id: "zentao",
 });
 return row;
}
async function restoreGatewayFixture() {
 if (!revocation || result.gatewayFixtureRestored || !app) return;
 result.gatewayFixtureRestored = await restoreM11GatewayProbe(app);
 result.captureFixtureRestored = await app.mainEvaluate(
  `(()=>{const g=globalThis.__mkWorkerInheritance,T=process.getBuiltinModule('worker_threads');if(!g)throw Error('Own capture fixture missing');g.active=false;T.Worker=g.original;delete globalThis.__mkWorkerInheritance;delete globalThis.__ncHistoryProbe;return{workerRestored:T.Worker===g.original,captureRemoved:!globalThis.__ncHistoryProbe}})()`,
  { label: "m11-gateway-capture-restore", synchronous: true },
 );
}
function cliError(value, depth = 0) {
 if (depth > 10) return null;
 if (value && typeof value === "object") {
  if (typeof value.error?.code === "string") return value.error;
  for (const v of Object.values(value)) {
   const got = cliError(v, depth + 1);
   if (got) return got;
  }
 } else if (typeof value === "string")
  for (const text of [value, ...value.split("\n")])
   try {
    const got = cliError(JSON.parse(text), depth + 1);
    if (got) return got;
   } catch {}
 return null;
}
async function nativeCompletionCount(currentTask) {
 const current = await poll(async () => {
  const t = await app.invoke("tasks.get", currentTask.id);
  return t.nativeSessionId ? t : null;
 }, 15000);
 const names = (
  await readdir(join(state, "sessions"), { recursive: true })
 ).filter((n) => n.endsWith("-" + current.nativeSessionId + ".jsonl"));
 assert.equal(names.length, 1);
 const file = join(state, "sessions", names[0]);
 assert((await stat(file)).size < 8 * 1024 * 1024);
 return (await readFile(file, "utf8")).split("\n").filter((line) => {
  try {
   const v = JSON.parse(line);
   return (
    v.type === "response_item" &&
    v.payload?.role === "assistant" &&
    JSON.stringify(v.payload.content).includes(marker + "_DONE")
   );
  } catch {
   return false;
  }
 }).length;
}
async function actualGatewayTurn(
 label,
 command = "willyou-app zentao object list --kind bug",
) {
 const completed = await nativeCompletionCount(task);
 assert(completed > 0);
 result.fixtureTurn = (result.fixtureTurn ?? 0) + 1;
 result.issuedTools = [];
 result.nativeToolOutputs = null;
 result.runPlan = null;
 result.skillOutput = null;
 result.turnCommand = command;
 await click(".xterm-screen");
 await app.waitFor(
  "document.activeElement?.classList.contains('xterm-helper-textarea')",
  5000,
 );
 const message =
  marker +
  "_" +
  label +
  ": Read current bug-analysis Skill, then execute exactly once: " +
  command +
  ". Return " +
  marker +
  "_DONE.";
 await app.cdp("Input.insertText", { text: message });
 await app.waitFor(
  `document.body.innerText.includes(${JSON.stringify(marker + "_" + label)})`,
  5000,
 );
 await new Promise((r) => setTimeout(r, 400));
 await key("Enter", "Enter", 13);
 await poll(
  async () =>
   result.nativeToolOutputs?.some((v) => v.type === "function_call_output"),
  45000,
 );
 await poll(async () => (await nativeCompletionCount(task)) > completed, 15000);
 const outputs = structuredClone(result.nativeToolOutputs);
 await writeFile(
  join(root, "turn-" + label + "-outputs.json"),
  JSON.stringify(outputs, null, 2) + "\n",
 );
 const observation = {
  label,
  outputs,
  error: cliError(outputs),
  value: currentCapabilityResult(outputs),
  plan: await readRunPlan(),
  gateway: await m11GatewaySnapshot(app),
  providerReads: result.providerReads,
 };
 await app.screenshot(join(root, "turn-" + label + ".png"));
 return observation;
}
async function runGatewayEvidence() {
 stage = "gateway-evidence-baseline";
 await progress();
 await poll(async () => (await nativeCompletionCount(task)) > 0, 15000);
 const originalTask = { ...task },
  originalPlan = result.runPlan,
  before = await m11GatewaySnapshot(app),
  providerReads = result.providerReads;
 const evidence = (result.gatewayEvidence = {
  before,
  originalPlan,
  originalTaskId: task.id,
  cases: [],
  boundary:
   "Actual packaged App, original gateway/native executable/Codex. Three evidence fault modes replace only observed native evidence after the original native probe; another-run fault changes only one owned launch environment. Authentication and authorization rules are unchanged.",
 });
 const outsider = await replayM11OutsideManagedTree(
  app,
  originalPlan.runId,
  home,
 );
 assert.equal(outsider.error, "PEER_MISMATCH");
 assert.equal(result.providerReads, providerReads);
 assert.equal((await m11GatewaySnapshot(app)).invocations, before.invocations);
 evidence.cases.push({
  label: "valid-token-tree-outsider",
  response: outsider,
  businessDelta: 0,
 });
 for (const [mode, expected] of [
  ["unreadable", "PEER_UNVERIFIABLE"],
  ["wrong-start", "PEER_MISMATCH"],
  ["wrong-executable", "EXECUTABLE_MISMATCH"],
 ]) {
  stage = "gateway-" + mode;
  await progress();
  await m11GatewayFault(app, mode, originalPlan.runId);
  let observed;
  try {
   observed = await actualGatewayTurn(mode);
  } finally {
   await m11GatewayFault(app, "normal", originalPlan.runId);
  }
  assert.equal(
   observed.error?.code,
   expected,
   JSON.stringify(observed.outputs),
  );
  assert.equal(observed.value, null);
  assert.equal(observed.providerReads, providerReads);
  assert.equal(observed.gateway.invocations, before.invocations);
  evidence.cases.push({ ...observed, businessDelta: 0 });
 }
 stage = "gateway-unauthorized-write";
 await progress();
 const write = await actualGatewayTurn(
  "unselected-write",
  "willyou-app zentao object update --id 79291",
 );
 assert.equal(write.error?.code, "SCOPE_DENIED");
 assert.equal(write.value, null);
 assert.equal(write.providerReads, providerReads);
 assert.equal(write.gateway.invocations, before.invocations);
 evidence.cases.push({
  ...write,
  businessDelta: 0,
  boundary:
   "Actual native CLI discovery exposes only allowed commands, so the write is denied at command selection; separate I layer tests direct host capability-call refusal.",
 });
 stage = "gateway-restored-positive";
 await progress();
 const good = await actualGatewayTurn("restored-positive");
 assert.equal(good.value?.operation.origin, "cli");
 assert.equal(good.value?.data.items[0].id, "79291");
 assert.equal(good.providerReads, providerReads + 2);
 assert.equal(good.gateway.invocations, before.invocations + 1);
 await requireOperationRun(good.value, good.plan);
 evidence.restoredPositive = good;
 stage = "gateway-cross-run-create";
 await progress();
 evidence.foreignFault = await useM11ForeignTokenOnNextRun(
  app,
  originalPlan.runId,
 );
 await click("[data-testid=nav-new-task]");
 await app.waitFor(
  '!!document.querySelector("[data-testid=home-input]")',
  15000,
 );
 result.fixtureTurn = (result.fixtureTurn ?? 0) + 1;
 result.issuedTools = [];
 result.nativeToolOutputs = null;
 result.runPlan = null;
 result.skillOutput = null;
 delete result.turnCommand;
 await click("[data-testid=home-input]");
 await key("a", "KeyA", 65, 4, ["selectAll"]);
 await app.cdp("Input.insertText", {
  text:
   marker +
   "_CROSS_RUN: Read current bug-analysis Skill and query my Bug list once using CLI. Return " +
   marker +
   "_DONE.",
 });
 await click("[data-testid=home-launch]");
 const second = await poll(async () => {
  const list = await app.invoke("tasks.list", { includeArchived: true });
  if (list.length !== 2) return null;
  const t = list.find((t) => t.id !== originalTask.id);
  if (t && !(result.additionalTaskIds ??= []).includes(t.id))
   result.additionalTaskIds.push(t.id);
  return t?.ptyId ? t : null;
 }, 20000);
 assert(second.ptyId);
 task = second;
 await poll(
  async () =>
   result.nativeToolOutputs?.some((v) => v.type === "function_call_output"),
  45000,
 );
 await poll(async () => (await nativeCompletionCount(second)) > 0, 15000);
 const cross = {
  outputs: structuredClone(result.nativeToolOutputs),
  gateway: await m11GatewaySnapshot(app),
  plan: await readRunPlan(),
  secondTaskId: second.id,
  providerReads: result.providerReads,
 };
 assert.equal(cliError(cross.outputs)?.code, "PEER_MISMATCH");
 assert.equal(currentCapabilityResult(cross.outputs), null);
 assert.equal(cross.providerReads, providerReads + 2);
 assert.equal(cross.gateway.invocations, before.invocations + 1);
 assert.notEqual(cross.plan.runId, originalPlan.runId);
 assert.deepEqual(cross.gateway.foreignDelivery, {
  runId: cross.plan.runId,
  tokenOwnerRunId: originalPlan.runId,
 });
 evidence.cases.push({
  ...cross,
  label: "another-active-run-token",
  businessDelta: 0,
 });
 await app.screenshot(join(root, "gateway-other-live-run-token.png"));
 task = originalTask;
 checked(
  "T38 actual App boundary: six negative scenarios execute no business; real native evidence faults fail closed, original legitimate CLI succeeds, and a concurrent real Codex cannot use the other active run token",
 );
}
async function openZenManagement() {
 await click("[data-testid=nav-apps]");
 await app.waitFor('!!document.querySelector(".m10-shell")', 10000);
 await click(".m10-nav.installed", "禅道");
 const control = '[role=switch][aria-label="全局启用禅道"]',
  picker = 'select[aria-label="当前应用项目"]';
 await app.waitFor(
  `Boolean(document.querySelector(${JSON.stringify(control)}))`,
  10000,
 );
 // Clear the business panel's project through its actual native select before
 // toggling policy, so unrelated page refreshes cannot count as CLI side effects.
 if (
  (await app.evaluate(
   `Boolean(document.querySelector(${JSON.stringify(picker)}))`,
  )) &&
  !(await app.evaluate(
   `document.querySelector(${JSON.stringify(picker)}).value===''`,
  ))
 ) {
  // Same verified native-select path as m11-module-forms-ui: Tab focus, then
  // typeahead. A pointer click opens an OS popup outside renderer CDP keys.
  for (
   let i = 0;
   i < 80 &&
   !(await app.evaluate(
    `document.activeElement?.matches(${JSON.stringify(picker)})===true`,
   ));
   i++
  )
   await key("Tab", "Tab", 9);
  assert(
   await app.evaluate(
    `document.activeElement?.matches(${JSON.stringify(picker)})===true`,
   ),
  );
  const label = await app.evaluate(
   `[...document.querySelector(${JSON.stringify(picker)}).options].find(o=>o.value==='').textContent`,
  );
  for (const ch of label)
   await app.cdp("Input.dispatchKeyEvent", { type: "char", key: ch, text: ch });
  await app.waitFor(
   `document.querySelector(${JSON.stringify(picker)}).value===''`,
   5000,
  );
  await key("Tab", "Tab", 9);
 }
}
async function returnToOriginalTask() {
 if (
  !(await app.evaluate(
   '[...document.querySelectorAll("[data-testid=sidebar-task]")].some(e=>e.getBoundingClientRect().width&&e.getBoundingClientRect().height)',
  ))
 ) {
  await click("[data-testid=nav-home]");
  await app.waitFor(
   '[...document.querySelectorAll("[data-testid=sidebar-task]")].some(e=>e.getBoundingClientRect().width&&e.getBoundingClientRect().height)',
   10000,
  );
 }
 await click("[data-testid=sidebar-task]");
 await app.waitFor('!!document.querySelector(".xterm-screen")', 10000);
}
async function runPermissionReplay() {
 stage = "permission-replay-baseline";
 await progress();
 await poll(async () => (await nativeCompletionCount(task)) > 0, 15000);
 const plan = result.runPlan,
  originalTask = { ...task },
  before = await m11GatewaySnapshot(app),
  kind = mode === "ui-disable-replay" ? "disable" : "disconnect";
 const proof = (result.permissionReplay = {
  kind,
  before,
  originalTaskId: task.id,
  originalPlan: plan,
  boundary:
   "Actual UI app switch or connection confirmation; subsequent actual managed CLI probes use the original unmodified environment. No policy/credentials are changed by RPC for these actions.",
 });
 await openZenManagement();
 if (kind === "disable") {
  stage = "actual-ui-global-disable";
  await progress();
  await click('[role=switch][aria-label="全局启用禅道"]');
  await poll(async () => {
   const c = await app.invoke("applications.catalog");
   return c.ok && c.value.find((a) => a.appId === "zentao")?.enabled === false;
  }, 10000);
  await app.waitFor(
   `document.querySelector(${JSON.stringify('[role=switch][aria-label="全局启用禅道"]')})?.getAttribute('aria-checked')==='false'`,
   5000,
  );
 } else {
  stage = "actual-ui-disconnect";
  await progress();
  await click('button[aria-label="管理Synthetic CLI ZenTao"]');
  await click("[role=menuitem]", "断开连接");
  await app.waitFor(
   '[...document.querySelectorAll("dialog[open] button")].some(e=>e.textContent.trim()==="断开连接"&&!e.disabled)',
   10000,
  );
  await app.screenshot(join(root, "before-real-disconnect-confirmation.png"));
  await click("dialog[open] button", "断开连接");
  await app.waitFor('!document.querySelector("dialog[open]")', 10000);
  proof.connectionAfter = await app.mainEvaluate(
   `(()=>{const g=globalThis.__m11GatewayProbe;return g.service.store.sqlite.prepare('SELECT auth_state,secret_ref,policy_revision FROM application_connections WHERE id=?').get(${JSON.stringify(result.connectionId)})})()`,
   { label: "m11-disconnected-original-connection", synchronous: true },
  );
  assert.equal(proof.connectionAfter.auth_state, "disconnected");
  assert.equal(proof.connectionAfter.secret_ref, null);
 }
 await app.screenshot(join(root, "after-real-ui-" + kind + ".png"));
 await returnToOriginalTask();
 const providerReads = result.providerReads,
  invocations = (await m11GatewaySnapshot(app)).invocations;
 stage = "original-managed-cli-after-" + kind;
 await progress();
 const denied = await actualGatewayTurn("after-" + kind);
 assert.equal(
  denied.error?.code,
  "SCOPE_DENIED",
  JSON.stringify(denied.outputs),
 );
 assert.equal(denied.value, null);
 assert.equal(denied.providerReads, providerReads);
 assert.equal(denied.gateway.invocations, invocations);
 proof.originalManagedDenial = denied;
 proof.revokedReplay = await replayM11OutsideManagedTree(app, plan.runId, home);
 assert.equal(proof.revokedReplay.error, "AUTH_REQUIRED");
 assert.equal(result.providerReads, providerReads);
 if (kind === "disable") {
  stage = "actual-ui-reenable";
  await progress();
  await openZenManagement();
  await click('[role=switch][aria-label="全局启用禅道"]');
  await poll(async () => {
   const c = await app.invoke("applications.catalog");
   return c.ok && c.value.find((a) => a.appId === "zentao")?.enabled === true;
  }, 10000);
  await returnToOriginalTask();
  proof.afterReenable = await actualGatewayTurn("old-token-after-reenable");
  assert.equal(proof.afterReenable.error?.code, "AUTH_REQUIRED");
  assert.equal(proof.afterReenable.providerReads, providerReads);
  assert.equal(proof.afterReenable.gateway.invocations, invocations);
  stage = "actual-ui-stop-for-fresh-enabled-run";
  await progress();
  await click("[data-testid=task-actions]");
  await app.waitFor(
   '!!document.querySelector("[data-testid=task-kill]")',
   5000,
  );
  await click("[data-testid=task-kill]");
  await poll(
   async () => !(await app.invoke("tasks.get", originalTask.id)).ptyId,
   20000,
  );
  result.fixtureTurn = (result.fixtureTurn ?? 0) + 1;
  result.issuedTools = [];
  result.nativeToolOutputs = null;
  result.runPlan = null;
  result.skillOutput = null;
  delete result.turnCommand;
  await click("[data-testid=task-actions]");
  await app.waitFor(
   '!!document.querySelector("[data-testid=task-header-resume]")',
   5000,
  );
  await click("[data-testid=task-header-resume]");
  task = await poll(async () => {
   const t = await app.invoke("tasks.get", originalTask.id);
   return t.ptyId ? t : null;
  }, 25000);
  assert.notEqual(task.ptyId, originalTask.ptyId);
  await poll(
   async () => (await app.output(task.ptyId)).includes("OpenAI Codex"),
   20000,
  );
  proof.freshEnabledRun = await actualGatewayTurn("new-enabled-run");
  assert.equal(proof.freshEnabledRun.value?.operation.origin, "cli");
  assert.notEqual(proof.freshEnabledRun.plan.runId, plan.runId);
  assert.deepEqual(proof.freshEnabledRun.plan.allowed, plan.allowed);
  assert.equal(proof.freshEnabledRun.providerReads, providerReads + 2);
  await requireOperationRun(
   proof.freshEnabledRun.value,
   proof.freshEnabledRun.plan,
  );
  proof.oldTokenAfterFreshRun = await replayM11OutsideManagedTree(
   app,
   plan.runId,
   home,
  );
  assert.equal(proof.oldTokenAfterFreshRun.error, "AUTH_REQUIRED");
 }
 checked(
  "T07 " +
   kind +
   " subcoverage: actual UI changes policy; original managed CLI is denied without business, token revoked; " +
   (kind === "disable"
    ? "re-enable cannot revive it and actual UI-resumed new run executes only current allowed read"
    : "disconnect clears local credential reference and the original environment cannot recover it"),
 );
}
async function runStopReplay() {
 stage = "stop-replay-native-id";
 await progress();
 task = await poll(async () => {
  const t = await app.invoke("tasks.get", task.id);
  return t.nativeSessionId ? t : null;
 }, 20000);
 const matches = (
  await readdir(join(state, "sessions"), { recursive: true })
 ).filter((n) => n.endsWith("-" + task.nativeSessionId + ".jsonl"));
 assert.equal(matches.length, 1);
 const nativeFile = join(state, "sessions", matches[0]);
 assert((await stat(nativeFile)).size < 8 * 1024 * 1024);
 await poll(
  async () =>
   (await readFile(nativeFile, "utf8")).split("\n").some((line) => {
    try {
     const v = JSON.parse(line);
     return (
      v.type === "response_item" &&
      v.payload?.role === "assistant" &&
      JSON.stringify(v.payload.content).includes(marker + "_DONE")
     );
    } catch {
     return false;
    }
   }),
  15000,
 );
 const originalRun = await app.mainEvaluate(
  `(()=>{const g=globalThis.__m11GatewayProbe;return g.service.store.sqlite.prepare('SELECT pid,state FROM capability_runs WHERE run_id=?').get(${JSON.stringify(result.runPlan.runId)})})()`,
  { label: "m11-live-run-read", synchronous: true },
 );
 assert(originalRun.pid > 0);
 assert.equal(originalRun.state, "active");
 const before = {
  taskId: task.id,
  nativeId: task.nativeSessionId,
  ptyId: task.ptyId,
  plan: result.runPlan,
  actual: result.actualCapabilityResult,
  run: originalRun,
  providerReads: result.providerReads,
  gateway: await m11GatewaySnapshot(app),
 };
 assert(before.gateway.tokens.some((t) => t.runId === before.plan.runId));
 result.stopReplay = {
  before,
  scope:
   "T07 actual UI stop/new-run subcoverage; disable/disconnect remain separate pending actions",
 };
 result.stopReplay.liveOutsider = await replayM11OutsideManagedTree(
  app,
  before.plan.runId,
  home,
 );
 assert.equal(result.stopReplay.liveOutsider.error, "PEER_MISMATCH");
 assert.equal(result.providerReads, before.providerReads);
 stage = "actual-ui-stop";
 await progress();
 await click("[data-testid=task-actions]");
 await app.waitFor('!!document.querySelector("[data-testid=task-kill]")', 5000);
 await click("[data-testid=task-kill]");
 task = await poll(async () => {
  const t = await app.invoke("tasks.get", before.taskId);
  return !t.ptyId ? t : null;
 }, 20000);
 assert.equal(task.nativeSessionId, before.nativeId);
 result.stopReplay.oldRun = await app.mainEvaluate(
  `(()=>{const g=globalThis.__m11GatewayProbe;return g.service.store.sqlite.prepare('SELECT state,revocation_state,ended_at,pid FROM capability_runs WHERE run_id=?').get(${JSON.stringify(before.plan.runId)})})()`,
  { label: "m11-stopped-run-read", synchronous: true },
 );
 assert.equal(result.stopReplay.oldRun.state, "stopped");
 assert.equal(result.stopReplay.oldRun.revocation_state, "revoked");
 assert(result.stopReplay.oldRun.ended_at);
 const oldPid = before.run.pid;
 await poll(async () => {
  try {
   process.kill(oldPid, 0);
   return false;
  } catch (e) {
   if (e.code === "ESRCH") return true;
   throw e;
  }
 }, 5000);
 result.stopReplay.originalCliGone = true;
 result.stopReplay.stoppedReplay = await replayM11OutsideManagedTree(
  app,
  before.plan.runId,
  home,
 );
 assert.equal(result.stopReplay.stoppedReplay.error, "AUTH_REQUIRED");
 assert.equal(result.providerReads, before.providerReads);
 await app.screenshot(join(root, "after-actual-ui-stop.png"));
 result.fixtureTurn = (result.fixtureTurn ?? 0) + 1;
 result.issuedTools = [];
 result.nativeToolOutputs = null;
 result.runPlan = null;
 result.skillOutput = null;
 stage = "actual-ui-resume-after-stop";
 await progress();
 await click("[data-testid=task-actions]");
 await app.waitFor(
  '!!document.querySelector("[data-testid=task-header-resume]")',
  5000,
 );
 await click("[data-testid=task-header-resume]");
 task = await poll(async () => {
  const t = await app.invoke("tasks.get", before.taskId);
  return t.ptyId ? t : null;
 }, 25000);
 assert.equal(task.nativeSessionId, before.nativeId);
 assert.notEqual(task.ptyId, before.ptyId);
 await poll(
  async () => (await app.output(task.ptyId)).includes("OpenAI Codex"),
  20000,
 );
 await click(".xterm-screen");
 await app.waitFor(
  "document.activeElement?.classList.contains('xterm-helper-textarea')",
  5000,
 );
 const message =
  marker +
  "_AFTER_UI_STOP: Read current bug-analysis Skill and query my Bug list exactly once using its declared CLI. Return " +
  marker +
  "_DONE.";
 await app.cdp("Input.insertText", { text: message });
 await app.waitFor(
  `document.body.innerText.includes(${JSON.stringify(marker + "_AFTER_UI_STOP")})`,
  5000,
 );
 await new Promise((resolve) => setTimeout(resolve, 400));
 await key("Enter", "Enter", 13);
 await poll(
  async () => !!currentCapabilityResult(result.nativeToolOutputs),
  45000,
 );
 const actual = currentCapabilityResult(result.nativeToolOutputs),
  plan = await readRunPlan();
 assert.equal(actual.operation.origin, "cli");
 assert.equal(actual.data.items[0].id, "79291");
 assert.notEqual(plan.runId, before.plan.runId);
 assert.deepEqual(plan.allowed, before.plan.allowed);
 assert.equal(result.providerReads, before.providerReads + 2);
 assert.notEqual(actual.operation.id, before.actual.operation.id);
 result.stopReplay.operationRun = await requireOperationRun(actual, plan);
 const gateway = await m11GatewaySnapshot(app),
  old = before.gateway.tokens.find((t) => t.runId === before.plan.runId),
  fresh = gateway.tokens.find((t) => t.runId === plan.runId);
 assert(fresh);
 assert.notEqual(fresh.tokenSha256, old.tokenSha256);
 result.stopReplay.after = {
  taskId: task.id,
  nativeId: task.nativeSessionId,
  ptyId: task.ptyId,
  plan,
  actual,
  gateway,
 };
 result.stopReplay.oldAfterNewRun = await replayM11OutsideManagedTree(
  app,
  before.plan.runId,
  home,
 );
 assert.equal(result.stopReplay.oldAfterNewRun.error, "AUTH_REQUIRED");
 assert.equal(result.providerReads, before.providerReads + 2);
 await app.screenshot(join(root, "after-ui-stop-new-run-cli.png"));
 checked(
  "T07 UI-stop subcoverage: original CLI process/run ends, original token refuses before and after fresh UI-resumed run; fresh token differs and only current allowed CLI read executes",
 );
}
async function runNormalRestart() {
 const dbRead = (expression) =>
  app.mainEvaluate(
   `(()=>{const req=process.getBuiltinModule('module').createRequire(process.resourcesPath+'/app.asar/package.json');const DB=req('better-sqlite3'),db=new DB(${JSON.stringify(join(userData, "smartdd.db"))},{readonly:true});try{return ${expression}}finally{db.close()}})()`,
  );
 const pointer = () =>
  dbRead(
   `db.prepare('SELECT snapshot_hash,snapshot_json FROM capability_session_snapshots WHERE task_id=?').get(${JSON.stringify(task.id)})`,
  ).then((row) => ({
   snapshotHash: row.snapshot_hash,
   rawHash: sha(row.snapshot_json),
  }));
 const profileFields = (p) =>
  Object.fromEntries(
   ["name", "runner", "executable", "args", "env", "isDefault"].map((k) => [
    k,
    p[k],
   ]),
  );
 const projectFields = (p) =>
  Object.fromEntries(
   ["projectId", "appId", "enabled", "revision", "connections"].map((k) => [
    k,
    p[k],
   ]),
  );
 const business = (text) => {
  const value = parseToml(text);
  delete value.tui;
  delete value.notice;
  return value;
 };
 stage = "restart-wait-native-id";
 await progress();
 task = await poll(async () => {
  const value = await app.invoke("tasks.get", task.id);
  return value.nativeSessionId ? value : null;
 }, 20000);
 const names = await readdir(join(state, "sessions"), { recursive: true }),
  nativeFiles = names.filter((n) =>
   n.endsWith("-" + task.nativeSessionId + ".jsonl"),
  );
 assert.equal(nativeFiles.length, 1);
 const file = join(state, "sessions", nativeFiles[0]);
 assert((await stat(file)).size < 8 * 1024 * 1024);
 await poll(async () => {
  const lines = (await readFile(file, "utf8")).split("\n");
  return lines.some((line) => {
   try {
    const v = JSON.parse(line);
    return (
     v.type === "response_item" &&
     v.payload?.role === "assistant" &&
     JSON.stringify(v.payload.content).includes(marker + "_DONE")
    );
   } catch {
    return false;
   }
  });
 }, 15000);
 const oldRun = await dbRead(
  `db.prepare('SELECT run_id,pid,state,revocation_state FROM capability_runs WHERE task_id=? ORDER BY started_at DESC LIMIT 1').get(${JSON.stringify(task.id)})`,
 );
 const before = {
  taskId: task.id,
  nativeId: task.nativeSessionId,
  ptyId: task.ptyId,
  appPid: app.processId,
  run: oldRun,
  plan: result.runPlan,
  pointer: await pointer(),
  profile: profileFields(await app.invoke("aiProfiles.get", profile.id)),
  project: projectFields(
   (await app.invoke("applications.projectSettings", project.id, "zentao"))
    .value,
  ),
  baseConfig: business(await readFile(join(state, "config.toml"), "utf8")),
  namedConfig: business(
   await readFile(join(state, "m11-native.config.toml"), "utf8"),
  ),
  actualCapabilityResult: result.actualCapabilityResult,
 };
 result.restart = {
  before,
  normalQuitTrigger: restartHost
   ? "I-layer scheduled App.quit with one owned running-task-dialog response fixture; native quit UI remains pending"
   : "AX menu quit + confirmation dialog by external native performer",
 };
 assert(before.nativeId);
 assert.equal(oldRun.state, "active");
 assert(oldRun.pid > 0);
 result.cipherRestoredBeforeNormalQuit = await app.mainEvaluate(
  "globalThis.__m11CipherRestore?.()",
 );
 assert.equal(result.cipherRestoredBeforeNormalQuit, true);
 result.nativeQuitExpectedTitle =
  "A · M11 NORMAL QUIT · " + root.split("-").at(-1);
 await app.evaluate(
  `document.title=${JSON.stringify(result.nativeQuitExpectedTitle)};true`,
 );
 stage = "await-native-quit";
 await progress();
 await app.screenshot(join(root, "before-normal-quit.png"));
 if (restartHost) {
  stage = "host-quit-response-fixture";
  await progress();
  const receipt = join(root, "host-quit-response-fixture.json");
  result.restart.fixturePreflight = await app.mainEvaluate(
   `(()=>{let step='require';try{const E=process.getBuiltinModule('module').createRequire(process.resourcesPath+'/app.asar/package.json')('electron');step='ownership';const own=E.app.getPath('userData')===${JSON.stringify(userData)},windows=E.BrowserWindow.getAllWindows().map(w=>({visible:w.isVisible(),scheme:w.webContents.getURL().split(':')[0]}));if(!own||windows.filter(w=>w.visible&&w.scheme==='file').length!==1)return{ok:false,step,own,windows};step='install';const previous=E.dialog.showMessageBoxSync;E.dialog.showMessageBoxSync=function(options){if(options.message!=='有 1 个任务正在运行')return previous.call(E.dialog,options);E.dialog.showMessageBoxSync=previous;process.getBuiltinModule('fs').writeFileSync(${JSON.stringify(receipt)},JSON.stringify({layer:'I-only response fixture',ownUserData:${JSON.stringify(userData)},dialogMessage:options.message,simulatedResponse:0,originalRestored:E.dialog.showMessageBoxSync===previous,nativeUiClaim:false})+'\\n');return 0;};globalThis.__m11HostQuit=()=>{delete globalThis.__m11HostQuit;setTimeout(()=>E.app.quit(),100);return true};return{ok:true,own,windows}}catch(e){return{ok:false,step,errorClass:e.constructor.name}}})()`,
   { label: "restart-host-fixture-install", synchronous: true },
  );
  assert.equal(
   result.restart.fixturePreflight.ok,
   true,
   JSON.stringify(result.restart.fixturePreflight),
  );
  await app.mainEvaluate("globalThis.__m11HostQuit()", {
   label: "restart-host-fixture-trigger",
   synchronous: true,
  });
 }
 const original = app;
 result.restart.normalExit = await original.waitForExit(60000);
 assert.equal(result.restart.normalExit.code, 0);
 assert.equal(result.restart.normalExit.signal, null);
 await writeFile(
  join(root, "electron-before-normal-quit.txt"),
  original.logs(),
 );
 await original.close();
 app = null;
 if (restartHost) {
  const probe = JSON.parse(
   await readFile(join(root, "host-quit-response-fixture.json"), "utf8"),
  );
  assert.equal(probe.originalRestored, true);
  assert.equal(probe.ownUserData, userData);
  result.restart.responseFixture = probe;
 }
 await poll(async () => {
  try {
   process.kill(oldRun.pid, 0);
   return false;
  } catch (error) {
   if (error.code === "ESRCH") return true;
   throw error;
  }
 }, 5000);
 result.restart.originalCliGone = true;
 const unauth = spawnSync(
  join(appRoot, "Contents/Resources/native/willyou-app"),
  ["zentao", "object", "list", "--kind", "bug"],
  { env: privateEnv, encoding: "utf8", timeout: 5000 },
 );
 assert.equal(unauth.status, 3);
 assert.equal(JSON.parse(unauth.stdout).error.code, "AUTH_REQUIRED");
 result.restart.externalCli = {
  status: unauth.status,
  stdout: unauth.stdout,
  stderr: unauth.stderr,
 };
 stage = "restart-open";
 await progress();
 app = await openElectron({
  executable,
  userData,
  cwd,
  env: privateEnv,
  inspectMain: true,
 });
 result.restart.afterAppPid = app.processId;
 await app.mainEvaluate(
  `(()=>{const E=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');if(E.app.getPath('userData')!==${JSON.stringify(userData)})throw Error('Own restart only');const originals=['isEncryptionAvailable','encryptString','decryptString'].map(k=>[k,E.safeStorage[k]]);E.safeStorage.isEncryptionAvailable=()=>true;E.safeStorage.encryptString=s=>Buffer.from([...s].reverse().join(''));E.safeStorage.decryptString=b=>[...b.toString()].reverse().join('');globalThis.__m11CipherRestore=()=>{for(const[k,f]of originals)E.safeStorage[k]=f;delete globalThis.__m11CipherRestore;return true};return true})()`,
 );
 assert.deepEqual(
  profileFields(await app.invoke("aiProfiles.get", profile.id)),
  before.profile,
 );
 assert.deepEqual(
  projectFields(
   (await app.invoke("applications.projectSettings", project.id, "zentao"))
    .value,
  ),
  before.project,
 );
 assert.deepEqual(await pointer(), before.pointer);
 const stopped = await dbRead(
  `db.prepare('SELECT state,revocation_state,ended_at FROM capability_runs WHERE run_id=?').get(${JSON.stringify(oldRun.run_id)})`,
 );
 assert.equal(stopped.state, "stopped");
 assert.equal(stopped.revocation_state, "revoked");
 assert(stopped.ended_at);
 result.restart.oldRunAfterNormalQuit = stopped;
 result.fixtureTurn = (result.fixtureTurn ?? 0) + 1;
 result.issuedTools = [];
 result.nativeToolOutputs = null;
 result.runPlan = null;
 result.skillOutput = null;
 await app.evaluate(
  `window.__m5={output:{},exits:{}};window.electronAPI.eventOn('pty:data',e=>{window.__m5.output[e.ptyId]=(window.__m5.output[e.ptyId]||'')+e.data});window.electronAPI.eventOn('pty:exit',e=>{window.__m5.exits[e.ptyId]=e.code});document.title='A · M11 RESTORED · '+${JSON.stringify(root.split("-").at(-1))};true`,
 );
 await app.waitFor(
  '!!document.querySelector("[data-testid=sidebar-task]")',
  15000,
 );
 await focusNewInstalledWindow(app, userData, result);
 installAppFocusGuard(app, result);
 stage = "restart-ui-resume";
 await progress();
 await click("[data-testid=sidebar-task]");
 const opened = await poll(async () => {
  const value = await app.invoke("tasks.get", task.id);
  if (value.ptyId) return { task: value };
  const ready = await app.evaluate(
   '!!document.querySelector("[data-testid=task-resume]:not(:disabled)")&&!document.querySelector("[data-testid=task-resuming]")',
  );
  return ready ? { manual: true } : null;
 }, 20000);
 if (opened.manual) {
  await click("[data-testid=task-resume]");
  result.restart.resumeTrigger = "actual sidebar selection then resume button";
 } else
  result.restart.resumeTrigger =
   "actual sidebar selection with automatic resume";
 task = await poll(async () => {
  const value = await app.invoke("tasks.get", before.taskId);
  return value.ptyId ? value : null;
 }, 30000);
 assert.equal(task.nativeSessionId, before.nativeId);
 assert.notEqual(task.ptyId, before.ptyId);
 await app.waitFor('!!document.querySelector(".xterm-screen")', 15000);
 await poll(
  async () => (await app.output(task.ptyId)).includes("OpenAI Codex"),
  20000,
 );
 stage = "restart-ui-new-read";
 await progress();
 await click(".xterm-screen");
 await app.waitFor(
  "document.activeElement?.classList.contains('xterm-helper-textarea')",
  10000,
 );
 const message =
  marker +
  "_AFTER_NORMAL_RESTART: Read the current bug-analysis Skill and query my Bug list exactly once using its declared CLI. Do not change anything. Return " +
  marker +
  "_DONE.";
 await app.cdp("Input.insertText", { text: message });
 await app.waitFor(
  `document.body.innerText.includes(${JSON.stringify(marker + "_AFTER_NORMAL_RESTART")})`,
  5000,
 );
 await new Promise((resolve) => setTimeout(resolve, 400));
 result.restart.inputSettlement = {
  boundary:
   "Codex terminal paste burst settlement; matches existing adapter-version-ui 400ms before Enter",
  milliseconds: 400,
 };
 await key("Enter", "Enter", 13);
 await poll(
  async () => !!currentCapabilityResult(result.nativeToolOutputs),
  45000,
 );
 const actual = currentCapabilityResult(result.nativeToolOutputs);
 assert.equal(actual.operation.origin, "cli");
 assert.equal(actual.data.items[0].id, "79291");
 assert.equal(actual.source.connections[0].connectionId, result.connectionId);
 const current = await readRunPlan();
 assert.notEqual(
  actual.operation.id,
  before.actualCapabilityResult.operation.id,
 );
 result.restart.operationRun = await requireOperationRun(actual, current);
 assert.notEqual(current.runId, before.plan.runId);
 assert.deepEqual(current.allowed, before.plan.allowed);
 assert.deepEqual(await pointer(), before.pointer);
 assert.equal(
  (await app.invoke("tasks.list", { includeArchived: true })).length,
  1,
 );
 assert.deepEqual(
  business(await readFile(join(state, "config.toml"), "utf8")),
  before.baseConfig,
 );
 assert.deepEqual(
  business(await readFile(join(state, "m11-native.config.toml"), "utf8")),
  before.namedConfig,
 );
 result.restart.after = {
  taskId: task.id,
  nativeId: task.nativeSessionId,
  ptyId: task.ptyId,
  runId: current.runId,
  pointer: await pointer(),
  actualCapabilityResult: actual,
  allowed: current.allowed,
 };
 await app.screenshot(join(root, "after-normal-restart-read.png"));
 checked(
  restartHost
   ? "I-layer App.quit fixture drained original CLI/run; actual UI resume/CLI and persistence passed, native quit UI still pending"
   : "Normal native App quit drained original CLI/run; same persistent Task/profile/config/fixed permissions resumed through UI and actual Codex CLI; bare external CLI rejected",
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
  ...(revocation
   ? {
      startupMainHook: (info) =>
       captureBudgetService({
        ...info,
        target: "history",
        mainFile: join(
         appRoot,
         "Contents/Resources/app.asar/out/main/index.js",
        ),
        checkpoint: join(root, "gateway-startup-capture.json"),
       }),
     }
   : {}),
 });
 result.pid = app.processId;
 if (revocation)
  result.gatewayFixture = await installM11GatewayProbe(app, userData);
 await app.evaluate(`document.title='A · M11 S7 · Codex CLI 禅道只读';true`);
 stage = "prerequisites";
 await progress();
 if (scopeDenial) {
  const b = await app.invoke("projects.create", {
   name: "M11 外部B边界项目",
   aliases: [],
   description: "Foreign B prerequisite",
   rulesPath: null,
  });
  result.scope = { foreignProjectId: b.id, providerCountsAfterDenials: [] };
 }
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
 await app.mainEvaluate(
  `(()=>{const E=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');if(E.app.getPath('userData')!==${JSON.stringify(userData)})throw Error('Own instance only');const originals=['isEncryptionAvailable','encryptString','decryptString'].map(k=>[k,E.safeStorage[k]]);E.safeStorage.isEncryptionAvailable=()=>true;E.safeStorage.encryptString=s=>Buffer.from([...s].reverse().join(''));E.safeStorage.decryptString=b=>[...b.toString()].reverse().join('');globalThis.__m11CipherRestore=()=>{for(const[k,f]of originals)E.safeStorage[k]=f;delete globalThis.__m11CipherRestore;return originals.every(([k,f])=>E.safeStorage[k]===f)};return true})()`,
 );
 result.isolation.cipher =
  "process-local reversible synthetic fixture; no Keychain/security-storage acceptance; restored before close";
 const catalog = await app.invoke("applications.catalog");
 assert(catalog.ok);
 const zentao = catalog.value.find((x) => x.appId === "zentao");
 assert.equal(zentao.version, "1.1.0");
 assert(
  (await app.invoke("applications.setAdded", "zentao", true, zentao.revision))
   .ok,
 );
 const tested = await app.invoke("applications.testConnection", {
  name: "Synthetic CLI ZenTao",
  expectedRevision: 0,
  config: {
   kind: "zentao",
   baseUrl: process.env.WILLYOU_ZEN_BASE ?? "http://127.0.0.1:" + port + "/zt/",
   username: process.env.WILLYOU_ZEN_USER ?? "tester",
   authMode: "token",
  },
  secret: process.env.WILLYOU_ZEN_SECRET ?? "M11_SYNTHETIC_ZT",
 });
 assert(tested.ok, tested.message);
 const saved = await app.invoke(
  "applications.saveConnection",
  "zentao",
  tested.value.operationId,
  tested.value.candidateHash,
 );
 assert(saved.ok, saved.message);
 result.connectionId = saved.value.id;
 if (scopeDenial) {
  const testedB = await app.invoke("applications.testConnection", {
   name: "Foreign B synthetic ZenTao",
   expectedRevision: 0,
   config: {
    kind: "zentao",
    baseUrl: "http://127.0.0.1:" + port + "/zt/b/",
    username: "tester-b",
    authMode: "token",
   },
   secret: "M11_SYNTHETIC_ZT",
  });
  assert(testedB.ok, testedB.message);
  const b = await app.invoke(
   "applications.saveConnection",
   "zentao",
   testedB.value.operationId,
   testedB.value.candidateHash,
  );
  assert(b.ok, b.message);
  result.scope.foreignConnectionId = b.value.id;
  assert(
   (
    await app.invoke("applications.select", {
     projectId: result.scope.foreignProjectId,
     appId: "zentao",
     enabled: true,
     expectedRevision: 0,
     connections: { zentao: b.value.id },
    })
   ).ok,
  );
  const base = "willyou-app zentao object list --json ";
  result.scope.requests = [
   {
    claim: "foreign project in business arguments",
    code: "INVALID_INPUT",
    command:
     base +
     shellQuote(
      JSON.stringify({ kind: "bug", projectId: result.scope.foreignProjectId }),
     ),
   },
   {
    claim: "genuine B connection in business arguments",
    code: "SCOPE_DENIED",
    command:
     base +
     shellQuote(JSON.stringify({ kind: "bug", connectionId: b.value.id })),
   },
   {
    claim: "self-reported approval",
    code: "INVALID_INPUT",
    command: base + shellQuote(JSON.stringify({ kind: "bug", approved: true })),
   },
   {
    claim: "extra undeclared write command",
    code: "SCOPE_DENIED",
    command: "willyou-app zentao object update --id 79291",
   },
   {
    claim: "reserved project identity flag",
    code: "INVALID_INPUT",
    command:
     "willyou-app zentao object list --kind bug --project-id " +
     shellQuote(result.scope.foreignProjectId),
   },
  ];
 }
 assert(
  (
   await app.invoke("applications.select", {
    projectId: project.id,
    appId: "zentao",
    enabled: true,
    expectedRevision: 0,
    connections: { zentao: saved.value.id },
   })
  ).ok,
 );
 const args = [
  ...(unknown ? [] : ["--profile", "m11-native"]),
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
  "--ask-for-approval",
  "never",
 ];
 profile = await app.invoke("aiProfiles.create", {
  name: "M11 私有 Codex 0.166.0",
  runner: "codex",
  executable: profileCommand,
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
 await app.evaluate(`document.title='A · M11 S7 · Codex CLI 禅道只读';true`);
 if (scopeDenial) {
  await app.waitFor("!!document.querySelector('[data-testid=home-project]')");
  await focusNewInstalledWindow(app, userData, result);
  installAppFocusGuard(app, result);
  await click("[data-testid=home-project]");
  await app.waitFor(
   "[...document.querySelectorAll('[role=option]')].some(e=>e.textContent.trim()==='M11 原生 CLI 隔离项目')",
  );
  await click("[role=option]", "M11 原生 CLI 隔离项目");
 }
 await app.waitFor(
  `document.querySelector('[data-testid=home-project]')?.textContent.includes('M11 原生 CLI 隔离项目')&&document.querySelector('[data-testid=home-profile]')?.textContent.includes('M11 私有 Codex')`,
  15000,
 );
 await app.evaluate(
  `window.__m5={output:{},exits:{}};window.electronAPI.eventOn('pty:data',e=>{window.__m5.output[e.ptyId]=(window.__m5.output[e.ptyId]||'')+e.data});window.electronAPI.eventOn('pty:exit',e=>{window.__m5.exits[e.ptyId]=e.code});true`,
 );
 const prompt =
  marker +
  ": Read the current project bug-analysis Skill, then query the assigned Bug list exactly once using its declared " +
  (unknown ? "MCP fallback tool" : "CLI command") +
  ". Do not update or send anything. Return " +
  marker +
  "_DONE when finished.";
 stage = "waiting-initial-foreground";
 await progress();
 if (!scopeDenial) {
  await focusNewInstalledWindow(app, userData, result);
  installAppFocusGuard(app, result);
 }
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
  ); // The prompt itself contains marker_DONE and is echoed by the terminal; completion requires the real CLI output returned to the model.
  const done =
   result.requests.some((r) => r.kind === "ui-task") &&
   (result.nativeToolOutputs ?? []).some(
    (v) => v.type === "function_call_output",
   ) &&
   !!currentCapabilityResult(result.nativeToolOutputs) &&
   (!cliLoss || result.cliLossOutputs?.length === 1);
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
 assert.equal(result.issuedTools.length, scopeDenial ? 7 : cliLoss ? 3 : 2);
 const value = currentCapabilityResult(result.nativeToolOutputs);
 assert(value, "Actual native CLI did not return a v2 result");
 assert.equal(value.capabilityId, "zentao.object.list");
 assert.equal(value.contractMajor, 2);
 assert.equal(value.operation.origin, unknown ? "mcp" : "cli");
 assert.equal(value.operation.effectState, "read-only");
 assert.equal(value.data.items[0].id, "79291");
 assert.equal(value.source.connections[0].connectionId, result.connectionId);
 result.actualCapabilityResult = value;
 const usage = await poll(async () => {
  const d = await app.invoke("applications.session", task.id);
  return d.ok &&
   d.value.applications.some(
    (a) => a.appId === "zentao" && a.evidence.successfulToolRequests >= 1,
   )
   ? d.value
   : null;
 });
 result.sessionAfterTool = usage;
 assert.equal(
  usage.currentRun.preparation.cliVersion,
  unknown ? "99.0.0" : "0.166.0",
 );
 // M11-R1-D04: with L2 declared for 0.166.0, diagnostics must recognise the per-run Skill the Agent actually read.
 if (!unknown) {
  assert.match(
   JSON.stringify(result.skillOutput),
   /willyou-app zentao object list/,
  );
  assert.doesNotMatch(
   JSON.stringify(result.skillOutput),
   /smartdd_zentao_work_list_v2/,
  );
  const evidence = await poll(async () => {
   const d = await app.invoke("applications.session", task.id);
   const z = d.ok && d.value.applications.find((a) => a.appId === "zentao");
   return z &&
    z.evidence.skillDiscovery === "verified" &&
    z.evidence.skillReadObservations?.some((o) => o.skillId === "bug-analysis")
    ? z.evidence
    : null;
  }, 30000);
  result.skillEvidence = evidence;
  assert.equal(evidence.skillReadObservations?.[0]?.skillId, "bug-analysis");
  assert.notEqual(
   evidence.skillRead,
   "verified",
   "story-review was not read, so the app-level read must stay unverified",
  );
  checked(
   "Session diagnostics verified native catalog discovery of both Skills and the bug-analysis read of this run (L2, per-run Skill names); app-level read stays unverified because story-review was not read",
  );
  checked(
   "Actual Codex read the delivered CLI Skill and executed the packaged native CLI through kernel peer verification and real ZenTao provider; synthetic HTTP data only",
  );
  assert.equal(result.runPlan.sandbox.source, "inherited-named-permissions");
  checked(
   "CLI was selected from a named user permission profile with a fixed run plan; user policy was inherited",
  );
 } else {
  const appEvidence = usage.applications.find(
   (a) => a.appId === "zentao",
  ).evidence;
  assert.equal(appEvidence.skillDiscovery, "unverified");
  assert.equal(appEvidence.skillRead, "unverified");
  assert.equal(result.runPlan.grades.cli, false);
  assert.equal(result.runPlan.sandbox.source, "unchanged-user-policy");
  assert.equal(usage.currentRun.runPlan.verified, false);
  assert.equal(usage.currentRun.runPlan.nativeSendEvidence, false);
  assert.match(
   JSON.stringify(result.skillOutput),
   /smartdd_zentao_work_list_v2/,
  );
  assert.doesNotMatch(
   JSON.stringify(result.skillOutput),
   /willyou-app zentao object list/,
  );
  result.skillEvidence = appEvidence;
  checked(
   "Controlled99 version uses the actual MCP fallback and its SOP; CLI grant, L2 and L3 remain closed",
  );
 }
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
 // M11 S8: real UI opens the session applications dialog; the fixed run plan must match the recorded plan.
 const planState = () =>
  app.evaluate(
   `(()=>{const s=document.querySelector('[aria-label="本次运行计划"]');if(!s)return null;return{text:s.innerText,levels:[...s.querySelectorAll('.m10-level-list li')].map(li=>({level:li.querySelector('code')?.textContent,state:li.getAttribute('data-state')})),theme:document.documentElement.classList.contains('ydark')?'ydark':document.documentElement.classList.contains('ylight')?'ylight':null};})()`,
  );
 const openPlan = async (label) => {
  stage = "s8-plan-" + label;
  await progress();
  await click("[data-testid=task-applications]");
  const value = await poll(planState, 20000);
  await app.screenshot(join(root, "s8-run-plan-" + label + ".png"));
  await app.cdp("Input.dispatchKeyEvent", {
   type: "keyDown",
   key: "Escape",
   code: "Escape",
   windowsVirtualKeyCode: 27,
  });
  await app.cdp("Input.dispatchKeyEvent", {
   type: "keyUp",
   key: "Escape",
   code: "Escape",
   windowsVirtualKeyCode: 27,
  });
  await poll(
   async () =>
    !(await app.evaluate('Boolean(document.querySelector("dialog[open]"))')),
   10000,
  );
  return value;
 };
 const expectPlan = (value) => {
  if (unknown) {
   assert.deepEqual(
    value.levels,
    ["L0.skill", "L0.mcp", "L0.cli", "L1", "L2", "L3"].map((level) => ({
     level,
     state:
      level === "L0.skill" || level === "L0.mcp" ? "best-effort" : "unverified",
    })),
   );
   assert.match(value.text, /Codex 99\.0\.0 · 未声明版本/);
   assert.match(value.text, /生效入口 · MCP/);
   assert.match(value.text, /发送使用页面授权/);
   assert.doesNotMatch(value.text, /生效入口 · CLI/);
   return;
  }
  assert.deepEqual(
   value.levels,
   ["L0.skill", "L0.mcp", "L0.cli", "L1", "L2", "L3"].map((level) => ({
    level,
    state: level === "L3" ? "unverified" : "declared",
   })),
  );
  assert.match(value.text, /Codex 0\.166\.0 · 已声明版本/);
  assert.match(value.text, /生效入口 · CLI/);
  assert.match(value.text, /聊天原话授权在此版本上尚未验证/);
  assert.match(value.text, /发送使用页面授权/);
  assert.doesNotMatch(
   value.text,
   /聊天原话授权与「已确认读取 Skill」在此版本上尚未验证/,
  );
 };
 const setTheme = async (value) => {
  await app.invoke("appSettings.update", "theme", value);
  const origin = await app.evaluate("performance.timeOrigin");
  await app.cdp("Page.reload");
  await app.waitFor(
   `performance.timeOrigin!==${origin}&&document.readyState==='complete'&&!!document.querySelector('[data-testid=sidebar-task]')`,
   20000,
   { navigation: true },
  );
  await click("[data-testid=sidebar-task]");
  await poll(
   () =>
    app.evaluate(
     'Boolean(document.querySelector("[data-testid=task-applications]"))',
    ),
   20000,
  );
 };
 if (cliLoss || scopeDenial || appRestart || revocation) {
  const current = await openPlan(
   cliLoss
    ? "after-loss"
    : scopeDenial
      ? "after-scope-denials"
      : "before-restart",
  );
  expectPlan(current);
  result.s8RunPlan = { current };
 } else {
  await setTheme("ylight");
  const light = await openPlan("light");
  assert.equal(light.theme, "ylight");
  expectPlan(light);
  await setTheme("ydark");
  const dark = await openPlan("dark");
  assert.equal(dark.theme, "ydark");
  expectPlan(dark);
  result.s8RunPlan = { light, dark };
  checked(
   unknown
    ? "S8 actual dialog shows best-effort Skill/MCP only, all higher levels unverified, MCP fallback and page-auth note in both themes"
    : "S8 session dialog shows the fixed run plan: six levels (L0-L2 declared, L3 unverified), CLI entry and page-authorization note, in light and dark themes via real UI",
  );
 }
 if (cliLoss) {
  const failed = JSON.stringify(result.cliLossOutputs);
  assert.match(failed, /CONNECTION_UNAVAILABLE/);
  assert.doesNotMatch(failed, /willyou-app-result-v2/);
  const after = await readRunPlan();
  assert.equal(after.planHash, result.runPlan.planHash);
  assert.equal(
   after.applications.find((a) => a.appId === "zentao").effectiveEntry,
   "cli",
  );
  assert.equal(usage.currentRun.preparation.cliVersion, "0.166.0");
  assert.equal(result.requests.filter((r) => r.kind === "ui-task").length, 4);
  assert.equal(
   result.providerReads,
   result.providerReadsBeforeLoss,
   "failed CLI must not fall back/reissue any provider request",
  );
  result.cliLoss = {
   kind: "per-command endpoint replaced with a nonexistent path",
   scope:
    "only faulting exec command environment; App/host/snapshot bytes unchanged",
   restored: "command-local env discarded on exit",
   fixedPlanUnchanged: true,
   automaticFallbackRequests: 0,
   providerReads: result.providerReads,
  };
  checked(
   "Runtime CLI transport failure preserves the CLI run plan; no fallback or business reissue, fault scoped to one command",
  );
 }
 if (scopeDenial) {
  assert.equal(result.scope.providerCountsAfterDenials.length, 5);
  for (const item of result.scope.providerCountsAfterDenials)
   assert.equal(
    item.providerReads,
    result.scope.providerReadsBeforeDenials,
    "denied claim must not reach either provider",
   );
  for (let i = 0; i < 5; i++) {
   const outputs = result.outputsByStep[i + 1];
   assert.equal(outputs.length, 1);
   assert.match(
    JSON.stringify(outputs),
    new RegExp(result.scope.requests[i].code),
   );
   assert.doesNotMatch(JSON.stringify(outputs), /willyou-app-result-v2/);
  }
  assert.equal(
   result.providerReads,
   result.scope.providerReadsBeforeDenials + 2,
   "only final legal A identity+Bug HTTP calls",
  );
  assert.equal(
   result.providerPaths.filter((p) => p.includes("/zt/b/")).length,
   1,
   "B connection test only; no B business request",
  );
  result.scope.deniedBeforeProvider = true;
  result.scope.legalAAfterDenials = true;
  checked(
   "Five foreign project/connection/extra-action/self-approval claims rejected before provider; final legal A CLI read still succeeds",
  );
 }
 if (appRestart) await runNormalRestart();
 if (stopReplay) await runStopReplay();
 if (gatewayEvidence) await runGatewayEvidence();
 if (permissionReplay) await runPermissionReplay();
 assert.deepEqual(app.rendererErrors, []);
 result.status = unknown
  ? "passed-zentao-mcp-fallback-mainchain"
  : cliLoss
    ? "passed-zentao-cli-loss-fixed-plan"
    : scopeDenial
      ? "passed-zentao-scope-denials"
      : gatewayEvidence
        ? "passed-gateway-evidence-matrix"
        : permissionReplay
          ? "passed-" + mode + "-subcoverage"
          : stopReplay
            ? "passed-ui-stop-replay-subcoverage"
            : appRestart
              ? restartHost
               ? "passed-host-lifecycle-restart-native-ui-pending"
               : "passed-normal-app-restart"
              : "passed-zentao-cli-mainchain";
} catch (error) {
 result.status = isAppFocusYield(error) ? "deferred-focus-loss" : "failed";
 result.failedStage = stage;
 result.error = String(error);
 result.stack = error.stack;
 process.exitCode = isAppFocusYield(error) ? 2 : 1;
 if (app)
  try {
   try {
    await restoreGatewayFixture();
   } catch (e) {
    result.gatewayRestoreError = String(e);
   }
   try {
    result.cipherRestored = await app.mainEvaluate(
     "globalThis.__m11CipherRestore?.()",
    );
    result.cipherRestoredBeforeExitProbe = true;
   } catch (e) {
    result.cipherRestoreError = String(e);
   }
   result.exitBeforeCleanup = await app
    .waitForExit(1)
    .catch(() => ({ stillRunning: true }));
   if (task?.id)
    result.failureSession = await app.invoke("applications.session", task.id);
   result.dom = await app.evaluate("document.body.innerText");
   result.ptyCapture = await app
    .evaluate("JSON.parse(JSON.stringify(window.__m5||null))")
    .catch((e) => ({ error: String(e) }));
   if (result.ptyCapture?.output)
    for (const [id, text] of Object.entries(result.ptyCapture.output))
     await writeFile(join(root, "pty-" + id + ".txt"), text);
   if (task?.ptyId)
    await writeFile(
     join(root, "terminal-failure.txt"),
     await app.output(task.ptyId),
    );
   await app.screenshot(join(root, "failure.png"));
  } catch {}
} finally {
 if (app) {
  try {
   await restoreGatewayFixture();
  } catch (error) {
   result.gatewayRestoreError = String(error);
  }
  if (!result.cipherRestoredBeforeExitProbe)
   try {
    result.cipherRestored = await app.mainEvaluate(
     "globalThis.__m11CipherRestore?.()",
    );
   } catch (error) {
    result.cipherRestoreError = String(error);
   }
  for (const id of new Set(
   [task?.id, ...(result.additionalTaskIds ?? [])].filter(Boolean),
  ))
   try {
    (result.cleanupTasks ??= []).push({
     id,
     receipt: await app.invoke("tasks.kill", id),
    });
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
  "/private/tmp/willyou-m11-s7-native-codex-latest-result.txt",
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
