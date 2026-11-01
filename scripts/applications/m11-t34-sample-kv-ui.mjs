// M11 T34 A layer: a newly onboarded application must appear in the catalog, render its declared
// connection form, save a tested reference connection and be selectable for a project — all through
// the real packaged UI. Capability execution is covered by the module's own integration test.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, symlink, writeFile, readFile } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { openElectron } from "../lib/electron-harness.mjs";
import {
  installAppFocusGuard,
  isAppFocusYield,
} from "../lib/app-focus-guard.mjs";

const executable = process.env.WILLYOU_ACCEPTANCE_APP;
const pin = process.env.WILLYOU_ACCEPTANCE_ASAR_SHA;
assert(
  executable && pin && /^[a-f0-9]{64}$/.test(pin),
  "Set private packaged App and its pinned ASAR SHA256",
);
const root = await mkdtemp("/private/tmp/willyou-m11-t34-");
const home = join(root, "home");
const userData = join(root, "userdata");
await mkdir(home, { recursive: true });
// The packaged App stores connection secrets through safeStorage, which resolves the login keychain
// from HOME. A redirected HOME has no keychain, so macOS blocks on a system prompt; link the real
// keychain store in while keeping every other path isolated.
await mkdir(join(home, "Library"), { recursive: true });
await symlink(
  join(process.env.HOME ?? "", "Library/Keychains"),
  join(home, "Library/Keychains"),
);
const sha = (value) => createHash("sha256").update(value).digest("hex");
const result = {
  schema: "m11-t34-onboarding-ui-v1",
  startedAt: new Date().toISOString(),
  root,
  branch: execFileSync("git", ["branch", "--show-current"], {
    encoding: "utf8",
  }).trim(),
  commit: execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  layer:
    "A: packaged App; catalog, connection form, test/save and project selection through the real UI",
  keychainAccess:
    "login keychain linked into the isolated HOME for safeStorage writes",
  asarSha256: sha(
    await readFile(
      join(
        resolve(dirname(executable), "../.."),
        "Contents/Resources/app.asar",
      ),
    ),
  ),
  system: { platform: process.platform, arch: process.arch },
  checks: [],
  observations: [],
  status: "running",
  formalCasePassesAdded: 0,
};
assert.equal(
  result.asarSha256,
  pin,
  "ASAR SHA256 differs from the pinned acceptance package",
);
let app,
  stage = "setup";
const checked = (name, detail = {}) =>
  result.checks.push({
    name,
    at: new Date().toISOString(),
    passed: true,
    ...detail,
  });
const parsePoint = (raw) => {
  try {
    const point = JSON.parse(raw);
    if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y))
      throw new Error(`missing coordinates in ${raw}`);
    return point;
  } catch (error) {
    throw new Error(`Control geometry could not be read: ${String(error)}`);
  }
};
const tapPoint = async (x, y) => {
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"])
    await app.cdp("Input.dispatchMouseEvent", {
      type,
      x,
      y,
      ...(type === "mouseMoved" ? {} : { button: "left", clickCount: 1 }),
    });
};
const centre = async (selector) =>
  parsePoint(
    await app.evaluate(
      `(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Control missing: '+${JSON.stringify(selector)});e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;if(e.matches(':disabled')||!e.contains(document.elementFromPoint(x,y)))throw Error('Control blocked: '+${JSON.stringify(selector)});return JSON.stringify({x,y})})()`,
    ),
  );
