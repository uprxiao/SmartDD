// M11 T37: entry isolation. One project selects a CLI-effective application (zentao) and an
// MCP-effective one (mail); two real packaged sessions share the same data root. Records the run
// plan's per-application entries, the tools actually delivered to Codex, and the exact rejection
// observed when a foreign entry is attempted. Layer A with a loopback synthetic model; no real
// model reasoning and no external service.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
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

const root = await mkdtemp("/private/tmp/willyou-m11-t37-");
const home = join(root, "home");
const state = join(root, "codex");
const cwd = join(root, "project");
const userData = join(root, "userdata");
const executable = process.env.WILLYOU_ACCEPTANCE_APP;
const cli = process.env.WILLYOU_CODEX_CLI;
assert(executable && cli, "Set WILLYOU_ACCEPTANCE_APP and WILLYOU_CODEX_CLI");
const appRoot = resolve(dirname(executable), "../..");
assert(/^\/private\/tmp\/willyou-m11-(s[47]|t13-terminal|t37)/.test(appRoot));
assert(
  /^[a-f0-9]{64}$/.test(process.env.WILLYOU_TEST_SOURCE_MANIFEST_SHA ?? ""),
);
const sha = (b) => createHash("sha256").update(b).digest("hex");
const marker = "M11_T37_ENTRY_" + root.split("-").at(-1);
const result = {
  schema: "m11-t37-entry-isolation-v1",
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
    "A: real packaged App sessions sharing one data root; loopback synthetic model chooses the foreign tool call; rejection text comes from the actual native path",
  isolation: {
    freshHome: true,
    freshCodexHome: true,
    freshUserData: true,
    noDailyCredentialsCopied: true,
    proxy: "unreachable loopback except localhost",
    setup:
      "project and application selection via RPC are prerequisites, not UI coverage",
  },
  sourceManifestSha256: process.env.WILLYOU_TEST_SOURCE_MANIFEST_SHA,
  marker,
  requests: [],
  checks: [],
  entries: {},
  status: "running",
  formalCasePassesAdded: 0,
};
assert(process.env.WILLYOU_ACCEPTANCE_ASAR_SHA, "Pin the ASAR SHA256");
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
  join(home, ".agents/skills/m11-t37"),
])
  await mkdir(p, { recursive: true });
const skill = join(home, ".agents/skills/m11-t37/SKILL.md");
await writeFile(
  skill,
  "---\nname: m11-t37\ndescription: Private entry isolation marker.\n---\nNo action is required.\n",
);
let stage = "setup",
  app,
  project,
  profile,
  task;
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
const checked = (name, details = {}) =>
  result.checks.push({
    name,
    at: new Date().toISOString(),
    passed: true,
    ...details,
  });

async function readPlan() {
  return poll(
    async () =>
      app.mainEvaluate(
        `(()=>{const req=process.getBuiltinModule('module').createRequire(process.resourcesPath+'/app.asar/package.json');const DB=req('better-sqlite3'),db=new DB(${JSON.stringify(join(userData, "smartdd.db"))},{readonly:true});try{const row=db.prepare("SELECT plan_json FROM capability_resource_operations WHERE kind='application-run-plan' ORDER BY created_at DESC LIMIT 1").get();return row?JSON.parse(row.plan_json):null}finally{db.close()}})()`,
      ),
    20000,
  );
}

