// Isolated local synthetic prototype. No Codex, user browser profile, native files or app launches.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const { chromium } = createRequire(import.meta.url)('playwright-core');
const out = process.argv[2] || path.dirname(fileURLToPath(import.meta.url));
fs.mkdirSync(out,{recursive:true});
const checks=[],errors=[],shots=[];
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const context=await browser.newContext({viewport:{width:1512,height:949},deviceScaleFactor:1,locale:'zh-CN'}),p=await context.newPage();
p.setDefaultTimeout(6000);p.on('pageerror',error=>errors.push(error.message));
const check=(id,title,ok,detail={})=>{checks.push({id,title,status:ok?'passed':'failed',detail});console.log(id,ok?'PASS':'FAIL',title);};
const row=path=>p.locator(`[role=treeitem][data-path=${JSON.stringify(path)}]`);
const tree=()=>p.getByRole('tree',{name:'文件目录'}),filter=()=>p.getByLabel('筛选文件',{exact:true});
const settle=async()=>{await p.waitForFunction(()=>document.querySelector('[role=tree]')?.getAttribute('aria-busy')==='false');await p.waitForTimeout(100);};
const scroll=async value=>{await tree().evaluate((el,v)=>{el.scrollTop=v;},value);await p.waitForTimeout(70);};
const query=async value=>{await filter().fill(value);await settle();};
const shot=async name=>{const file=path.join(out,name);await p.screenshot({path:file});shots.push({file:name,sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')});};
const fresh=async()=>{await p.goto('http://127.0.0.1:4176/?preview=m9');await p.evaluate(()=>{localStorage.clear();sessionStorage.clear();});await p.reload();await settle();await p.getByRole('button',{name:/M9 交互样例/}).click();};
try {
  await fresh();
  check('I01','初次只查询根及已展开目录，未递归加载全部子目录',Number(await p.locator('.fw-tree-region').getAttribute('data-loaded-directories'))<=3);
  await p.getByLabel('文件树数据场景').selectOption('large');await settle();await scroll(0);
  await row('大目录').click();await p.waitForTimeout(180);await row('大目录/模块-01').click();await p.waitForTimeout(180);
  const total=Number(await p.locator('.fw-tree-region').getAttribute('data-total-rows')),dom=await p.getByRole('treeitem').count();
  check('I02','6,000合成文件按目录懒加载，250子文件使用有界虚拟DOM',total>250&&dom<50,{total,dom,loaded:await p.locator('.fw-tree-region').getAttribute('data-loaded-directories')});
  await scroll(1200);check('I03','滚动后显示粘性祖先目录，虚拟行总数仍受控',(await p.locator('.fw-sticky-folders').innerText()).includes('模块-01')&&await p.getByRole('treeitem').count()<50);
  const visibleRow=p.getByRole('treeitem').filter({hasText:'文件-'}).first();await visibleRow.focus();await p.keyboard.press('End');await p.waitForTimeout(120);
  check('I04','End能聚焦未挂载的末行并正确滚入视区',await p.evaluate(()=>document.activeElement?.dataset.path==='package.json'),{focused:await p.evaluate(()=>document.activeElement?.dataset.path),scrollTop:await tree().evaluate(el=>el.scrollTop)});
  await p.keyboard.press('Home');await p.waitForTimeout(100);check('I05','Home恢复首行且只有一个Tab停靠点',await p.locator('[role=treeitem][tabindex="0"]').count()===1&&await tree().evaluate(el=>el.scrollTop)<50);
  // Search covers unopened subtrees and asynchronously clears old candidates.
  await query('模块-24/文件-0250');const last=row('大目录/模块-24/文件-0250.ts');await last.waitFor();
  check('I06','文件名候选能检索从未展开的第24目录',await last.isVisible());await last.dblclick();await query('');await p.waitForTimeout(250);
  const active=row('大目录/模块-24/文件-0250.ts');await active.waitFor();
  const placement=await active.evaluate(el=>{const r=el.getBoundingClientRect(),t=el.closest('[role=tree]').getBoundingClientRect();return {top:r.top,bottom:r.bottom,treeTop:t.top,treeBottom:t.bottom};});
  check('I07','打开检索文件后展开祖先并nearest定位，文件行留在视区',placement.top>=placement.treeTop&&placement.bottom<=placement.treeBottom+1,placement);
  await shot('r34-interaction-large-tree-light.png');
  // Error and empty rows are distinct and do not hide another directory's data.
  await scroll(0);await row('大目录').waitFor();
  await row('大目录/模块-01').click();await p.waitForTimeout(100); // collapse the long first group
  await row('大目录/模块-24').click();await p.waitForTimeout(100);await scroll(0);
  await row('大目录/读取失败').click();await p.getByRole('alert').filter({hasText:'无法读取目录'}).waitFor();
  check('I08','子目录读取失败展示可重试错误，不伪装空目录',await p.getByRole('alert').filter({hasText:'无法读取目录'}).isVisible());
  await p.getByRole('alert').getByRole('button',{name:'重试',exact:true}).click();await p.waitForTimeout(150);
  check('I09','目录重试完成后真实切换为空状态，失败提示清除',await p.getByRole('alert').count()===0&&(await tree().innerText()).includes('此目录为空'));
  await p.getByLabel('搜索服务场景').selectOption('slow');await filter().fill('文件-0001');await p.waitForTimeout(70);await filter().fill('zz-no-match');await p.waitForTimeout(950);
  check('I10','慢候选快速换query时旧结果不会覆盖新结果',(await tree().innerText()).includes('未找到匹配')&&await p.getByRole('treeitem').count()===0);
  await filter().fill('模块-24');await p.waitForTimeout(80);await p.getByRole('button',{name:'选择工作目录',exact:true}).click();await p.getByRole('menuitemradio').filter({hasText:'共享文档'}).click();await p.waitForTimeout(900);
  check('I11','候选在途切根后不把旧query或结果写入新根',await filter().inputValue()===''&&!await tree().getAttribute('aria-busy').then(v=>v==='true'));
  await p.getByLabel('搜索服务场景').selectOption('error');await filter().fill('main');await p.getByRole('alert').filter({hasText:'候选服务失败'}).waitFor();
  check('I12','候选失败保留输入并提供重试',await filter().inputValue()==='main');await p.getByRole('alert').getByRole('button',{name:'重试',exact:true}).click();await settle();await row('src/main.ts').waitFor();
  check('I13','候选重试可恢复正常结果',await row('src/main.ts').isVisible());
  // Tooltip actual timing, keyboard focus and dismissal.
  await fresh();await query('main');const main=row('src/main.ts');await main.hover();await p.waitForTimeout(300);
  check('I14','路径tooltip不早于500ms显示',await p.getByRole('tooltip').count()===0);await p.waitForTimeout(260);
  check('I15','路径tooltip随后显示完整本机路径且允许文本选择',(await p.getByRole('tooltip').innerText()).endsWith('/src/main.ts')&&await p.getByRole('tooltip').evaluate(el=>getComputedStyle(el).userSelect==='text'));
  await p.keyboard.press('Escape');check('I16','Escape立即关闭tooltip',await p.getByRole('tooltip').count()===0);
  await query('main');await filter().focus();await p.keyboard.press('ArrowDown');await p.waitForTimeout(560);
  check('I17','键盘focus-visible触发路径tooltip',await p.getByRole('tooltip').count()===1);await p.keyboard.press('Escape');
  await main.hover();await p.waitForTimeout(560);await tree().dispatchEvent('scroll');check('I18','目录滚动立即关闭tooltip',await p.getByRole('tooltip').count()===0);
  // External app discovery is scoped to the opened menu and has retry/disabled states.
  await p.getByLabel('外部应用能力场景').selectOption('loading');await main.click({button:'right'});
  check('I19','外开列表加载中禁用启动并给出加载状态',await p.getByRole('button',{name:'使用 Visual Studio Code 打开',exact:true}).isDisabled()&&(await p.getByRole('menu').innerText()).includes('正在读取'));
  await p.keyboard.press('Escape');await p.getByLabel('外部应用能力场景').selectOption('error');await main.click({button:'right'});await p.getByRole('button',{name:'重新读取应用列表',exact:true}).waitFor();await p.getByRole('button',{name:'重新读取应用列表',exact:true}).click();await p.waitForTimeout(200);
  check('I20','外开列表失败后可重试，恢复首选项且保留复制路径',await p.getByRole('button',{name:'使用 Visual Studio Code 打开',exact:true}).isEnabled()&&await p.getByRole('button',{name:'复制路径',exact:true}).isVisible());await p.keyboard.press('Escape');
  await p.getByLabel('外部应用能力场景').selectOption('unavailable');await main.click({button:'right'});check('I21','无外开能力仍显示说明和复制路径',await p.getByRole('button',{name:'使用 Visual Studio Code 打开',exact:true}).isDisabled()&&(await p.getByRole('menu').innerText()).includes('未提供外部应用'));await p.keyboard.press('Escape');
  await query('');await p.getByLabel('变化文件上下文').check();check('I22','generated筛选只在变化文件上下文出现',await p.getByLabel('筛除生成文件').count()===1);await scroll(100000);const generatedVisible=await row('package.json').count()===1;await p.getByLabel('筛除生成文件').check();check('I23','generated筛除保留其他变化文件并隐藏指定生成文件',generatedVisible&&await row('package.json').count()===0);await p.getByLabel('变化文件上下文').uncheck();
  // Streaming fulltext and successful/failed cancellation branches.
  await p.getByLabel('文件树数据场景').selectOption('large');await p.getByLabel('搜索服务场景').selectOption('slow');await p.getByRole('button',{name:'在文件中搜索',exact:true}).click();await p.getByLabel('搜索文件内容',{exact:true}).fill('needle');await p.waitForTimeout(600);
  check('I24','全文搜索500ms后显示忙状态',await p.locator('.fw-search-mask').innerText().then(t=>t.includes('搜索中')));await p.getByLabel('搜索文件内容',{exact:true}).fill('needle-24-0250');await p.waitForFunction(()=>document.querySelector('.fw-search-results')?.getAttribute('aria-busy')==='false',{},{timeout:10000});
  const searchHits=p.locator('.fw-search-results [role="option"]'),hitTexts=await searchHits.allTextContents();
  check('I25','全文旧请求取消，新结果保留正确文件和多字节列定位',hitTexts.length===1&&hitTexts[0].includes('大目录/模块-24/文件-0250.ts:2:22'),{hits:hitTexts,busy:await p.locator('.fw-search-results').getAttribute('aria-busy')});await p.keyboard.press('Escape');
  check('I26','关闭全文搜索返焦点且终端仍在',await p.getByRole('button',{name:'在文件中搜索',exact:true}).evaluate(el=>el===document.activeElement)&&await p.locator('.terminal-mount').isVisible());
  // Existing drag contract, using real browser drag events on the virtual tree.
  await p.getByRole('button',{name:'更多',exact:true}).click();await p.getByText('恢复',{exact:true}).first().click();await p.locator('dialog[aria-label="恢复任务"]').getByRole('button',{name:'恢复任务',exact:true}).click();await p.waitForFunction(()=>!document.querySelector('.terminal-paused'));
  await p.getByLabel('搜索服务场景').selectOption('ready');await query('拖放');await row('docs/拖放 空格示例.txt').dragTo(p.locator('.terminal-stage'));await p.waitForTimeout(150);
  const terminal=(await p.locator('.terminal-mount .xterm-rows').innerText()).replace(/\u00a0/g,' ');
  check('I27','虚拟树文件拖放保留完整路径且不自动发送',terminal.replace(/\s/g,'').includes('/workspace/SmartDD/docs/拖放空格示例.txt')&&(await p.locator('.terminal-drop-notice').innerText()).includes('未发送'));
  const geometry=await row('docs/拖放 空格示例.txt').evaluate(el=>({height:el.getBoundingClientRect().height,font:getComputedStyle(el).fontSize,icon:el.querySelector('.fw-file-icon')?.getBoundingClientRect().width}));
  check('I29','可比静态常量：树行28px、文字13px、文件图标16px',geometry.height===28&&geometry.font==='13px'&&geometry.icon===16,geometry);
  await p.getByRole('button',{name:'切换原型主题',exact:true}).click();await row('docs/拖放 空格示例.txt').hover();await p.waitForTimeout(560);
  check('I30','深色状态下tooltip和文件树使用主题而非仅换背景',await p.evaluate(()=>document.documentElement.dataset.theme==='dark')&&await p.getByRole('tooltip').isVisible());
  await shot('r34-interaction-dark-tooltip.png');
  check('I28','本轮界面无未处理运行异常',errors.length===0,{errors});
} catch(error) {check('I-RUN','interaction execution',false,{error:String(error),stack:error.stack});await shot('r34-interaction-failure.png');}
finally {
  const report={requirementRevision:'R3.3-20261017',iteration:'r34-interaction',timestamp:new Date().toISOString(),environment:{url:'http://127.0.0.1:4176/?preview=m9',browser:await browser.version(),viewport:{width:1512,height:949},DPR:1,locale:'zh-CN'},boundary:'Synthetic local prototype only. No Codex/native file provider/real IME/touch/screenreader/OS apps/packaged app or all-state reference parity. Actual HTML drag only, no native file/speech integration.',checks,shots,errors,summary:{passed:checks.filter(c=>c.status==='passed').length,failed:checks.filter(c=>c.status==='failed').length}};
  fs.writeFileSync(path.join(out,'r34-interaction-report.json'),JSON.stringify(report,null,2)+'\n');await browser.close();console.log(JSON.stringify(report.summary));if(report.summary.failed)process.exitCode=1;
}
