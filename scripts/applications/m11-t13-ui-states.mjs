// M11 T13: packaged App UI states for catalog, connection form, project selection, activity, terminal,
// session diagnostics, light/dark and long text. Seeds use RPC only as prerequisites; every judged
// observation and control interaction goes through the real rendered App.
// Terminal and agent-backed session diagnostics stay open unless WILLYOU_T13_TERMINAL=1 is set.
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
const root = await mkdtemp("/private/tmp/willyou-m11-t13-");
const home = join(root, "home");
const userData = join(root, "userdata");
await mkdir(home, { recursive: true });
const sha = (value) => createHash("sha256").update(value).digest("hex");
const result = {
  schema: "m11-t13-packaged-ui-states-v1",
  startedAt: new Date().toISOString(),
  root,
  branch: execFileSync("git", ["branch", "--show-current"], {
    encoding: "utf8",
  }).trim(),
  commit: execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  layer:
    "A: actual packaged App; catalog/connection/project/activity via real UI; project and catalog selection seeded by RPC as prerequisite only",
  asarSha256: sha(
    await readFile(
      join(
        resolve(dirname(executable), "../.."),
        "Contents/Resources/app.asar",
      ),
    ),
  ),
  system: { platform: process.platform, arch: process.arch },
  themes: [],
  checks: [],
  status: "running",
  formalCasePassesAdded: 0,
};
assert.equal(
  result.asarSha256,
  pin,
  "ASAR SHA256 differs from the pinned acceptance package",
);
const longName = "超长项目与应用名称验证截断：" + "测".repeat(80);
assert(
  longName.length <= 100,
  "Project name stays within the 100 character validation limit",
);
let app,
  stage = "setup",
  project;
const checked = (name, detail = {}) => {
  result.checks.push({
    name,
    at: new Date().toISOString(),
    passed: true,
    ...detail,
  });
};

async function pointOf(selector, match) {
  const indexExpr =
    match.kind === "first"
      ? "0"
      : match.kind === "text"
        ? `list.findIndex(e=>e.textContent.trim()===${JSON.stringify(match.value)})`
        : match.kind === "prefix"
          ? `list.findIndex(e=>e.textContent.trim().startsWith(${JSON.stringify(match.value)}))`
          : `list.findIndex(e=>e.textContent.trim().includes(${JSON.stringify(match.value)}))`;
  return app.evaluate(
    `(()=>{const list=[...document.querySelectorAll(${JSON.stringify(selector)})];const i=${indexExpr};if(i<0)throw Error('Control missing: '+${JSON.stringify(selector)}+' '+${JSON.stringify(match.value ?? "")});const e=list[i];e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;if(e.matches(':disabled')||!e.contains(document.elementFromPoint(x,y)))throw Error('Control blocked: '+${JSON.stringify(selector)});return{x,y};})()`,
  );
}
async function tap(selector, match) {
  const point = await pointOf(selector, match);
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"])
    await app.cdp("Input.dispatchMouseEvent", {
      type,
      ...point,
      ...(type === "mouseMoved" ? {} : { button: "left", clickCount: 1 }),
    });
}
const click = (selector, text) =>
  tap(
    selector,
    text === undefined ? { kind: "first" } : { kind: "text", value: text },
  );
const clickPrefix = (selector, prefix) =>
  tap(selector, { kind: "prefix", value: prefix });

async function nav(text) {
  if (
    await app.evaluate(
      `[...document.querySelectorAll('.m10-nav')].some(e=>e.textContent.trim()===${JSON.stringify(text)})`,
    )
  )
    return click(".m10-nav", text);
  await click("[data-testid=nav-apps]");
}

async function reloadAndWait() {
  for (let attempt = 0; attempt < 4; attempt++) {
    const stamp = await app.evaluate("performance.timeOrigin").catch(() => 0);
    await app.cdp("Page.reload").catch(() => {});
    try {
      await app.waitFor(
        `performance.timeOrigin!==${stamp}&&document.readyState==='complete'&&!!document.querySelector('[data-testid=nav-apps]')`,
        15000,
      );
      return;
    } catch (error) {
      if (!/navigated|context|destroyed/i.test(String(error))) throw error;
    }
  }
  throw new Error("reload did not settle");
}