const click = async (selector) => {
  const point = await centre(selector);
  await tapPoint(point.x, point.y);
};
const clickText = async (selector, text) => {
  const point = parsePoint(
    await app.evaluate(
      `(()=>{const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(n=>n.textContent.trim()===${JSON.stringify(text)}&&!n.disabled);if(!e)throw Error('Control missing: '+${JSON.stringify(text)});e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;if(!e.contains(document.elementFromPoint(x,y)))throw Error('Control blocked: '+${JSON.stringify(text)});return JSON.stringify({x,y})})()`,
    ),
  );
  await tapPoint(point.x, point.y);
};
const fieldByLabel = (label) => `[aria-label=${JSON.stringify(label)}]`;
const fillText = async (label, value) => {
  await click(fieldByLabel(label));
  await app.evaluate(
    `(()=>{const e=document.querySelector(${JSON.stringify(fieldByLabel(label))});e.focus();e.select?.();return true})()`,
  );
  await app.cdp("Input.insertText", { text: value });
};
const fillSelect = async (label, value) =>
  app.evaluate(
    `(()=>{const e=document.querySelector(${JSON.stringify(fieldByLabel(label))});if(!e)throw Error('Select missing: '+${JSON.stringify(label)});Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('change',{bubbles:true}));return e.value})()`,
  );
