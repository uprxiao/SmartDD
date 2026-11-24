// Integration experiment. The login confirmation adapter here is a fixture.
// Electron, the page registry, request ledger and migrations are the frozen product code.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app } from 'electron';
import type Database from 'better-sqlite3';
import { BrowserProfiles } from '@study/main/core/browser/profiles';
import { BrowserPageRegistry, type BrowserPage } from '@study/main/core/browser/page-registry';
import { AgentStore } from '@study/main/core/agent/agent-store';
import { HostBusinessRequests, type BusinessHandler, type BusinessOrigin, type BusinessRecord } from '@study/main/core/agent/host-business-requests';
import type { RunHandle } from '@study/main/core/agent/agent-run-service';
import { evaluateCapabilities } from '@study/main/core/agent/capabilities';
import { runBundledMigrations } from '@study/main/db/migrations';
import { startReportFixture, fixtureLogin } from './report-fixture.mjs';

async function main() {
  const root = process.env.WY_M15_LOGIN_ROOT!;
  assert.match(root, /^\/private\/tmp\/willyou-m15-login-[A-Za-z0-9]+$/);
  const userData = join(root, 'data');
  app.setPath('userData', userData);
  const report = { commit: process.env.WY_M15_LOGIN_COMMIT, electron: process.versions.electron, chromium: process.versions.chrome, arch: process.arch,
    cases: [] as Record<string, unknown>[], error: null as string | null };
  let db: Database.Database | undefined;
  let fixture: Awaited<ReturnType<typeof startReportFixture>> | undefined;
  let registry: BrowserPageRegistry | undefined;
  let ledger: HostBusinessRequests | undefined;
  let stage = 'startup';
  const taskProjects = new Map<string, string>();
  const current = new Map<string, RunHandle>();
  const owners = new Set<string>();
  const notices: { taskId: string; kind: string; wake: boolean }[] = [];
  const advances: { requestId: string; taskId: string; runId: string; step: string }[] = [];
  const nextGenerations = new Map<string, number>();

  try {
    await app.whenReady();
    const Sqlite = require(process.env.WY_M15_LOGIN_SQLITE!);
    db = new Sqlite(join(root, 'study.db')) as Database.Database;
    db.pragma('foreign_keys=ON');
    const migrations = runBundledMigrations(db);
    assert(migrations.length > 0);
    const store = new AgentStore(db);
    fixture = await startReportFixture();
    const pages = registry = new BrowserPageRegistry({
      userData, profiles: new BrowserProfiles({ sqlite: db, taskProject: taskId => taskProjects.get(taskId) ?? null }),
      helper: { executable: process.env.WY_M15_LOGIN_HELPER!, sha256: process.env.WY_M15_LOGIN_HELPER_HASH! },
    });
    const ready = async (page: BrowserPage, url: string) => {
      if (page.closed || page.contents.isDestroyed() || page.contents.getURL() !== url || page.contents.isLoading()) return false;
      const marker = await page.contents.executeJavaScript('document.querySelector("#business-ready")?.textContent === "报表中心"');
      return marker && page.contents.getURL() === url && !page.contents.isLoading();
    };
    const ownerPage = (record: BusinessRecord) => {
      const page = pages.get(record.row.task_id, (record.payload.data as {pageId:string}).pageId);
      assert.equal(page.profileId, record.row.account_identity, 'Fixture browser identity changed');
      return page;
    };
    const businessUrl = (record: BusinessRecord) => (record.payload.data as { businessUrl:string }).businessUrl;
    const unsafeHandler: BusinessHandler = {
      needsRun: true,
      async validate(record) {
        if (!await ready(ownerPage(record), businessUrl(record))) throw new Error('Business page still asks for login');
      },
      async execute() { throw Error('Should never run the control handler'); },
    };
    const studyHandler: BusinessHandler = {
      needsRun: true,
      async validate(record, _choice, run) {
        const page = ownerPage(record);
        if (run) {
          assert.equal(run.bindingId, record.origin.bindingId);
          assert.equal(current.get(run.taskId)?.runId, run.runId);
        }
        // reconcile() calls validate while the user has yet to log in.
        // The product registry owns identity; the explicit finish action owns readiness.
        if (record.payload.phase !== 'waiting_user' && !await ready(page, businessUrl(record))) {
          throw Error('Previously observed business page is no longer ready');
        }
      },
      async execute(record, _choice, { run, signal }) {
        signal.throwIfAborted();
        assert(run);
        const page = ownerPage(record);
        assert(await ready(page, businessUrl(record)));
        advances.push({ requestId: record.row.request_id, taskId: page.taskId, runId: run.runId, step: 'locate-report-entry' });
        return { status: 'ok', pageId: page.id, profileId: page.profileId, nextStep: 'locate-report-entry' };
      },
    };
    const deps = {
      store,
      run: (taskId: string) => current.get(taskId),
      hasOwner: (taskId: string) => owners.has(taskId),
      notify: (taskId: string, event: string, _text: string, wake: boolean) =>
        notices.push({ taskId, kind: event.replace(/-[a-f0-9-]{36}$/, ''), wake }),
      acquire: async () => () => {},
    };
    const createLedger = () => {
      const requests = new HostBusinessRequests(deps);
      requests.register('m15-control-readiness-in-validator', unsafeHandler);
      requests.register('m15-study-login', studyHandler);
      return requests;
    };
    ledger = createLedger();
    function beginRun(taskId: string, bindingId: string, projectId: string) {
      const generation = (nextGenerations.get(taskId) ?? 0) + 1;
      nextGenerations.set(taskId, generation);
      const driverId = 'codex-app-server';
      const run: RunHandle = { taskId, bindingId, runId: randomUUID(), generation, driverId, tier:'ask', version:'0.169.0',
        capabilities: evaluateCapabilities(driverId, '0.169.0').capabilities };
      store.insertRun({ runId:run.runId, taskId, bindingId, projectId, driverId, generation,
        owner: { instanceId:'m15-isolated-login-study', pid:process.pid, startedAt:null }, launchPlanHash:'b'.repeat(64) });
      store.attachRunProcess(run.runId, taskId, process.pid, null);
      current.set(taskId, run);
      owners.add(taskId);
      return run;
    }
    function finishRun(run: RunHandle, closing = false) {
      store.finishRun(run.runId, run.taskId, 'stopped', null);
      current.delete(run.taskId);
      if (!closing) owners.delete(run.taskId);
    }
    async function setup(name: string, kind = 'm15-study-login') {
      const site = fixture!.create(name);
      const projectId = randomUUID();
      const tick = Date.now();
      db!.prepare('INSERT INTO projects(id,name,created_at,updated_at) VALUES(?,?,?,?)').run(projectId, name, tick, tick);
      const taskId = store.createTask({ projectId, dirId:null, cwd:root, title:name, selection:{driverId:'codex-app-server',profileId:'fixture',tier:'ask'} });
      taskProjects.set(taskId, projectId);
      const bindingId = store.createBinding({ task_id:taskId, driver_id:'codex-app-server', profile_id:'fixture', continuation_hash:'a'.repeat(64),
        state_root:join(root,name), cwd_identity:root });
      const page = await pages.create(taskId, projectId);
      await pages.navigate(page, site.url('desk'));
      assert.equal(page.contents.getURL(), site.url('login'));
      const run = beginRun(taskId,bindingId,projectId);
      const origin: BusinessOrigin = { taskId, bindingId, runId:run.runId, generation:run.generation };
      const created = ledger!.create(origin, { operationId:randomUUID(), kind, title:'M15 合成登录请求', accountIdentity:page.profileId,
        review:{ pageId:page.id, origin:fixture!.origin, nextStep:'locate-report-entry' },
        data:{ pageId:page.id, businessUrl:site.url('desk') },
        options:[{label:'已登录，继续',value:'confirm'}] });
      return { site, projectId, taskId, bindingId, page, run, requestId:created.requestId };
    }
    type Context = Awaited<ReturnType<typeof setup>>;
    function state(c: Context) {
      const row = store.request(c.requestId)!;
      return { status:row.status, revision:row.revision, boundRunId:row.bound_run_id ?? null };
    }
    function counts(c: Context) {
      return { wakeBind:notices.filter(event => event.taskId === c.taskId && event.kind === 'business-bind' && event.wake).length,
        wakeResult:notices.filter(event => event.taskId === c.taskId && event.kind === 'business-result' && event.wake).length,
        resumes:advances.filter(action => action.requestId === c.requestId).length };
    }
    async function confirm(c: Context, revision: number) {
      const row = state(c);
      if (row.status !== 'pending' || row.revision !== revision) return { state:'stale' };
      const page = pages.get(c.taskId, c.page.id);
      assert.equal(page.profileId, c.page.profileId);
      if (!await ready(page, c.site.url('desk'))) return { state:'waiting-for-login' };
      return ledger!.respond(c.taskId, c.requestId, revision, {choice:'confirm'});
    }
    async function login(c: Context) {
      const { page } = c;
      const initialId = page.contents.id;
      const initialProfile = page.profileId;
      assert.equal(page.contents.getURL(), c.site.url('login'));
      await page.contents.executeJavaScript(`(() => {
        const form = document.querySelector('form');
        form.elements.account.value = ${JSON.stringify(fixtureLogin.account)};
        form.elements.password.value = ${JSON.stringify(fixtureLogin.password)};
        form.requestSubmit();
        return true;
      })()`);
      const deadline = performance.now() + 4000;
      while (!await ready(page, c.site.url('desk'))) {
        assert(performance.now() < deadline, 'The actual business marker did not appear');
        await new Promise(resolve => setTimeout(resolve, 15));
      }
      assert.equal(page.contents.id, initialId);
      assert.equal(page.profileId, initialProfile);
      assert.equal(c.site.counters.logins, 1);
    }

    stage = 'readiness-inside-basic-validation';
    const control = await setup('login-control', 'm15-control-readiness-in-validator');
    await ledger.reconcile();
    assert.equal(state(control).status, 'retired');
    assert.equal(counts(control).resumes, 0);
    finishRun(control.run);
    report.cases.push({ id:'control', afterReconcile:state(control).status, ...counts(control) });

    stage = 'waiting-early-confirm-and-host-restart';
    const pending = await setup('login-continue');
    const waiting = state(pending);
    await ledger.reconcile();
    assert.deepEqual(state(pending), waiting);
    assert.deepEqual(await confirm(pending, waiting.revision), { state:'waiting-for-login' });
    assert.deepEqual(state(pending), waiting);
    assert.deepEqual(counts(pending), { wakeBind:0,wakeResult:0,resumes:0 });
    finishRun(pending.run,true);
    await login(pending);
    await assert.rejects(() => confirm(pending,waiting.revision), /原运行尚未退出/);
    assert.deepEqual(state(pending),waiting);
    owners.delete(pending.taskId);
    await ledger.close();
    ledger = createLedger();
    assert.deepEqual(state(pending),waiting);
    await ledger.reconcile();
    assert.deepEqual(state(pending),waiting);

    stage = 'register-current-run-and-deduplicate-resume';
    const accept = await Promise.allSettled([
      confirm(pending,waiting.revision), confirm(pending,waiting.revision),
    ]);
    assert.equal(accept.filter(result => result.status === 'fulfilled' && result.value.state === 'approved_pending_bind').length,1);
    assert.equal(state(pending).status,'approved_pending_bind');
    assert.deepEqual(counts(pending), {wakeBind:1,wakeResult:0,resumes:0});
    const next = beginRun(pending.taskId,pending.bindingId,pending.projectId);
    await Promise.all([ledger.bindPending(pending.taskId,next), ledger.bindPending(pending.taskId,next)]);
    assert.equal(state(pending).boundRunId,next.runId);
    assert.equal(state(pending).status,'resolved');
    assert.deepEqual(await confirm(pending,waiting.revision), {state:'stale'});
    assert.deepEqual(counts(pending), {wakeBind:1,wakeResult:1,resumes:1});
    assert.equal(advances.find(action => action.requestId === pending.requestId)?.runId,next.runId);
    assert(!JSON.stringify(store.request(pending.requestId)).includes(fixtureLogin.password));
    finishRun(next);
    report.cases.push({ id:'confirmed-on-original-page', earlyConfirmationKeptRevision:true, closingOwnerKeptPending:true, ledgerRestartKeptPending:true,
      loginActualMarker:true, samePageAndProfile:true, boundLater:true, oldRevisionRejected:true, ...counts(pending) });

    stage = 'actual-page-changed-before-binding';
    const changed = await setup('login-changed');
    finishRun(changed.run);
    await login(changed);
    assert.equal((await confirm(changed,state(changed).revision)).state,'approved_pending_bind');
    changed.site.expire();
    await pages.navigate(changed.page, changed.site.url('desk'));
    assert.equal(changed.page.contents.getURL(),changed.site.url('login'));
    const changedRun = beginRun(changed.taskId,changed.bindingId,changed.projectId);
    await ledger.bindPending(changed.taskId,changedRun);
    assert.equal(state(changed).status,'retired');
    assert.equal(counts(changed).resumes,0);
    finishRun(changedRun);
    report.cases.push({ id:'lost-login-before-bind', afterBind:state(changed).status, ...counts(changed) });

    stage = 'stop-before-binding';
    const stopped = await setup('login-stopped');
    finishRun(stopped.run);
    await login(stopped);
    assert.equal((await confirm(stopped,state(stopped).revision)).state,'approved_pending_bind');
    ledger.stop(stopped.taskId);
    const stoppedRun = beginRun(stopped.taskId,stopped.bindingId,stopped.projectId);
    await ledger.bindPending(stopped.taskId,stoppedRun);
    assert.equal(state(stopped).status,'retired');
    assert.equal(counts(stopped).resumes,0);
    finishRun(stoppedRun);
    report.cases.push({ id:'stopped-before-bind', afterBind:state(stopped).status, ...counts(stopped) });
    stage = 'report-sequence-and-download';
    const reportFlow = await setup('report-sequence');
    const reportPage = reportFlow.page, site = reportFlow.site;
    const originalIdentity = [reportPage.contents.id, reportPage.profileId];
    finishRun(reportFlow.run);
    await login(reportFlow);
    ledger.stop(reportFlow.taskId);
    site.controls.layout = 'invalid';
    site.controls.ambiguousReport = true;
    await pages.navigate(reportPage, site.url('desk'));
    // These are fixture-known controls. Agent discovery is part of candidate acceptance.
    const follow = async (href: string, route: string) => {
      assert.equal(new URL(site.url(route)).origin, fixture!.origin);
      const link = await reportPage.contents.executeJavaScript(
        `document.querySelector(${JSON.stringify('a[href="' + href + '"]')})?.href`);
      assert.equal(link, site.url(route));
      await pages.navigate(reportPage, link);
    };
    const download = async (expectedId: string) => {
      const path = join(root, expectedId + '.csv');
      const browserSession = reportPage.contents.session;
      const done = new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => {
          browserSession.removeListener('will-download', onDownload);
          reject(new Error('fixture CSV download timed out'));
        }, 4000);
        const onDownload = (_event: Electron.Event, item: Electron.DownloadItem, contents: Electron.WebContents) => {
          if (contents.id !== reportPage.contents.id || item.getURL() !== site.url('csv')) return;
          browserSession.removeListener('will-download', onDownload);
          item.setSavePath(path);
          item.once('done', (_event, state) => { clearTimeout(timer); resolve(state); });
        };
        browserSession.on('will-download', onDownload);
      });
      await reportPage.contents.executeJavaScript(`document.querySelector('a[href="csv"]').click(); true`, true);
      assert.equal(await done, 'completed');
      assert.equal(await readFile(path,'utf8'), 'id,month\n' + expectedId + ',11\n');
    };
    await follow('legacy','legacy');
    await follow('help','help');
    await follow('report','report');
    assert.equal(await reportPage.contents.executeJavaScript(`(() => {
      const old = document.querySelector('form button');
      document.querySelector('#replace-report').click();
      const next = document.querySelector('form button');
      return !old.isConnected && next !== old && document.querySelectorAll('form button, aside button').length === 2;
    })()`), true);
    for (let round = 1; round <= 2; round++) {
      const ambiguous = round === 2;
      site.controls.truncateWriteResponse = ambiguous;
      const expectedId = 'report-sequence-' + round;
      const word = ambiguous ? '生成结果待核对' : '报表已生成 ' + expectedId;
      await reportPage.contents.executeJavaScript(
        'document.querySelector("[name=month]").value = "11"; document.querySelector("form").requestSubmit(); true');
      const until = performance.now() + 4000;
      while (!await reportPage.contents.executeJavaScript(
        `document.querySelector('[role=status]')?.textContent === ${JSON.stringify(word)}`)) {
        assert(performance.now() < until, 'fixture operation result did not appear');
        await new Promise(resolve => setTimeout(resolve, 15));
      }
      assert.equal(site.counters.writes, round);
      if (ambiguous) {
        await follow('receipt','receipt');
        assert.equal(await reportPage.contents.executeJavaScript(
          `document.querySelectorAll('[data-record="${expectedId}"]').length`),1);
      }
      await download(expectedId);
      assert.deepEqual([reportPage.contents.id,reportPage.profileId],originalIdentity);
      assert.equal(site.counters.writes,round);
    }
    assert.equal(site.counters.downloads,2);
    assert.equal(site.counters.receiptReads,1);
    report.cases.push({ id:'report-fixture-two-rounds', movedEntryFollowed:true, staleElementFixtureReady:true, originalViewAndIdentity:true,
      validCsvFiles:2, ambiguousResponseVerifiedViaRead:true, writes:site.counters.writes, downloads:site.counters.downloads });

    assert.deepEqual(fixture.errors,[]);
  } catch (error) {
    report.error = stage + ': ' + String(error instanceof Error ? error.stack : error);
  } finally {
    const cleanup: string[] = [];
    for (const close of [
      () => ledger?.close(), () => registry?.dispose(), () => fixture?.close(), () => db?.close(),
    ]) {
      try { await close(); } catch (error) { cleanup.push(String(error)); }
    }
    const passed = report.error === null && cleanup.length === 0;
    await writeFile(join(root,'result.json'),JSON.stringify({...report,cleanup,passed},null,2)+'\n',{mode:0o600});
    app.exit(passed ? 0 : 1);
  }
}
void main();
