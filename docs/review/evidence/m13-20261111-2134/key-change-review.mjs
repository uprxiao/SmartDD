import {createRequire} from 'node:module';
import {writeFileSync} from 'node:fs';
const {chromium}=createRequire('/Users/liubu/.npm/_npx/0b9ff77863cb6e9f/node_modules/')('playwright-core');
const out='/private/tmp/m13-review-20261111-2134';
const b=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const p=await(await b.newContext({viewport:{width:1512,height:949},locale:'zh-CN'})).newPage();p.setDefaultTimeout(10000);
const r={errors:[]};p.on('pageerror',e=>r.errors.push(e.message));const d=()=>p.locator('.m13-dialog');
const nav=async h=>{await p.evaluate(x=>{location.hash=x},h);await p.waitForTimeout(150)};
try{
 await p.goto('http://127.0.0.1:4183/?preview=m13#home');
 await p.getByRole('button',{name:'选择智能体',exact:true}).click();
 await p.locator('.profile-choice-menu [role=menuitem]').filter({hasText:'Claude Code · DeepSeek'}).click();
 await p.getByLabel('任务描述').fill('检查凭据修订流程');
 await p.getByRole('button',{name:'启动任务',exact:true}).click();
 await p.getByRole('button',{name:'任务信息',exact:true}).click();
 const route=await p.evaluate(()=>location.hash.slice(1));r.before=await d().locator('[data-task-info]').innerText();
 await d().getByRole('button',{name:'切换智能体恢复',exact:true}).click();
 await d().getByRole('button',{name:'管理智能体',exact:true}).click();
 await nav('settings/ai/providers/deepseek');
 r.keyBefore=(await d().innerText()).match(/Key\n[^\n]+/)?.[0];
 await d().getByRole('button',{name:'更换',exact:true}).click();
 await d().getByLabel('新的 Key',{exact:true}).fill('sk-synthetic-review-5678');
 await d().getByRole('button',{name:'保存',exact:true}).click();
 r.keyAfter=(await d().innerText()).match(/Key\n[^\n]+/)?.[0];
 await p.screenshot({path:out+'/key-updated.png'});
 await d().getByRole('button',{name:'完成',exact:true}).click();
 await nav(route);await p.getByRole('button',{name:'任务信息',exact:true}).click();
 await d().getByRole('button',{name:'切换智能体恢复',exact:true}).click();
 r.resume=await d().innerText();r.identityNoticeCount=await d().locator('[data-resume-identity]').count();
 r.selected=await d().getByLabel('恢复使用的智能体').inputValue();r.recoverEnabled=await d().getByRole('button',{name:'恢复任务',exact:true}).isEnabled();
 await p.screenshot({path:out+'/key-change-resume.png'});
 r.issueReproduced=r.keyAfter?.includes('5678')&&r.identityNoticeCount===0&&r.selected==='rc-cc-ds'&&r.recoverEnabled;
}catch(e){r.driverError=String(e.stack);await p.screenshot({path:out+'/key-driver-error.png'}).catch(()=>{})}
finally{writeFileSync(out+'/key-change-review.json',JSON.stringify(r,null,2));await b.close()}
console.log(JSON.stringify(r,null,2));