try {
  app = await openElectron({
    executable,
    userData,
    inspectMain: true,
    env: {
      HOME: home,
      ZDOTDIR: home,
      CODEX_HOME: join(home, ".codex"),
      CLAUDE_CONFIG_DIR: join(home, ".claude"),
      HTTP_PROXY: "http://127.0.0.1:1",
      HTTPS_PROXY: "http://127.0.0.1:1",
      ALL_PROXY: "http://127.0.0.1:1",
      NO_PROXY: "127.0.0.1,localhost",
    },
  });
  result.pid = app.processId;
  const title = "A · M11 T34 · 新应用接入";
  await app.evaluate(`document.title=${JSON.stringify(title)};true`);
  stage = "seed";
  const project = await app.invoke("projects.create", {
    name: "T34 接入示例",
    aliases: [],
    description: "onboarding fixture",
    rulesPath: null,
  });
  result.projectId = project.id;
  const catalog = (await app.invoke("applications.catalog")).value;
  const entry = catalog.find((item) => item.appId === "sample-kv");
  assert(entry, "sample-kv is part of the packaged catalog");
  result.catalogEntry = {
    appId: entry.appId,
    revision: entry.revision,
    displayName: entry.displayName,
    version: entry.version,
  };
  const origin = await app.evaluate("performance.timeOrigin");
  await app.cdp("Page.reload");
  await app.waitFor(
    `performance.timeOrigin!==${origin}&&!!document.querySelector('[data-testid=nav-apps]')`,
    15000,
  );
  await app.evaluate(`document.title=${JSON.stringify(title)};true`);
  await app.mainEvaluate(
    `(()=>{const E=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');if(E.app.getPath('userData')!==${JSON.stringify(userData)})throw Error('Only own T34 App');const w=E.BrowserWindow.getAllWindows();w[0].show();E.app.focus({steal:false});w[0].focus();w[0].webContents.focus();return true})()`,
  );
  await app.waitFor("document.hasFocus()", 4000);
  installAppFocusGuard(app, result);

  // 1. The new application appears under its declared name; a single available application opens
  //    its detail page straight away, so accept either the list or an already open detail.
  stage = "catalog";
  await click("[data-testid=nav-apps]");
  await app.waitFor(
    `!!document.querySelector('.m10-catalog-grid')||[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='添加应用')`,
    12000,
  );
  const hasCard = await app.evaluate(
    `(()=>{const g=document.querySelector('.m10-catalog-grid');return !!g&&[...g.children].some(e=>e.innerText.includes('接入标准示例'))})()`,
  );
  result.catalogShape = hasCard ? "list-with-card" : "detail-open";
  if (hasCard) {
    await app.evaluate(
      `(()=>{const n=[...document.querySelectorAll('.m10-catalog-grid>*')].find(e=>e.innerText.includes('接入标准示例'));n.setAttribute('data-t34-card','1');return true})()`,
    );
    result.cardText = await app.evaluate(
      `document.querySelector('[data-t34-card]').innerText.replace(/\\s+/g,' ').slice(0,160)`,
    );
    await click("[data-t34-card]");
  } else {
    result.cardText = await app.evaluate(
      `[...document.querySelectorAll('h1,h2')].map(e=>e.textContent.trim()).find(t=>t.includes('接入标准示例'))??null`,
    );
  }
  await app.waitFor(
    `document.body.innerText.includes('接入标准示例')&&[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='添加应用')`,
    10000,
  );
  checked(
    "Onboarded application listed under its declared name and opened from the catalog",
    { shape: result.catalogShape, cardText: result.cardText },
  );

  // 2. Adding the application is a page action, and the connection form comes from the module.
  stage = "add";
  await clickText("button", "添加应用");
  await app.waitFor(
    `[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='添加连接'&&!b.disabled)`,
    10000,
  );
  result.addedState = await app.evaluate(
    `document.body.innerText.replace(/\\s+/g,' ').match(/已添加|添加应用/)?.[0] ?? null`,
  );
  checked(
    "Application added through the page and connection entry becomes available",
    { state: result.addedState },
  );

  stage = "connection";
  await clickText("button", "添加连接");
  await app.waitFor('!!document.querySelector("dialog form")', 8000);
  const form = await app.evaluate(
    `(()=>{const d=document.querySelector('dialog');return{title:d.querySelector('h2')?.textContent.trim(),fields:[...d.querySelectorAll('input,select,textarea')].map(e=>({label:e.getAttribute('aria-label'),tag:e.tagName,type:e.type,required:e.required,options:e.tagName==='SELECT'?[...e.options].map(o=>o.value):undefined})),buttons:[...d.querySelectorAll('button')].map(b=>({text:b.textContent.trim(),disabled:b.disabled})).filter(b=>b.text)}})()`,
  );
  result.form = form;
  const labels = form.fields.map((field) => field.label);
  assert.deepEqual(
    labels,
    ["连接名称", "样本服务", "允许的键前缀", "上游方式", "认证凭据"],
    "Form renders the declared configuration fields in order",
  );
  const transport = form.fields.find((field) => field.label === "上游方式");
  assert.deepEqual(
    transport?.options,
    ["mcp", "cli"],
    "Transport offers exactly the declared upstreams",
  );
  assert(
    form.buttons.some(
      (button) => button.text === "保存连接" && button.disabled,
    ),
    "Save stays disabled before a successful test",
  );
  await app.screenshot(join(root, "t34-connection-form.png"));
  checked("Connection form rendered from the module configuration view", {
    labels,
    transport: transport.options,
  });
  if (/连接连接/.test(form.title ?? ""))
    result.observations.push({
      kind: "display",
      detail: `Dialog title duplicates the suffix: ${form.title}`,
    });

  // 3. Test and save a reference connection through the page; the sample upstream needs no network.
  stage = "test";
  await fillText("连接名称", "本机样本");
  await fillText("样本服务", "reference");
  await fillText("允许的键前缀", "demo:");
  assert.equal(await fillSelect("上游方式", "mcp"), "mcp");
  await fillText("认证凭据", "SYNTHETIC_SAMPLE");
  result.filled = await app.evaluate(
    `[...document.querySelectorAll('dialog [aria-label]')].map(e=>({label:e.getAttribute('aria-label'),value:e.type==='password'?(e.value?'set':''):e.value}))`,
  );
  await clickText("dialog button", "测试连接");
  await app.waitFor(
    `(()=>{const d=document.querySelector('dialog');return !d||/\u8eab\u4efd\u9a8c\u8bc1\u901a\u8fc7|\u53ef\u4fdd\u5b58\u8fde\u63a5|\u5931\u8d25|\u4e0d\u53ef\u7528/.test(d.innerText)})()`,
    30000,
    { pollMs: 250 },
  );
  result.testStatus = await app.evaluate(
    `(()=>{const d=document.querySelector('dialog');const t=d?.innerText.replace(/\\s+/g,' ')??'';return{settledText:t.slice(0,400),ok:/\u8eab\u4efd\u9a8c\u8bc1\u901a\u8fc7|\u53ef\u4fdd\u5b58\u8fde\u63a5/.test(t),alert:d?.querySelector('[role=alert]')?.textContent.trim()??null}})()`,
  );
  assert.ok(
    result.testStatus.ok,
    `Connection test did not report success: ${JSON.stringify(result.testStatus)}`,
  );
  result.testOutcome =
    "\u8eab\u4efd\u9a8c\u8bc1\u901a\u8fc7\uff0c\u53ef\u4fdd\u5b58\u8fde\u63a5";
  await app.waitFor(
    `[...document.querySelectorAll('dialog button')].some(b=>b.textContent.trim()==='保存连接'&&!b.disabled)`,
    5000,
  );
  checked("Reference connection tested through the page", {
    outcome: result.testOutcome,
  });

  stage = "save";
  await clickText("dialog button", "保存连接");
  await app.waitFor('!document.querySelector("dialog")', 10000);
  const savedReply = await app.invoke("applications.connections", "sample-kv");
  const saved = Array.isArray(savedReply)
    ? savedReply
    : (savedReply?.value ?? []);
  result.savedReplyKind = Array.isArray(savedReply)
    ? "array"
    : Object.keys(savedReply ?? {}).join(",");
  assert(
    Array.isArray(saved) && saved.length === 1,
    `Exactly one connection is saved from the page: ${JSON.stringify(savedReply).slice(0, 300)}`,
  );
  assert.equal(saved[0].config.service, "reference");
  assert.equal(saved[0].config.prefix, "demo:");
  assert.equal(saved[0].config.transport, "mcp");
  result.connection = {
    id: saved[0].id,
    config: saved[0].config,
    hasSecret: Boolean(saved[0].secrets?.length ?? saved[0].secretSet),
  };
  await app.screenshot(join(root, "t34-connection-saved.png"));
  checked("Connection saved through the page with the declared configuration", {
    connectionId: saved[0].id,
  });

  // 4. The application is selected for the project from the page.
  stage = "select";
  await app.waitFor(
    `[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='管理项目选用')`,
    8000,
  );
  await clickText("button", "管理项目选用");
  await new Promise((resolve) => setTimeout(resolve, 700));
  // The view asks for the project first, then for the connection slot this application owns.
  if (
    await app.evaluate(
      `[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='\u9009\u62e9\u9879\u76ee')`,
    )
  )
    await clickText("button", "\u9009\u62e9\u9879\u76ee");
  await new Promise((resolve) => setTimeout(resolve, 600));
  const pickProject = await app.evaluate(
    `(()=>{const e=[...document.querySelectorAll('button,[role=menuitem],[role=option],li')].find(n=>n.textContent.trim()==='T34 \u63a5\u5165\u793a\u4f8b'&&n.offsetParent!==null);if(!e)return null;e.setAttribute('data-t34-pick','1');return e.tagName})()`,
  );
  result.pickProject = pickProject;
  if (pickProject) {
    await click("[data-t34-pick]");
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
  // Choose the saved connection in the application's own slot (radio group per provider slot).
  const radioLabel = `\u4e3aT34 \u63a5\u5165\u793a\u4f8b\u9009\u7528\u672c\u673a\u6837\u672c`;
  const radio = await app.evaluate(
    `(()=>{const e=document.querySelector('[aria-label='+JSON.stringify(${JSON.stringify(radioLabel)})+']');if(!e)return null;return{checked:e.checked}})()`,
  );
  result.slotRadio = radio;
  assert(radio, `Connection slot radio missing: ${radioLabel}`);
  await click("[aria-label=" + JSON.stringify(radioLabel) + "]");
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const state = (
    await app.invoke("applications.projectSettings", project.id, "sample-kv")
  ).value;
  result.selection = state;
  assert(
    state?.enabled || state?.connections?.["sample-kv"],
    `Application was not selected for the project: ${JSON.stringify(state)}`,
  );
  await app.screenshot(join(root, "t34-selected.png"));
  checked("Onboarded application selected for the project from the page", {
    enabled: true,
    connection: state.connections["sample-kv"],
  });
  result.status = "passed-onboarding-ui";
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
      await app.screenshot(join(root, "failure.png"));
    } catch {}
  }
} finally {
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
  process.exitCode =
    result.status === "passed-onboarding-ui" ? 0 : (process.exitCode ?? 1);
}