// One session at a time; each task carries its own marker so the fixture can steer exactly one call.
const foreignByMarker = new Map();
let currentCall = null;
const server = createServer((req, res) => {
  const chunks = [];
  let bytes = 0;
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
    const raw = JSON.stringify(body);
    const taskMarkers = [...raw.matchAll(/M11_T37_ENTRY_[A-Za-z0-9]+/g)].map(
      (m) => m[0],
    );
    const own = taskMarkers.find((m) => m === marker);
    const healthCode = raw.match(/SMARTDD-OK-[0-9a-f]{8}/)?.[0];
    const item = {
      at: new Date().toISOString(),
      kind: own ? "ui-task" : healthCode ? "profile-health" : "unclassified",
      phase: currentCall?.phase,
      requestBytes: bytes,
      sha256: sha(raw),
      toolNames: (body.tools ?? []).flatMap((t) =>
        t.type === "namespace"
          ? (t.tools ?? []).map((v) => t.name + ":" + v.name)
          : [t.name],
      ),
      response: own
        ? marker + "_DONE"
        : (healthCode ?? "M11_PRIVATE_FIXTURE_OK"),
    };
    result.requests.push(item);
    const sendEvent = (type, value) =>
      res.write(
        "event: " +
          type +
          "\ndata: " +
          JSON.stringify({ type, ...value }) +
          "\n\n",
      );
    const emitCall = (call, argsText) => {
      sendEvent("response.created", {
        response: {
          id: "resp_" + call.id,
          object: "response",
          created_at: Math.floor(Date.now() / 1000),
          status: "in_progress",
          output: [],
        },
      });
      sendEvent("response.output_item.added", {
        output_index: 0,
        item: { ...call, status: "in_progress", arguments: "" },
      });
      sendEvent("response.function_call_arguments.delta", {
        item_id: call.id,
        output_index: 0,
        delta: argsText,
      });
      sendEvent("response.function_call_arguments.done", {
        item_id: call.id,
        output_index: 0,
        arguments: argsText,
      });
      sendEvent("response.output_item.done", { output_index: 0, item: call });
      sendEvent("response.completed", {
        response: {
          id: "resp_" + call.id,
          object: "response",
          created_at: Math.floor(Date.now() / 1000),
          status: "completed",
          model: body.model,
          output: [call],
          usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
        },
      });
      res.end();
    };
    try {
      if (own && !currentCall?.issued) {
        const plan = await readPlan();
        const namespaces = (body.tools ?? []).filter(
          (t) => t.type === "namespace",
        );
        const available = namespaces.flatMap((t) =>
          (t.tools ?? []).map((v) => ({ namespace: t.name, name: v.name })),
        );
        writeFileSync(
          join(root, `native-tools-${currentCall.label}.json`),
          JSON.stringify(body.tools ?? [], null, 2) + "\n",
        );
        const target = foreignByMarker.get(marker);
        const usable = target.namespace
          ? available.find((t) => t.name === target.tool)
          : null;
        currentCall.issued = {
          label: currentCall.label,
          foreignEntry: target.appId,
          foreignTool: target.tool,
          foreignToolDelivered: !!usable,
          deliveredTools: available.map((t) => t.namespace + ":" + t.name),
          planEntries: (plan?.applications ?? []).map((a) => ({
            appId: a.appId,
            effectiveEntry: a.effectiveEntry,
            fallback: a.fallback ?? null,
          })),
        };
        const call = {
          type: "function_call",
          id: "fc_" + currentCall.label,
          call_id: "call_" + currentCall.label,
          name: target.tool,
          ...(usable
            ? { namespace: usable.namespace }
            : target.namespace
              ? { namespace: target.namespace }
              : {}),
          arguments: "{}",
          status: "completed",
        };
        currentCall.call = call;
        return emitCall(call, "{}");
      }
      if (own && currentCall?.issued) {
        const outputs = (body.input ?? []).filter(
          (v) =>
            v.type === "function_call_output" &&
            v.call_id === "call_" + currentCall.label,
        );
        currentCall.output = outputs
          .map((v) =>
            typeof v.output === "string" ? v.output : JSON.stringify(v.output),
          )
          .join("\n");
      }
    } catch (error) {
      result.fixtureFailure = {
        code: "T37_PRECONDITION",
        message: String(error),
      };
      res.end();
      return;
    }
    const id = "msg_" + result.requests.length;
    const text = own
      ? marker + "_DONE"
      : (healthCode ?? "M11_PRIVATE_FIXTURE_OK");
    const message = {
      id,
      type: "message",
      role: "assistant",
      status: "completed",
      content: [{ type: "output_text", text, annotations: [] }],
    };
    sendEvent("response.created", {
      response: {
        id: "resp_" + id,
        object: "response",
        created_at: Math.floor(Date.now() / 1000),
        status: "in_progress",
        output: [],
      },
    });
    sendEvent("response.output_item.added", {
      output_index: 0,
      item: { ...message, status: "in_progress", content: [] },
    });
    sendEvent("response.content_part.added", {
      item_id: id,
      output_index: 0,
      content_index: 0,
      part: { type: "output_text", text: "", annotations: [] },
    });
    sendEvent("response.output_text.delta", {
      item_id: id,
      output_index: 0,
      content_index: 0,
      delta: text,
    });
    sendEvent("response.output_text.done", {
      item_id: id,
      output_index: 0,
      content_index: 0,
      text,
    });
    sendEvent("response.content_part.done", {
      item_id: id,
      output_index: 0,
      content_index: 0,
      part: message.content[0],
    });
    sendEvent("response.output_item.done", { output_index: 0, item: message });
    sendEvent("response.completed", {
      response: {
        id: "resp_" + id,
        object: "response",
        created_at: Math.floor(Date.now() / 1000),
        status: "completed",
        model: body.model,
        output: [message],
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      },
    });
    res.end();
  });
});
server.on("connection", (s) => s.on("error", () => {}));
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
const config =
  'model="m11-base-model"\nmodel_provider="m11_local_fixture"\nnotify=[]\n[model_providers.m11_local_fixture]\nname="M11 Synthetic Local Fixture"\nbase_url="http://127.0.0.1:' +
  port +
  '/v1"\nwire_api="responses"\nrequires_openai_auth=false\n[analytics]\nenabled=false\n[feedback]\nenabled=false\n[projects.' +
  JSON.stringify(cwd) +
  ']\ntrust_level="trusted"\n';
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
async function typeText(text) {
  await app.evaluate(
    `(()=>{const e=document.querySelector('[data-testid=home-input]');e.focus();return true})()`,
  );
  await app.cdp("Input.insertText", { text });
}

