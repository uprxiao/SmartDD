import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
const { chromium }=createRequire('/Users/liubu/.npm/_npx/0b9ff77863cb6e9f/node_modules/')('playwright-core');
const out='/private/tmp/m13-review-20261111-2119';
const b=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const p=await(await b.newContext({viewport:{width:1512,height:949},locale:'zh-CN'})).newPage();p.setDefaultTimeout(10000);
const r={errors:[]};p.on('pageerror',e=>r.errors.push(e.message));const d=()=>p.locator('.m13-dialog');
const nav=async h=>{await p.evaluate(x=>{location.hash=x},h);await p.waitForTimeout(150)};
try{
 await p.goto('http://127.0.0.1:4176/?preview=m13#home');
 await p.getByLabel('任务描述').fill('审核：原智能体身份已变更');
 await p.getByRole('button',{name:'启动任务',exact:true}).click();
 await p.getByRole('button',{name:'任务信息',exact:true}).click();
 r.before=await d().locator('[data-task-info]').innerText();
 const route=await p.evaluate(()=>location.hash.slice(1));
 await d().getByRole('button',{name:'切换智能体恢复',exact:true}).click();
 await d().getByRole('button',{name:'管理智能体',exact:true}).click();
 await p.getByRole('button',{name:'Claude Code · DeepSeek 更多操作',exact:true}).click();
 await p.getByRole('menuitem',{name:'删除',exact:true}).click();
 await p.getByRole('button',{name:'Claude Code · 订阅 更多操作',exact:true}).click();
 await p.getByRole('menuitem',{name:'编辑',exact:true}).click();
 await d().getByRole('radio',{name:/DeepSeek/}).click();
 await d().getByRole('button',{name:'保存',exact:true}).click();
 await nav(route);await p.getByRole('button',{name:'任务信息',exact:true}).click();
 r.infoBeforeResume=await d().locator('[data-task-info]').innerText();
 await d().getByRole('button',{name:'切换智能体恢复',exact:true}).click();
 r.resume=await d().innerText();r.selected=await d().getByLabel('恢复使用的智能体').inputValue();
 r.recoverEnabled=await d().getByRole('button',{name:'恢复任务',exact:true}).isEnabled();
 await p.screenshot({path:out+'/identity-before-resume.png'});
 await d().getByRole('button',{name:'恢复任务',exact:true}).click();
 await p.getByRole('button',{name:'任务信息',exact:true}).click();
 r.after=await d().locator('[data-task-info]').innerText();
 await p.screenshot({path:out+'/identity-after-resume.png'});
 r.issueReproduced=r.before.includes('订阅（CLI 自己的登录）')&&r.after.includes('DeepSeek')&&r.selected==='rc-cc-login'&&!/已修改|已变更|身份|账号.*变化|重新选择/.test(r.resume);
}catch(e){r.driverError=String(e.stack);await p.screenshot({path:out+'/identity-driver-error.png'}).catch(()=>{})}
finally{writeFileSync(out+'/identity-review.json',JSON.stringify(r,null,2));await b.close()}
console.log(JSON.stringify(r,null,2));
