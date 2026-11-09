import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const root=process.argv[2],bytes=await readFile(join(root,'result.json')),r=JSON.parse(bytes),o=r.observations;
const site=o.back?.tab.url?.replace(/\/a$/,''),same=(x,url)=>x?.tab.url===url&&x.ui.address===url&&!x.tab.loading;
const clean=r.appClosed===true&&r.fixtureServerClosed===true;
const checks={
 T008:{back:same(o.back,site+'/a'),forward:same(o.forward,site+'/b'),loading:o.loading?.tab.loading===true&&o.loading.ui.stop===true,stopped:o.stopped?.tab.loading===false&&o.stopped.ui.stop===false&&o.stopped.tab.failure===null,hardReload:r.requests.slice(r.hardReloadRequestOffset).some(q=>q.url==='/a'&&q.cacheControl?.includes('no-cache'))},
 T010:{redirect:same(o.redirect,site+'/a?redirected'),title:o.titleIcon?.tab.title==='Changed title',newDocumentClearsIcon:o.localFile?.tab.favicon===null,favicon:o.titleIcon?.tab.favicon?.startsWith('data:image/png;base64,')===true,rollback:o.failed?.ui.address===site+'/a'&&o.failed.tab.failure?.url===r.failedTarget&&o.failed.tab.url===site+'/a'},
 T014:{prompt:o.externalPrompt?.ui.notice?.includes('是否用外部应用打开 willyoutest://x')===true,cancelled:!o.externalCancelled?.ui.notice,javascript:o.javascript?.page?.executed==='1'&&same(o.javascript,site+'/a?redirected')&&!o.javascript.ui.notice,data:o.data?.page?.url===site+'/a?redirected'&&same(o.data,site+'/a?redirected')&&!o.data.ui.notice},
 T007_A:{localFile:o.localFile?.page?.text==='Local HTML works'&&o.localFile.tab.url.startsWith('file:'),scriptBlocked:o.fileScript?.page===site+'/file-script'&&o.fileScript.tab.url===site+'/file-script',redirectBlocked:o.fileRedirect?.tab.url===site+'/a'&&o.fileRedirect.ui.address===site+'/a'},
 T011_A_localOnly:{error:o.failed?.tab.failure?.kind==='not-running'&&o.failed.tab.failure.errorName==='ERR_CONNECTION_REFUSED'&&o.failed.failureText.includes('服务启动后会自动重新加载'),recovered:same(o.recovered,r.failedTarget)&&o.recovered.tab.failure===null}
};
const cases=Object.fromEntries(Object.entries(checks).map(([id,c])=>[id,{checks:c,passed:clean&&Object.values(c).every(Boolean)}]));
const verdict={at:new Date().toISOString(),sourceSha256:createHash('sha256').update(bytes).digest('hex'),asarSha256:r.asarSha256,layer:'A actual packaged App; T007 lacks separate I, T011 lacks other six classes',cleanup:clean,cases,passed:clean&&Object.values(cases).every(c=>c.passed)};
await writeFile(join(root,'navigation-adjudication.json'),JSON.stringify(verdict,null,2)+'\n');console.log(JSON.stringify(verdict));if(!verdict.passed)process.exitCode=1;
