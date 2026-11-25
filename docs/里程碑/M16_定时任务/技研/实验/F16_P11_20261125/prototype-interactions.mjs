import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
const repo=process.env.F16_REPO_ROOT??fileURLToPath(new URL('../../../../../../',import.meta.url));
const prototype=join(repo,'prototypes/m6-codex');
const rq=createRequire(join(repo,'package.json'));
const pq=createRequire(join(prototype,'package.json'));
const {JSDOM}=rq('jsdom');
const dom=new JSDOM('<div id="root"></div>',{url:'http://127.0.0.1:5186/?preview=m16&f35=1&theme=light'});
for(const name of ['window','document','location','HTMLElement','HTMLInputElement','HTMLTextAreaElement','HTMLSelectElement','Event','MouseEvent'])globalThis[name]=name==='window'?dom.window:dom.window[name];
globalThis.addEventListener=dom.window.addEventListener.bind(dom.window);
globalThis.removeEventListener=dom.window.removeEventListener.bind(dom.window);
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const React=pq('react'),{act}=React,{createRoot}=pq('react-dom/client');
const {createServer}=await import(pathToFileURL(join(prototype,'node_modules/vite/dist/node/index.js')).href);
const cacheDir=mkdtempSync(join(tmpdir(),'m16-preview-'));
const vite=await createServer({root:prototype,configFile:false,esbuild:{jsx:'automatic'},cacheDir,optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,hmr:false,ws:false,watch:null},appType:'custom',resolve:{dedupe:['react','react-dom']}});
const module=await vite.ssrLoadModule('/src/M16SchedulePreview.jsx');
const projects=[{id:'smartdd',name:'WillYou',dirs:[{id:'git',label:'主目录',path:'/workspace/SmartDD',isDefault:true,vcs:'Git'}]},{id:'ais',name:'AIS',dirs:[{id:'svn',label:'主目录',path:'/workspace/AIS',isDefault:true,vcs:'SVN'}]}];
const tasks=[{id:'review',title:'检查多平台安装包',project:'smartdd',runner:'codex',cwd:'/worktree/existing-review',model:'gpt-6.2-sol'},{id:'common',title:'通用旧任务',project:null,runner:'claude',cwd:'/workspace/common'}];
let captured;
function Root({scenario=''}){captured=module.useM16SchedulePreview(projects,tasks,scenario);return React.createElement(React.Fragment,null,React.createElement(module.M16ScheduleSidebar,{state:captured}),React.createElement(module.M16ScheduleWorkspace,{state:captured,dark:false,onTheme(){}}))}
const root=createRoot(document.querySelector('#root'));
const text=()=>document.body.textContent,button=(label,scope=document)=>[...scope.querySelectorAll('button')].find(el=>el.textContent.trim()===label);
const field=label=>[...document.querySelectorAll('.m16-field')].find(el=>el.firstElementChild?.textContent===label)?.querySelector('input,select,textarea');
const options=label=>[...field(label).options];
const status=()=>captured.runs.find(r=>r.id===captured.runId)?.status;
async function click(label,scope=document){const el=typeof label==='string'?button(label,scope):label;assert(el,'missing '+label);const disclosure=el.closest('details:not([open])');if(disclosure){await act(async()=>disclosure.querySelector('summary').click());assert(disclosure.open)}await act(async()=>el.click())}
async function value(el,val){assert(el);await act(async()=>{Object.getOwnPropertyDescriptor(el.constructor.prototype,'value').set.call(el,val);el.dispatchEvent(new dom.window.Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}))})}
async function select(label,val){await value(field(label),val)}
async function newPlan(name,prompt){await click('新建计划',document.querySelector('.m16-sidebar'));await select('计划名称',name);await select('任务提示词',prompt)}
async function openLatest(){const row=document.querySelector('.m16-history-row:not(.header)');assert(row);await click(row.querySelector('button'))}
async function closeRun(){await click('返回计划',document.querySelector('[aria-label=运行详情]'))}
async function scenario(id){await value(document.querySelector('[aria-label="模拟调度场景"]'),id);await click('模拟触发')}
const done = name=>console.log('PASS '+name);
try{
 await act(async()=>root.render(React.createElement(Root)));
 assert(text().includes('P1.1')&&text().includes('每月知识整理'));
 await click([...document.querySelectorAll('.m16-plan-main')].find(el=>el.textContent.includes('每日研发摘要')));await click('查看结果');
 assert(document.querySelector('[aria-label=运行详情]'));assert(!document.querySelector('[role=dialog]'));
 assert(document.querySelector('[role=tab][aria-selected=true]').textContent.includes('运行结果'));assert(text().includes('最终回复')&&text().includes('待推进')&&text().includes('研发摘要.md'));
 assert.equal(document.querySelector('.m16-run-config').open,false);
 await click(document.querySelector('.m16-artifact-link'));assert.equal(document.querySelector('.m16-artifact-link').getAttribute('aria-expanded'),'true');assert(text().includes('研发摘要（合成示例）'));
 await click('执行过程');assert(text().includes('读取项目研发记录')&&text().includes('智能体最终回复'));
 await click('查看完整任务');assert(document.querySelector('[aria-label=本次任务回合预览]'));assert.equal(captured.runId,'seed-1');assert(text().includes('整理项目最近的提交和未完成事项'));
 await click('返回运行记录');assert(document.querySelector('[role=tab][aria-selected=true]').textContent.includes('执行过程'));
 await click(document.querySelector('[aria-label=下一条运行记录]'));assert.equal(captured.runId,'seed-2');assert(text().includes('本次未执行')&&text().includes('前次运行尚未结束'));assert(!button('查看完整任务'));assert(!text().includes('最终回复'));
 await click('执行过程');assert(text().includes('尚无已确认的任务回合'));assert(!document.querySelector('.m14-bubble'));
 await click(document.querySelector('[aria-label=上一条运行记录]'));assert.equal(captured.runId,'seed-1');assert(document.querySelector('[aria-label=上一条运行记录]').disabled);
 await closeRun();await click('全部计划'+captured.plans.filter(p=>!p.archived).length,document.querySelector('.m16-sidebar'));assert(!document.querySelector('[aria-label=运行详情]'));
 done('result-first full page, artifact disclosure, recorded timeline, original task preview, same-plan navigation and skipped record');
 await click('新建计划',document.querySelector('.m16-sidebar'));await click('创建计划');assert(text().includes('请输入计划名称'));
 await select('计划名称','通用 Cron 计划');await select('任务提示词','整理合成数据');
 await select('项目（可选）','');assert(!field('工作区'));await select('通用工作目录','local');
 await click('创建计划');assert(text().includes('请选择本机绝对目录'));
 await select('本机目录（合成路径）','/workspace/common-test');await select('频率','cron');
 await select('Cron 表达式','99 8 * * *');await click('创建计划');assert(document.querySelector('[role=dialog]'));
 await select('Cron 表达式','0 9 * * 1-5');assert.equal(document.querySelectorAll('.m16-next-preview b').length,3);
 await select('权限','auto');await select('智能体','agy-hub');assert(!options('权限').some(o=>o.value==='auto'));assert.equal(field('权限').value,'ask');
 await select('模型','gemini-4-argon');assert.equal(field('推理强度').value,'低');await select('推理强度','高');await select('权限','full');
 await click([...document.querySelectorAll('.m16-checkbox')].find(e=>e.textContent.includes('启用多 Agent')).querySelector('input'));
 await click([...document.querySelectorAll('.m16-checkbox')].find(e=>e.textContent.includes('完成时也')).querySelector('input'));
 await click('创建计划');assert(text().includes('请确认权限'));await click('确认并保存');assert(!document.querySelector('[role=dialog]'));assert(text().includes('未关联项目')&&text().includes('通用 Cron 计划'));
 const general=captured.selected;assert.equal(captured.plans.find(p=>p.id===general).localPath,'/workspace/common-test');done('optional project/local directory, cron validation and three preview dates, AGY effort/permission, delegation and success notification');
 await click('立即运行');let count=captured.runs.length;await click('立即运行');assert.equal(captured.runs.length,count);assert(text().includes('前次运行尚未结束'));
 await scenario('due');assert.equal(captured.runs[0].status,'skipped');assert.equal(captured.runs[0].taskId,null);
 await click('查看执行');await click('邮件审批');assert.equal(status(),'waiting');
 assert(text().includes('邮件发送需本人逐次批准'));assert(!button('完成',document.querySelector('[aria-label=运行详情]')));
 await closeRun();await click('通知演示'+(captured.notifications.length)); // sidebar text includes count
 await click([...document.querySelectorAll('.m16-notice-row')][0]);assert.equal(status(),'waiting');await click('本人处理完成（合成）');assert.equal(status(),'running');
 const originalId=captured.runId,originalTask=captured.runs.find(r=>r.id===originalId).taskId;await click('查看完整任务');assert(document.querySelector('[aria-label=本次任务回合预览]'));assert(text().includes('不是新建会话'));assert.equal(captured.runId,originalId);assert.equal(captured.runs.find(r=>r.id===originalId).taskId,originalTask);await click('返回运行记录');await click('完成');assert.equal(status(),'completed');await closeRun();
 assert(text().includes('未关联项目 · 通用任务'));
 await click('编辑');await select('权限','ask');await click('保存修改');assert(text().includes('请确认权限'));await click('取消权限变更');assert.equal(field('权限').value,'full');await select('权限','ask');await click('保存修改');await click('确认并保存');assert.equal(captured.plans.find(p=>p.id===general).permission,'ask');assert.equal(captured.runs.find(r=>r.planId===general&&r.status==='completed').permission,'full');
 done('manual busy no duplicate, scheduled skip, mail waiting, notification/locate, independent plan permission confirmation and common task grouping');
 await newPlan('工作树计划','核对合成项目');await select('项目（可选）','ais');assert.equal(options('工作区').length,1);
 await select('项目（可选）','smartdd');await select('工作区','per_run');assert(options('任务去向').find(o=>o.value==='reuse').disabled);
 await select('工作区','dedicated');await select('任务去向','reuse');assert(field('基准分支'));
 await select('任务去向','existing');await select('继续的任务','review');assert(field('模型').disabled);assert(field('权限').disabled);assert(text().includes('/worktree/existing-review'));
 await click('创建计划');const bound=captured.selected;await scenario('startup');assert.equal(captured.runs[0].attempts,2);
 await openLatest();await click('完成');await closeRun();await scenario('binding');assert(captured.plans.find(p=>p.id===bound).needsRepair);assert(text().includes('需要重新确认计划配置'));
 await click('查看并重新确认');assert(document.querySelector('[aria-label="重新确认计划"]'));await click('确认变化');assert(!captured.plans.find(p=>p.id===bound).needsRepair);
 await click('立即运行');await openLatest();await click('停止本次运行');assert.equal(status(),'stopped');await closeRun();
 done('Git/SVN restrictions, combinations, existing task actual cwd and locked config, startup retry, reconfirmation, stop');
 await newPlan('单次任务','只运行一次');await select('频率','once');await click('创建计划');
 const once=captured.selected,due=captured.plans.find(p=>p.id===once).nextAt;assert(due);
 await click('立即运行');await openLatest();await click('完成');await closeRun();
 assert.equal(captured.plans.find(p=>p.id===once).nextAt,due);
 await scenario('due');await openLatest();await click('完成');await closeRun();
 assert.equal(captured.plans.find(p=>p.id===once).ended,true);assert(text().includes('已结束'));
 await click('立即运行');await openLatest();assert.equal(status(),'running');await closeRun();
 await click(document.querySelector('[aria-label="删除计划"]'));await click('删除计划');assert(captured.plans.find(p=>p.id===once).archived);assert(text().includes('单次任务'));
 await click(document.querySelector('[aria-label="查看单次任务"]'));await openLatest();assert.equal(status(),'running');await click('停止本次运行');assert.equal(status(),'stopped');await closeRun();
 done('once manual before due, ended/manual, delete active retains record and stop');
 await newPlan('月末任务','每月最后一天');await select('频率','monthly');assert.equal(field('每月日期').value,'last');await click('创建计划');await scenario('unknown');await openLatest();assert.equal(status(),'unknown');
 assert(!button('再次运行（新记录）',document.querySelector('[aria-label=运行详情]')));await click('原回执已确认');assert.equal(status(),'running');await click('失败');assert.equal(status(),'failed');await click('再次运行（新记录）');assert.equal(captured.runs[0].status,'running');assert.equal(captured.runs[1].status,'failed');
 done('month-end, unknown reconciliation before retry, failed run retained');
 for(const [scenario,expected] of [['failed','本次运行失败'],['partial','执行期间输出'],['running','读取示例需求记录'],['waiting','本人处理完成（合成）'],['unknown','核对原提交结果']]){
   await act(async()=>root.render(React.createElement(Root,{key:scenario,scenario})));
   assert(document.querySelector('[aria-label=运行详情]'));assert(!document.querySelector('[role=dialog]'));assert(text().includes(expected),scenario);
   if(scenario==='partial'){assert(captured.notifications.some(n=>n.runId===captured.runId));assert(!text().includes('最终回复'));assert(text().includes('非最终结论'));assert(button('查看完整任务'));}
   if(scenario==='failed'){assert(!button('查看完整任务'));await click('执行过程');assert(!document.querySelector('.m14-bubble'));}
   if(scenario==='waiting'||scenario==='running'){assert(document.querySelector('[role=tab][aria-selected=true]').textContent.includes('执行过程'));await click('运行结果');assert(!text().includes('最终回复'));}
   if(scenario==='unknown'){assert(captured.notifications.some(n=>n.runId===captured.runId));assert(!button('再次运行（新记录）'));assert(!button('查看完整任务'));assert(!button('停止本次运行'));const id=captured.runId;await click('原回执已确认');assert.equal(captured.runId,id);assert.equal(status(),'running');assert(button('查看完整任务'));}
 }
 done('direct review routes: predispatch failure, partial failure, running, waiting, unknown and in-place reconciliation');
 console.log('M16 P1.1 interaction groups: 7/7 passed');
}finally{await act(async()=>root.unmount());await vite.close();dom.window.close();rmSync(cacheDir,{recursive:true,force:true})}
