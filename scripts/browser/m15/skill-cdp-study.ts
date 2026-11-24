// E07 lab only. The selected native view and CDP attachment are production code.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app, BrowserWindow } from 'electron';
import { BrowserDownloads } from '@study/main/core/browser/downloads';
import { BrowserPageRegistry } from '@study/main/core/browser/page-registry';

type Page = Awaited<ReturnType<BrowserPageRegistry['create']>>;
type WorkerMessage = {kind: 'cdp'; data: string} | {kind:'waiting'} | {kind:'result'; result: Record<string, unknown>};
const allowed = new Set([
  'Page.getFrameTree', 'Page.captureScreenshot', 'Accessibility.getFullAXTree',
  'Runtime.evaluate', 'Input.dispatchMouseEvent', 'Input.dispatchKeyEvent', 'Input.insertText',
]);
const taskId = 'fixture-task';
const projectId = 'fixture-project';
const foreignTask = 'other-fixture-task';
const fixtureIdentity = 'document.querySelector("#identity").textContent';
const origin = new URL(process.env.WY_STUDY_FIXTURE!);
const root = process.env.WY_STUDY_ROOT!;
const assetDir = join(root, 'downloads');
assert.match(root, /^\/private\/tmp\/willyou-m15-skill-[A-Za-z0-9]+$/);
assert.equal(origin.protocol, 'http:');
assert.equal(origin.hostname, '127.0.0.1');
app.setPath('userData', join(root, 'data'));
app.setPath('downloads', assetDir);

function runWorker(mode: 'case'|'cancel', registry: BrowserPageRegistry, page: Page) {
  assert.equal(registry.get(taskId,page.id),page);
  const scope = {pageId:page.id, profileId:page.profileId, nativeId:page.contents.id};
  const methods: Record<string, number> = {};
  const child = spawn(process.env.WY_STUDY_NODE!, [process.env.WY_STUDY_WORKER!, mode], {
    cwd:root, env:{WY_STUDY_ROOT:root, PATH:'/usr/bin:/bin', HOME:join(root, 'home'), TMPDIR:join(root, 'scratch')},
    stdio:['ignore','inherit','inherit','ipc'],
  });
  let revoked = false;
  let waitSeen = false;
  let result: Record<string, unknown> | undefined;
  const send = (value:Record<string, unknown>) => { if (child.connected) child.send(value, () => {}); };
  const revoke = () => { if (!revoked) { revoked=true; send({kind:'revoked'}); } };
  const pageEvents = page.proxy.onEvent(event => {
    if (!revoked && !event.sessionId && event.method === 'Page.frameNavigated')
      send({kind:'cdp', data:JSON.stringify(event)});
  });
  const timeout = setTimeout(() => { revoke(); child.kill('SIGTERM'); }, 14000);
  const verify = () => {
    assert(!revoked, 'STUDY_LEASE_REVOKED');
    const current = registry.get(taskId, scope.pageId);
    assert.equal(current, page);
    assert.equal(current.profileId, scope.profileId);
    assert.equal(current.contents.id, scope.nativeId);
    assert.equal(new URL(current.contents.getURL()).origin, origin.origin);
    assert(registry.isMounted(current));
  };
  child.on('message', (input: WorkerMessage) => {
    if (input.kind === 'result') { result = input.result; return; }
    if (input.kind === 'waiting') { assert.equal(mode, 'cancel'); waitSeen = true; return; }
    if (input.kind !== 'cdp') return;
    void (async () => {
      const request = JSON.parse(input.data) as {id:number; method:string; params?:Record<string,unknown>; sessionId?:string};
      const reply = (data:Record<string, unknown>) => send({kind:'cdp', data:JSON.stringify({id:request.id, ...data})});
      try {
        verify();
        assert(!request.sessionId, 'STUDY_FOREIGN_TARGET');
        const {method, params={}} = request;
        if (method === 'Target.getTargets') { reply({result:{targetInfos:[{targetId:'study-page',type:'page'}]}}); return; }
        if (method === 'Target.getTargetInfo') {
          assert.equal(params.targetId, 'study-page', 'STUDY_FOREIGN_TARGET');
          reply({result:{targetInfo:{targetId:'study-page',type:'page'}}}); return;
        }
        assert(allowed.has(method), 'STUDY_METHOD_UNAVAILABLE');
        methods[method] = (methods[method] ?? 0) + 1;
        const response = await page.proxy.send(method, params);
        if (waitSeen && method === 'Runtime.evaluate') { revoke(); return; }
        verify();
        reply({result:response});
      } catch (error) { reply({error:{message:(error as Error).message}}); }
    })().catch(error => { console.error(String(error)); revoke(); child.kill('SIGTERM'); });
  });
  return new Promise<{methods:Record<string, number>; result:Record<string,unknown>; revoked:boolean}>((resolve,reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if(code!==0 || !result) reject(Error(`Skill worker ${mode} exited ${code ?? signal}: ${JSON.stringify(result)}`));
      else resolve({methods, result, revoked});
    });
  }).finally(() => { clearTimeout(timeout); pageEvents(); revoke(); });
}