async function runTask(label, prompt, foreign) {
  stage = "session-" + label;
  currentCall = { label, phase: "pending", issued: null, output: null };
  foreignByMarker.set(marker, foreign);
  const before = await app.evaluate("performance.timeOrigin");
  await app.cdp("Page.reload");
  await app.waitFor(
    `performance.timeOrigin!==${before}&&!!document.querySelector('[data-testid=home-input]')`,
    20000,
  );
  await app.evaluate(`document.title='A · M11 T37 · ${label}';true`);
  await app.waitFor(
    `document.querySelector('[data-testid=home-project]')?.textContent.includes('M11 T37 入口隔离')`,
    15000,
  );
  await typeText(prompt + " " + marker);
  await click("[data-testid=home-launch]");
  const created = await poll(async () => {
    const tasks = await app
      .invoke("applicationsSessionTasks.list")
      .catch(() => null);
    if (tasks?.items?.length) return tasks.items[0];
    return null;
  }, 30000).catch(() => null);
  await app.waitFor(
    `!!document.querySelector('[data-testid=main-body]')`,
    30000,
  );
  await poll(async () => (currentCall.issued ? true : null), 60000);
  await poll(
    async () => (currentCall.output !== null ? true : null),
    120000,
  ).catch(() => null);
  result.entries[label] = {
    label,
    prompt,
    foreign,
    createdTask: created ? { id: created.id, title: created.title } : null,
    ...currentCall.issued,
    foreignCall: currentCall.call ?? null,
    foreignOutput: currentCall.output,
  };
  return result.entries[label];
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
  await app.evaluate(`document.title='A · M11 T37 · 入口隔离';true`);
  stage = "prerequisites";
  project = await app.invoke(
    "projects.create",
    {
      name: "M11 T37 入口隔离",
      aliases: [],
      description: "Entry isolation",
      rulesPath: null,
    },
    [{ label: "fixture", path: cwd }],
  );
  result.projectId = project.id;
  const catalog = (await app.invoke("applications.catalog")).value;
  for (const appId of ["zentao", "mail"]) {
    const entry = catalog.find((x) => x.appId === appId);
    assert(entry, appId + " in catalog");
    assert(
      (await app.invoke("applications.setAdded", appId, true, entry.revision))
        .ok,
      appId + " setAdded",
    );
  }
  result.selectResults = {};
  for (const [appId, connections] of Object.entries({
    zentao: { zentao: null },
    mail: { foxmail: null, smtp: null },
  })) {
    const picked = await app.invoke("applications.select", {
      projectId: project.id,
      appId,
      enabled: true,
      expectedRevision: 0,
      connections,
    });
    result.selectResults[appId] = picked;
    assert(picked.ok, appId + " select: " + JSON.stringify(picked));
  }

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
  const health = await poll(async () => {
    const p = await app.invoke("aiProfiles.get", profile.id);
    return !p.checking && p.check ? p : null;
  }, 45000);
  result.profileHealth = health.check;
  assert.equal(health.check.status, "ok");
  checked("Private provider health check completed before any session");

  stage = "baseline-reload";
  const origin = await app.evaluate("performance.timeOrigin");
  await app.cdp("Page.reload");
  await app.waitFor(
    `performance.timeOrigin!==${origin}&&!!document.querySelector('[data-testid=home-input]')`,
    20000,
  );
  await app.evaluate(`document.title='A · M11 T37 · 入口隔离';true`);
  await app.mainEvaluate(
    `(()=>{const E=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');if(E.app.getPath('userData')!==${JSON.stringify(userData)})throw Error('Only own T37 App');const w=E.BrowserWindow.getAllWindows();w[0].show();E.app.focus({steal:false});w[0].focus();w[0].webContents.focus();return true})()`,
  );
  await app.waitFor("document.hasFocus()", 5000);
  installAppFocusGuard(app, result);

  // Session 1: the MCP-effective application is in the plan; a CLI-only entry must not be borrowable.
  const s1 = await runTask("mcp-session", "T37 会话一：只允许 MCP 应用的入口", {
    appId: "zentao",
    tool: "smartdd_zentao_work_list_v2",
    namespace: null,
  });
  // The same project drops mail before the second session: the new run must not inherit the
  // first run's MCP tools, and the CLI-effective application still contributes none.
  const revoked = await app.invoke("applications.select", {
    projectId: project.id,
    appId: "mail",
    enabled: false,
    expectedRevision: 1,
    connections: { foxmail: null, smtp: null },
  });
  result.revokeResult = revoked;
  assert(revoked.ok, "mail select disabled: " + JSON.stringify(revoked));
  const s2 = await runTask(
    "cli-session",
    "T37 会话二：同一数据根，邮件已停用",
    { appId: "mail", tool: "smartdd_mail_draft_list_v2", namespace: null },
  );

  for (const [label, entry] of Object.entries(result.entries)) {
    assert(entry.planEntries?.length, label + ": run plan recorded");
    assert(
      Array.isArray(entry.deliveredTools),
      label + ": delivered tool list captured",
    );
    result.checks.push({
      name: label + ": run plan and delivered tools recorded",
      at: new Date().toISOString(),
      passed: true,
      planEntries: entry.planEntries,
      deliveredTools: entry.deliveredTools.length,
    });
  }
  const entries = Object.fromEntries(
    (s1.planEntries ?? []).map((a) => [a.appId, a.effectiveEntry]),
  );
  result.entriesByApp = entries;
  assert.equal(entries.mail, "mcp", "Mail keeps its MCP entry");
  assert.equal(entries.zentao, "cli", "Zentao keeps its CLI entry");
  checked(
    "Both applications keep their own declared entry in one shared run plan",
    { entries },
  );

  const s1Foreign =
    s1.deliveredTools?.some((t) => t.includes(s1.foreign.tool)) ?? false;
  result.delivery = Object.fromEntries(
    Object.entries(result.entries).map(([label, entry]) => [
      label,
      {
        mail: (entry.deliveredTools ?? []).filter((t) => /mail/i.test(t))
          .length,
        zentao: (entry.deliveredTools ?? []).filter((t) => /zentao/i.test(t))
          .length,
        namespaces: [
          ...new Set((entry.deliveredTools ?? []).map((t) => t.split(":")[0])),
        ].filter((ns) => ns.startsWith("mcp__")),
      },
    ]),
  );
  // A CLI-effective application must never be handed an MCP tool: the run plan keeps zentao on
  // cli, so only the MCP-effective application contributes a namespace.
  for (const [label, delivery] of Object.entries(result.delivery)) {
    assert.equal(
      delivery.zentao,
      0,
      label +
        ": CLI-effective application must not be delivered as an MCP tool",
    );
    assert.equal(
      delivery.mail,
      label === "mcp-session" ? 14 : 0,
      label + ": mail tools follow the current selection, not the earlier run",
    );
  }
  assert.equal(
    s1Foreign,
    false,
    "CLI-only entry must not be delivered as an MCP tool",
  );
  checked(
    "Only the MCP-effective application contributes tools in this shared plan",
    result.delivery,
  );
  result.rejectionText = {
    mcpSession: s1.foreignOutput,
    cliSession: s2.foreignOutput,
  };
  for (const [label, text] of Object.entries(result.rejectionText)) {
    if (!text) continue;
    assert(
      /unsupported call|ENTRY_NOT_ACTIVE|AUTH_REQUIRED/.test(text),
      label + ": refusal text recorded: " + text,
    );
  }
  checked(
    "An undelivered foreign tool call is refused and no business result is returned",
    { rejectionText: result.rejectionText },
  );
  assert(
    s1.foreignOutput || s2.foreignOutput,
    "At least one real rejection text was captured",
  );
  result.rejectionCodes = [s1.foreignOutput, s2.foreignOutput]
    .filter(Boolean)
    .map((text) => (text.match(/[A-Z][A-Z_]{6,}/g) ?? []).slice(0, 3));
  checked(
    "Foreign call attempt returned a real rejection instead of executing",
    { rejectionCodes: result.rejectionCodes },
  );
  result.status = "passed-entry-isolation-observed";
  assert.deepEqual(app.rendererErrors, []);
} catch (error) {
  result.status = isAppFocusYield(error) ? "deferred-focus-loss" : "failed";
  result.failedStage = stage;
  result.error = String(error);
  result.stack = error.stack;
  process.exitCode = isAppFocusYield(error) ? 2 : 1;
  if (app) {
    try {
      result.dom = await app.evaluate("document.body.innerText");
    } catch {}
  }
} finally {
  server.close();
  if (app) {
    result.rendererErrors = app.rendererErrors;
    await writeFile(join(root, "electron.txt"), app.logs());
    await app.close();
    result.ownAppCleanupComplete = true;
  }
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
      error: result.error,
      result: join(root, "result.json"),
    }),
  );
}