const geometry = (selector) =>
  app.evaluate(
    `(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;const r=e.getBoundingClientRect(),s=getComputedStyle(e);return{text:e.textContent.trim().slice(0,40),scrollWidth:e.scrollWidth,clientWidth:e.clientWidth,overflowX:s.overflowX,textOverflow:s.textOverflow,inside:r.x>=0&&r.y>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1}})()`,
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
  const title = "A · M11 T13 · 应用目录／连接／项目／活动";
  await app.evaluate(`document.title=${JSON.stringify(title)};true`);

  stage = "seed";
  project = await app.invoke("projects.create", {
    name: longName,
    aliases: [],
    description: "T13 long text fixture",
    rulesPath: null,
  });
  result.projectId = project.id;
  const catalog = (await app.invoke("applications.catalog")).value;
  for (const appId of ["mail", "zentao"]) {
    const entry = catalog.find((x) => x.appId === appId);
    assert(entry, appId + " must be in the catalog");
    const added = await app.invoke(
      "applications.setAdded",
      appId,
      true,
      entry.revision,
    );
    assert(added.ok, JSON.stringify(added));
  }
  const selected = await app.invoke("applications.select", {
    projectId: project.id,
    appId: "mail",
    enabled: true,
    expectedRevision: 0,
    connections: { foxmail: null, smtp: null },
  });
  assert(selected.ok, JSON.stringify(selected));

  await reloadAndWait();
  await app.evaluate(`document.title=${JSON.stringify(title)};true`);
  await app.mainEvaluate(
    `(()=>{const E=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');if(E.app.getPath('userData')!==${JSON.stringify(userData)})throw Error('Only own T13 App');const w=E.BrowserWindow.getAllWindows();w[0].show();E.app.focus({steal:false});w[0].focus();w[0].webContents.focus();return true})()`,
  );
  await app.waitFor("document.hasFocus()", 4000);
  installAppFocusGuard(app, result);

  for (const theme of ["light", "dark"]) {
    stage = theme;
    await app.invoke("appSettings.update", "theme", "y" + theme);
    await reloadAndWait();
    await app.evaluate(
      `document.title=${JSON.stringify("A · M11 T13 · " + theme)};true`,
    );
    await app.waitFor(
      `document.documentElement.classList.contains('ydark')===${theme === "dark"}`,
    );
    const record = { theme, scopes: [], status: "running" };
    result.themes.push(record);

    // 1. Catalog: product language, cards, installed split and long text.
    await nav("应用");
    await app.waitFor('!!document.querySelector(".m10-catalog-grid")');
    const heading = await app.evaluate(
      'document.querySelector(".m10-page-head h1")?.textContent.trim()',
    );
    assert.equal(heading, "应用", "Product continues to call it 应用");
    const cards = await app.evaluate(
      `[...document.querySelectorAll('.m10-catalog-item')].map(e=>({title:(e.querySelector('strong')?.textContent??'').trim(),state:(e.querySelector('.m10-state')?.textContent??'').trim(),buttons:[...e.querySelectorAll('button')].map(b=>b.textContent.trim()),text:e.innerText.replace(/\\s+/g,' ').slice(0,120)}))`,
    );
    assert(cards.length >= 2, "Catalog renders every registered application");
    assert(
      cards.some((card) => card.title.startsWith("邮件")),
      "Mail card present",
    );
    assert(
      cards.some((card) => card.title.startsWith("禅道")),
      "Zentao card present",
    );
    assert(
      cards.every(
        (card) => !/(插件|plugin|extensions?)/i.test(card.title ?? ""),
      ),
      "No user-facing plugin wording in the catalog",
    );
    record.scopes.push({
      scope: "catalog",
      heading,
      cards,
      longTitle: await geometry(".m10-catalog-item strong"),
    });
    await app.screenshot(join(root, `t13-${theme}-catalog.png`));
    checked(`catalog-${theme}`, { cards: cards.length });

    // 2. Connection form renders from the module configuration view and cancels cleanly.
    await clickPrefix(".m10-catalog-item", "邮件");
    await app.waitFor('!!document.querySelector(".m10-button.primary")');
    const addLabel = await app.evaluate(
      'document.querySelector(".m10-button.primary")?.textContent.trim()',
    );
    assert.equal(
      addLabel,
      "添加连接",
      "Installed application offers adding a connection",
    );
    await click(".m10-button.primary");
    await app.waitFor('!!document.querySelector("[role=menuitem]")');
    const providers = await app.evaluate(
      '[...document.querySelectorAll("[role=menuitem]")].map(e=>e.textContent.trim())',
    );
    assert(
      providers.length >= 2,
      "Mail offers its two declared providers: " + providers.join("|"),
    );
    record.providers = providers;
    await click("[role=menuitem]", providers[0]);
    await app.waitFor('!!document.querySelector("dialog form")');
    const form = await app.evaluate(
      `(()=>{const d=document.querySelector('dialog'),inputs=[...d.querySelectorAll('input,select,textarea')];return{title:d.querySelector('h2')?.textContent.trim(),fields:inputs.map(e=>({label:e.getAttribute('aria-label'),kind:e.tagName,required:!!e.required})),groups:[...d.querySelectorAll('fieldset legend,section h3')].map(e=>e.textContent.trim())}})()`,
    );
    assert(
      form.fields.length >= 2,
      "Connection form renders its declared fields",
    );
    record.scopes.push({
      scope: "connection-form",
      title: form.title,
      fields: form.fields,
      groups: form.groups,
    });
    await app.screenshot(join(root, `t13-${theme}-connection.png`));
    await click("dialog button", "取消");
    await app.waitFor('!document.querySelector("dialog")');
    checked(`connection-form-${theme}`, { fields: form.fields.length });

    // 3. Project selection: the selected application is listed with its own state.
    await app.waitFor('!!document.querySelector(".m10-sidebar")');
    const projectView = await app.evaluate(
      `(()=>{const s=document.querySelector('.m10-sidebar');return{installed:[...s.querySelectorAll('.installed')].map(e=>e.textContent.trim()),lines:s.innerText.split('\\n').slice(0,5)}})()`,
    );
    assert(
      projectView.installed.some((text) => text.startsWith("邮件")),
      "Selected mail application is listed for the project",
    );
    record.scopes.push({
      scope: "project-selection",
      projectView,
      longTitle: await geometry(".m10-sidebar-title"),
    });
    checked(`project-selection-${theme}`, {
      installed: projectView.installed.length,
    });

    // 4. Activity records the prerequisite actions.
    await nav("调用记录");
    await app.waitFor('!!document.querySelector(".m10-activity-list")', 10000);
    assert.equal(
      await app.evaluate(
        'document.querySelector(".m10-page-head h1")?.textContent.trim()',
      ),
      "调用记录",
      "Activity page keeps its product name",
    );
    const activity = await app.evaluate(
      `(()=>{const rows=[...document.querySelectorAll('.m10-activity-row')];return{count:rows.length,first:rows[0]?.innerText.split('\\n').slice(0,4)??null}})()`,
    );
    assert(
      activity.count >= 1,
      "Activity lists the real catalog and selection records",
    );
    record.scopes.push({ scope: "activity", ...activity });
    await app.screenshot(join(root, `t13-${theme}-activity.png`));
    checked(`activity-${theme}`, { rows: activity.count });
    record.status = "passed";
  }
  result.status =
    process.env.WILLYOU_T13_TERMINAL === "1"
      ? "passed-t13-agent-scopes-pending"
      : "passed-ui-scopes-without-agent";
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