async function signInOnFixture(page: Page) {
  const point = await page.contents.executeJavaScript(`(() => {
    const button = document.querySelector('#login button[type=submit]');
    const bounds = button?.getBoundingClientRect();
    if (!bounds?.width || !bounds.height) throw Error('Missing fixture login control');
    const x = bounds.x + bounds.width / 2, y = bounds.y + bounds.height / 2;
    if (document.elementFromPoint(x,y) !== button) throw Error('Covered fixture login control');
    return {x,y};
  })()`);
  await page.proxy.send('Input.dispatchMouseEvent', {type:'mouseMoved',...point});
  await page.proxy.send('Input.dispatchMouseEvent', {type:'mousePressed',button:'left',buttons:1,clickCount:1,...point});
  await page.proxy.send('Input.dispatchMouseEvent', {type:'mouseReleased',button:'left',buttons:0,clickCount:1,...point});
  const end = performance.now() + 2000;
  while (performance.now() < end) {
    if (await page.contents.executeJavaScript(fixtureIdentity) === 'fixture-user') return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw Error('Login marker never changed after synthetic site action');
}

async function main() {
  const report = {
    time:new Date().toISOString(), electron:process.versions.electron, chromium:process.versions.chrome,
    platform:process.platform, arch:process.arch, cases:{} as Record<string, unknown>, error:null as string|null,
  };
  let window:BrowserWindow|undefined;
  let registry:BrowserPageRegistry|undefined;
  let downloads:BrowserDownloads|undefined;
  try {
    await app.whenReady();
    window = new BrowserWindow({show:false, focusable:false, skipTaskbar:true, width:1380, height:890});
    registry = new BrowserPageRegistry({
      userData:app.getPath('userData'), window:()=>window!,
      helper:{executable:process.env.WY_STUDY_HELPER!, sha256:process.env.WY_STUDY_HELPER_HASH!},
      prepareSession:session => session.webRequest.onBeforeRequest((details, done) => {
        done({cancel:!details.url.startsWith(origin.origin + '/') && details.url !== 'about:blank'});
      }),
    });
    const page = await registry.create(taskId, projectId);
    const other = await registry.create(foreignTask, 'other-fixture-project');
    assert.notEqual(page.contents.session,other.contents.session);
    assert.throws(() => registry!.get(taskId,other.id), /本任务没有这个网页标签/u);
    await registry.navigate(page, origin.href);
    await registry.navigate(other, origin.href);
    await registry.placement(taskId,page.id,{x:30,y:20,width:1280,height:820});
    assert(registry.isMounted(page));
    await signInOnFixture(page);
    const nativeId = page.contents.id;
    const first = await runWorker('case', registry, page);
    assert.equal(first.result.status, 'passed');
    assert.equal(registry.get(taskId,page.id).contents.id,nativeId);
    assert(registry.isMounted(page));
    assert.equal(await page.contents.executeJavaScript(fixtureIdentity), 'fixture-user');
    assert.equal(await other.contents.executeJavaScript(fixtureIdentity), '');
    assert.equal(await other.contents.executeJavaScript('document.querySelector("h2").textContent'), 'catalog');
    const png = await readFile(join(root, 'selected.png'));
    assert.equal(png.subarray(0,8).toString('hex'), '89504e470d0a1a0a');
    report.cases.generatedCase = {...first, sameMountedView:true, originalPageLoginMarkerPreserved:true, otherTaskUntouched:true,
      screenshotSha256:createHash('sha256').update(png).digest('hex'),
      screenshotPixels:[png.readUInt32BE(16),png.readUInt32BE(20)]};

    const cancelled = await runWorker('cancel',registry,page);
    assert.equal(cancelled.result.status, 'cancelled');
    assert.equal(cancelled.revoked, true);
    assert.equal(cancelled.methods['Input.dispatchMouseEvent'],undefined);
    assert(registry.isMounted(page));
    assert.equal(page.contents.id,nativeId);
    report.cases.cancel = {...cancelled, sameMountedView:true};

    // Separate host-side check. The original Skill sample has no download step.
    downloads = new BrowserDownloads({directory:()=>assetDir,available:(profileId,id)=>id===taskId && profileId===page.profileId});
    downloads.install({contents:page.contents,taskId,pageId:page.id,profileId:page.profileId});
    const path = join(assetDir, 'fixture.txt');
    const expected = downloads.expect(page.contents,path,AbortSignal.timeout(5000));
    expected.start();
    page.contents.downloadURL(new URL('/download',origin).href);
    const receipt = await expected.result;
    assert.equal(receipt.pageId,page.id);
    assert.equal(receipt.taskId,taskId);
    assert.equal(receipt.path,path);
    assert.equal(await readFile(path, 'utf8'),'owned fixture download');
    assert.equal(downloads.snapshot(foreignTask).length,0);
    report.cases.hostDownload = {state:receipt.state, samePage:true, bytes:receipt.receivedBytes, contentsVerified:true, foreignTaskRows:0};
  } catch (error) { report.error=(error as Error).stack ?? String(error); }
  finally {
    try { downloads?.dispose(); await registry?.dispose(); window?.destroy(); }
    catch(error) { report.error ??= String(error); }
    await writeFile(join(root, 'result.json'),JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify(report));
    app.exit(report.error ? 1 : 0);
  }
}
void main();
