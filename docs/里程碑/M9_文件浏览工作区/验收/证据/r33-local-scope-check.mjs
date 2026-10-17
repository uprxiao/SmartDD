// D07=A scope check only. Reuses the local synthetic prototype, isolated browser storage.
// NODE_PATH=/tmp/m9-qa/node_modules node r33-local-scope-check.mjs <output directory>
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const {chromium}=createRequire(import.meta.url)('playwright-core');
const out=process.argv[2]||'.',checks=[],errors=[];
const check=(id,title,ok,detail={})=>checks.push({id,title,status:ok?'passed':'failed',detail});
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const p=await (await browser.newContext({viewport:{width:1512,height:949},deviceScaleFactor:1,locale:'zh-CN'})).newPage();
p.on('pageerror',e=>errors.push(e.message));
const open=async(query,name)=>{await p.getByLabel('筛选文件',{exact:true}).fill(query);await p.getByRole('treeitem').filter({hasText:name}).first().dblclick();await p.getByLabel('筛选文件',{exact:true}).fill('');};
try{
 await p.goto('http://127.0.0.1:4176/?preview=m9');await p.evaluate(()=>{localStorage.clear();sessionStorage.clear();});await p.reload();
 await p.getByRole('button',{name:/M9 交互样例/}).click();
 check('R33-01','文件区移除远程演示开关，保留本地筛选与左终端',await p.getByLabel('远程环境（模拟）',{exact:true}).count()===0&&await p.getByLabel('筛选文件',{exact:true}).isVisible()&&await p.locator('.terminal-mount').isVisible());
 await p.getByLabel('筛选文件',{exact:true}).fill('main');await p.getByRole('treeitem').filter({hasText:'main.ts'}).first().click({button:'right'});
 check('R33-02','本地树文件右键仍可复制路径、另存和加入引用',await p.getByRole('button',{name:'复制路径',exact:true}).isVisible()&&await p.getByRole('button',{name:'另存为…',exact:true}).isVisible()&&await p.getByRole('button',{name:'添加到终端引用',exact:true}).isVisible());await p.keyboard.press('Escape');
 await open('main','main.ts');await p.getByRole('button',{name:'文件查看选项',exact:true}).click();await p.getByRole('button',{name:'扩展文件查看器（模拟）',exact:true}).click();
 check('R33-03','扩展viewer演示只呈现本地资源，未恢复远程文件入口',(await p.locator('.fw-content').innerText()).includes('本地资源')&&!(await p.locator('.fw-content').innerText()).includes('远程'));
 const screenshot=path.join(out,'r33-local-file-workspace.png');await p.screenshot({path:screenshot});
 await p.getByRole('button',{name:'返回默认查看器',exact:true}).click();await p.getByLabel('文件状态场景',{exact:true}).selectOption('save-error');
 const failed=(await p.locator('.fw-save-strip').innerText()).includes('保存失败');
 await open('large.log','large.log');const readonly=await p.getByRole('textbox',{name:'文件编辑器',exact:true}).evaluate(el=>el.readOnly);
 await p.getByLabel('文件状态场景',{exact:true}).selectOption('unsupported');
 const unknown=await p.getByRole('heading',{name:'不支持预览此文件',exact:true}).isVisible();
 check('R33-04','普通保存失败、只读大文件、未知格式边界仍可操作',failed&&readonly&&unknown,{failed,readonly,unknown});
 check('R33-05','受影响页面没有未处理异常',errors.length===0,{errors});
}catch(error){check('R33-RUN','local scope focused execution',false,{error:String(error),stack:error.stack});}
finally{
 const screenshot=path.join(out,'r33-local-file-workspace.png');const report={revision:'R3.3-20261017',timestamp:new Date().toISOString(),environment:{url:'http://127.0.0.1:4176/?preview=m9',browser:await browser.version(),viewport:{width:1512,height:949},storage:'isolated synthetic fixtures'},boundary:'Only D07=A affected UI smoke checks. No real disk, CLI, SSH/SFTP, Codex, native drag/voice, packaged app or full 155-model/24-browser rerun.',checks,errors,screenshots:fs.existsSync(screenshot)?[{file:path.basename(screenshot),sha256:crypto.createHash('sha256').update(fs.readFileSync(screenshot)).digest('hex')}]:[],summary:{passed:checks.filter(x=>x.status==='passed').length,failed:checks.filter(x=>x.status==='failed').length}};
 fs.writeFileSync(path.join(out,'r33-local-scope-report.json'),JSON.stringify(report,null,2)+'\n');await browser.close();console.log(JSON.stringify(report.summary));if(report.summary.failed)process.exitCode=1;
}
