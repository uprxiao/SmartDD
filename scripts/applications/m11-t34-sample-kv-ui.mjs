// M11 T34 A layer: a newly onboarded application must appear, render its declared connection form
// and be selectable for a project through the real packaged UI. Capability execution is covered by
// the module's own integration test; this driver judges only what the page shows.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
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
const pointOf = (selector) =>
  app.evaluate(
    `(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Control missing: '+${JSON.stringify(selector)});e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;if(e.matches(':disabled')||!e.contains(document.elementFromPoint(x,y)))throw Error('Control blocked: '+${JSON.stringify(selector)});return{x,y};})()`,
  );
async function click(selector, text) {
  const point =
    text === undefined
      ? await pointOf(selector)
      : await app.evaluate(
          `(()=>{const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(n=>n.textContent.trim()===${JSON.stringify(text)});if(!e)throw Error('Control missing: '+${JSON.stringify(text)});e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;if(e.matches(':disabled')||!e.contains(document.elementFromPoint(x,y)))throw Error('Control blocked: '+${JSON.stringify(text)});return{x,y};})()`,
        );
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"])
    await app.cdp("Input.dispatchMouseEvent", {
      type,
      ...point,
      ...(type === "mouseMoved" ? {} : { button: "left", clickCount: 1 }),
    });
}
async function type(selector, value) {
  await click(selector);
  await app.evaluate(
    `(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.focus();e.select?.();return true})()`,
  );
  await app.cdp("Input.insertText", { text: value });
}
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
    entry: entry.entry ?? null,
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

  // 1. The new application is listed with its declared display name and can be added from the page.
  stage = "catalog";
  await click("[data-testid=nav-apps]");
  await app.waitFor('!!document.querySelector(".m10-catalog-grid")');
  const card = await app.evaluate(
    `(()=>{const e=[...document.querySelectorAll('.m10-catalog-item')].find(n=>n.innerText.includes('接入标准示例'));return e?{text:e.innerText.replace(/\\s+/g,' ').slice(0,200)}:null})()`,
  );
  assert(
    card,
    "The onboarded application appears in the catalog under its declared name",
  );
  result.card = card;
  const opened = await app.evaluate(
    `(()=>{const e=[...document.querySelectorAll('.m10-catalog-item')].find(n=>n.innerText.includes('接入标准示例'));const b=e?.querySelector('button');if(!b)return false;const r=b.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;if(!b.contains(document.elementFromPoint(x,y)))return false;return {x,y,label:b.textContent.trim()}})()`,
  );
  assert(opened, "Add action for the new application is clickable");
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"])
    await app.cdp("Input.dispatchMouseEvent", {
      type,
      ...opened,
      ...(type === "mouseMoved" ? {} : { button: "left", clickCount: 1 }),
    });
  await app.waitFor(`/添加连接|新建连接/.test(document.body.innerText)`, 10000);
  checked("Onboarded application listed and added from the page", {
    label: opened.label,
  });

  // 2. The connection form comes from the module's own configuration view.
  stage = "connection";
  await app
    .waitFor('!!document.querySelector("[aria-label=应用更多操作]")')
    .catch(() => {});
  if (
    await app.evaluate('!!document.querySelector("[aria-label=应用更多操作]")')
  ) {
    await click("[aria-label=应用更多操作]");
    await app.waitFor('!!document.querySelector("[role=menu]")');
    await click("[role=menuitem]", "添加连接");
  } else {
    await app.evaluate(
      `(()=>{const b=[...document.querySelectorAll('button')].find(n=>n.textContent.trim()==='添加连接');if(!b)throw Error('添加连接 missing');b.click();return true})()`,
    );
  }
  await app.waitFor('!!document.querySelector("dialog form")', 8000);
  const form = await app.evaluate(
    `(()=>{const d=document.querySelector('dialog');return{title:d.querySelector('h2')?.textContent.trim(),groups:[...d.querySelectorAll('fieldset legend,section h3')].map(e=>e.textContent.trim()),fields:[...d.querySelectorAll('input,select,textarea')].map(e=>({label:e.getAttribute('aria-label'),kind:e.tagName,required:!!e.required,options:e.tagName==='SELECT'?[...e.options].map(o=>o.value):undefined}))}})()`,
  );
  result.form = form;
  assert(
    form.fields.length >= 3,
    "Connection form renders the declared configuration fields",
  );
  assert(
    form.groups.length >= 1,
    "Connection form is grouped by the module configuration view",
  );
  await app.screenshot(join(root, "t34-connection-form.png"));
  checked("Connection form rendered from the module configuration view", {
    fields: form.fields.length,
    groups: form.groups,
  });

  // 3. Test and save the connection through the page; the reference upstream needs no network.
  stage = "save";
  const inputs = form.fields.filter((field) => field.kind === "INPUT");
  assert(inputs.length >= 2, "The form exposes service and prefix inputs");
  await type("dialog input", "reference");
  const allInputs = await app.evaluate(
    `[...document.querySelectorAll('dialog input')].map(e=>({label:e.getAttribute('aria-label'),type:e.type}))`,
  );
  if (allInputs.length >= 2) {
    const second = "dialog input:nth-of-type(2)";
    if (
      await app.evaluate(`!!document.querySelector(${JSON.stringify(second)})`)
    )
      await type(second, "demo:");
  }
  const select = await app.evaluate(
    `(()=>{const s=document.querySelector('dialog select');return s?{label:s.getAttribute('aria-label'),options:[...s.options].map(o=>o.value)}:null})()`,
  );
  if (select) result.transportOptions = select.options;
  const secret = await app.evaluate(
    `(()=>{const i=[...document.querySelectorAll('dialog input')].find(e=>e.type==='password');return i?i.getAttribute('aria-label'):null})()`,
  );
  if (secret) await type("dialog input[type=password]", "SYNTHETIC_SAMPLE");
  result.filledFields = await app.evaluate(
    `[...document.querySelectorAll('dialog input,select')].map(e=>({label:e.getAttribute('aria-label'),value:e.value}))`,
  );
  const testButton = await app.evaluate(
    `(()=>{const b=[...document.querySelectorAll('dialog button')].find(n=>/测试/.test(n.textContent));return b?b.textContent.trim():null})()`,
  );
  assert(testButton, "Connection form offers a test action");
  await click("dialog button", testButton);
  await app.waitFor(
    `(()=>{const d=document.querySelector('dialog');return !!d&&/成功|可用|已验证/.test(d.innerText)})()`,
    15000,
  );
  const tested = await app.evaluate(
    `document.querySelector('dialog').innerText.replace(/\\s+/g,' ').slice(0,300)`,
  );
  result.testOutcome = tested;
  const saveLabel = await app.evaluate(
    `(()=>{const b=[...document.querySelectorAll('dialog button')].find(n=>/保存/.test(n.textContent)&&!n.disabled);return b?b.textContent.trim():null})()`,
  );
  assert(saveLabel, "Save becomes available after a successful test");
  await click("dialog button", saveLabel);
  await app.waitFor('!document.querySelector("dialog")', 10000);
  const saved = await app.invoke("applications.connections", "sample-kv");
  assert(
    Array.isArray(saved) && saved.length === 1,
    "Exactly one connection is saved from the page",
  );
  assert.equal(saved[0].config.service, "reference");
  assert.equal(saved[0].config.prefix, "demo:");
  result.connection = { id: saved[0].id, config: saved[0].config };
  checked("Reference connection tested and saved through the page", {
    connectionId: saved[0].id,
  });
  await app.screenshot(join(root, "t34-connection-saved.png"));

  // 4. The application can be selected for the project from the page.
  stage = "select";
  const selectButton = await app.evaluate(
    `(()=>{const b=[...document.querySelectorAll('button')].find(n=>/选用|添加应用/.test(n.textContent)&&!n.disabled);return b?b.textContent.trim():null})()`,
  );
  assert(
    selectButton,
    "A selection action is offered for the onboarded application",
  );
  await click("button", selectButton);
  await app.waitFor(
    `(()=>{const s=document.querySelector('.m10-sidebar');return !!s&&s.innerText.includes('接入标准示例')})()`,
    10000,
  );
  const selection = (await app.invoke("applications.selection", project.id))
    .value;
  const selected = selection?.find((item) => item.appId === "sample-kv");
  assert(
    selected?.enabled,
    "Onboarded application is selected for the project after the page action",
  );
  result.selection = selected;
  checked("Onboarded application selected for the project from the page", {
    enabled: selected.enabled,
  });
  await app.screenshot(join(root, "t34-selected.png"));
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
}
