// Isolated synthetic Markdown runtime checks. No Codex, real files, CLI or services.
// NODE_PATH=/tmp/m9-qa/node_modules node r34-markdown-check.mjs <evidence directory> [attempt suffix]
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const { chromium } = createRequire(import.meta.url)('playwright-core');
const out = process.argv[2] || '.', suffix = process.argv[3] || 'final', checks = [], errors = [], screenshots = [];
const browser = await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const page = await (await browser.newContext({viewport:{width:1512,height:949},deviceScaleFactor:1,locale:'zh-CN'})).newPage();
page.on('pageerror', error => errors.push(error.message));
const assert = (ok, detail) => { if (!ok) throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail)); };
const step = async (id,title,run) => { try { const detail = await run(); checks.push({id,title,status:'passed',detail:detail||{}}); } catch(error) { checks.push({id,title,status:'failed',detail:{error:String(error),stack:error.stack}}); } };
const show = async (text, extra={}) => { await page.evaluate(value=>window.r34Markdown.show(value),{text,...extra}); await page.waitForFunction(value=>window.r34Markdown.state.text===value,text); await page.locator('article.fw-markdown').waitFor(); await page.evaluate(()=>window.getSelection()?.removeAllRanges()); };
const editor = () => page.locator('.fw-md-edit-block textarea');
const editState = () => page.evaluate(()=>{const el=document.querySelector('.fw-md-edit-block textarea');return el?{value:el.value,start:el.selectionStart,end:el.selectionEnd,direction:el.selectionDirection,selected:el.value.slice(el.selectionStart,el.selectionEnd),focused:document.activeElement===el}:null;});
const state = () => page.evaluate(()=>({text:window.r34Markdown.state.text,edits:window.r34Markdown.edits,selections:window.r34Markdown.selections,events:window.r34Markdown.events}));
const select = async (start, startOffset, end, endOffset, backward=false) => {
  await page.evaluate(({start,startOffset,end,endOffset,backward})=>{
    const first=document.querySelector(start),last=document.querySelector(end);
    const leaf=(element,offset)=>{const walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT);let node;while(node=walker.nextNode()){if(offset<=node.length)return {node,offset};offset-=node.length;}throw new Error('Fixture selection offset exceeds text');};
    const a=leaf(first,startOffset),b=leaf(last,endOffset),selection=window.getSelection();selection.removeAllRanges();
    selection.setBaseAndExtent(backward?b.node:a.node,backward?b.offset:a.offset,backward?a.node:b.node,backward?a.offset:b.offset);
    document.querySelector('article.fw-markdown').dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));
  },{start,startOffset,end,endOffset,backward});
};
const mapped = from => '[data-md-source-from="'+from+'"][data-md-source-mode="linear"]';
const shot = async name => { const file='r34-markdown-'+suffix+'-'+name+'.png';await page.screenshot({path:path.join(out,file),fullPage:true});screenshots.push({file,sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(out,file))).digest('hex')}); };
await page.goto('http://127.0.0.1:4176/tests/r34-markdown-runtime.html');await page.waitForFunction(()=>!!window.r34Markdown?.show);
await step('MD34-01','TypeScript 围栏使用真实高亮，未知语言安全纯文本',async()=>{
  await show('```ts\nconst 中文 = "<script>unsafe()</script>";\n```\n\n```unknown\n<img src=x onerror=unsafe()>\n```');
  assert(await page.locator('code.language-typescript .hljs-keyword').innerText()==='const','keyword missing');
  assert(await page.locator('.fw-md-fence code').nth(1).innerText()==='<img src=x onerror=unsafe()>\n','unknown code changed');
  assert(await page.locator('.fw-md-fence script,.fw-md-fence img').count()===0,'code was treated as HTML');
  const color=await page.locator('.hljs-keyword').evaluate(el=>getComputedStyle(el).color);assert(color==='rgb(130, 80, 223)',{color});return {color};
});
await step('MD34-02','未闭合或非小写 mermaid 围栏保留源码',async()=>{
  await show('```Mermaid\ngraph TD; A-->B\n```\n\n```mermaid\ngraph TD; C-->D');assert(await page.locator('.fw-md-mermaid').count()===0,'incomplete diagram rendered');assert(await page.locator('.fw-md-fence code').count()===2,'code fallback missing');
});
let lightFill;
const diagram='```mermaid\ngraph LR\n A[开始] --> B[完成]\n```\n';
await step('MD34-03','完整 Mermaid 围栏解析为浅色 SVG',async()=>{
  await page.evaluate(()=>document.documentElement.dataset.theme='light');await show(diagram);await page.locator('.fw-md-mermaid[data-md-theme="light"] svg').waitFor();lightFill=await page.locator('.fw-md-mermaid .node rect').first().evaluate(el=>getComputedStyle(el).fill);assert((await page.locator('.fw-md-mermaid').innerText()).includes('完成'),'diagram labels missing');await shot('light-diagram');return {fill:lightFill};
});
await step('MD34-04','主题按钮触发 Mermaid 重渲染，渲染内容与主题标签一致',async()=>{
  await page.getByRole('button',{name:'切换测试主题'}).click();await page.locator('.fw-md-mermaid[data-md-theme="dark"] svg').waitFor();const fill=await page.locator('.fw-md-mermaid .node rect').first().evaluate(el=>getComputedStyle(el).fill);assert(fill!==lightFill,{fill,lightFill});await shot('dark-diagram');return {fill,lightFill};
});
await step('MD34-05','连续主题变化不会显示迟到主题且清理临时渲染容器',async()=>{
  for(const theme of ['light','dark','light']){await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await page.waitForTimeout(25);}
  await page.locator('.fw-md-mermaid[data-md-theme="light"] svg').waitFor();const fill=await page.locator('.fw-md-mermaid .node rect').first().evaluate(el=>getComputedStyle(el).fill);assert(fill===lightFill,{fill,lightFill});assert(await page.locator('[id^="dfw-mermaid-"]').count()===0,'temporary container leaked');
});
await step('MD34-06','非法图表保留错误，临时 SVG 容器不泄漏',async()=>{
  await show('```mermaid\nnot-a-diagram @@\n```');await page.locator('.fw-md-mermaid-error').waitFor();assert(await page.locator('[id^="dfw-mermaid-"]').count()===0,'error container leaked');return {error:await page.locator('.fw-md-mermaid-error').innerText()};
});
await step('MD34-07','图表挂载后立即卸载不会留下绘图节点',async()=>{
  await show(diagram);await page.evaluate(()=>window.r34Markdown.update({visible:false}));await page.waitForTimeout(500);assert(await page.locator('.fw-md-mermaid,[id^="dfw-mermaid-"]').count()===0,'unmounted diagram leaked');
});
await step('MD34-08','键盘聚焦不抢进编辑，Enter 编辑，Escape 还原焦点',async()=>{
  await show('first **bold** paragraph\n\nsecond paragraph');const block=page.locator('[data-md-from="0"]').first();await block.focus();assert(await editor().count()===0,'focus opened editor');await page.keyboard.press('Enter');assert((await editState()).focused,'Enter did not focus editor');await page.keyboard.press('Escape');assert(await editor().count()===0,'Escape did not close');assert(await block.evaluate(el=>el===document.activeElement),'focus not restored');
});
await step('MD34-09','重复行内公式点击定位第二条完整源码',async()=>{
  const text='😀 $x^2$ and $x^2$ tail';await show(text);await page.locator('.katex').nth(1).click();const edit=await editState();assert(edit.selected==='$x^2$'&&edit.start===13&&edit.end===18&&edit.focused,edit);assert((await state()).edits.length===0,'click mutated document');return edit;
});
await step('MD34-10','块公式点击展开完整源码单元，不使用字形坐标',async()=>{
  const text='before\n\n$$\nx^2 + y^2\n$$\n\nafter';await show(text);await page.locator('.katex').click();const edit=await editState();assert(edit.selected==='$$\nx^2 + y^2\n$$\n',edit);assert((await page.locator('.fw-md-selection-notice').innerText()).includes('完整源码'),'atomic notice absent');return edit;
});
const cross='中文 😀 first **bold** tail\r\n\r\nsecond *中文* end\r\n';
await step('MD34-11','跨块选择按源码 token 映射中文/emoji/CRLF 和标记',async()=>{
  await show(cross);const second=cross.indexOf('second');await select(mapped(0),3,mapped(second),6);const edit=await editState(),latest=(await state()).selections.at(-1);assert(latest.from===3&&latest.to===second+6,latest);assert(edit.selected===cross.slice(3,second+6).replace(/\r\n/g,'\n')&&edit.focused,edit);assert((await page.locator('.fw-md-selection-notice').innerText()).includes('映射到原始'), 'mapping notice absent');return {edit,sourceRange:latest};
});
await step('MD34-12','反向跨块选择保留方向和源码范围',async()=>{
  await show(cross);const second=cross.indexOf('second');await select(mapped(0),0,mapped(second),6,true);const edit=await editState();assert(edit.direction==='backward'&&edit.selected===cross.slice(0,second+6).replace(/\r\n/g,'\n'),edit);return edit;
});
await step('MD34-13','实际鼠标拖动跨段后进入带源码标记的选区',async()=>{
  const text='Alpha start **bold** tail\n\nBravo ending text';await show(text);const a=await page.locator(mapped(0)).boundingBox(),b=await page.locator(mapped(text.indexOf('Bravo'))).boundingBox();await page.mouse.move(a.x+7,a.y+a.height/2);await page.mouse.down();await page.mouse.move(b.x+55,b.y+b.height/2,{steps:12});await page.mouse.up();await editor().waitFor();const edit=await editState();assert(edit.selected.includes('**bold**')&&edit.selected.includes('\n\n')&&edit.focused,edit);await shot('cross-block-selection');return edit;
});
await step('MD34-14','HTML 实体选区回到完整实体源码并告知边界',async()=>{
  const text='A &amp; B';await show(text);await select('[data-md-source-from="2"]',0,'[data-md-source-from="2"]',1);const edit=await editState();assert(edit.selected==='&amp;',edit);assert((await page.locator('.fw-md-selection-notice').innerText()).includes('完整源码单元'),'atomic fallback absent');return edit;
});
await step('MD34-15','高亮围栏内选择保留代码源码坐标',async()=>{
  const text='```ts\r\nconst 中文 = 42;\r\n```\r\n';await show(text);await select('.fw-md-fence code',6,'.fw-md-fence code',8);const edit=await editState(),selection=(await state()).selections.at(-1);assert(edit.selected==='中文'&&selection.from===text.indexOf('中文')&&selection.to===text.indexOf('中文')+2,{edit,selection});return {edit,selection};
});
await step('MD34-16','textarea 修改只替换源码范围，保留未改 CRLF/CR/LF',async()=>{
  const text='first\r\nline\nthird\r\n\r\nlast\r';await show(text);await page.locator('[data-md-from="0"]').first().click();await editor().fill('first\nLINE\nthird\n');assert((await state()).text==='first\r\nLINE\nthird\r\n\r\nlast\r',(await state()).text);await page.keyboard.press('Escape');assert((await page.locator('article').innerText()).includes('last'),'outside block lost');return {source:(await state()).text};
});
await step('MD34-17','连续编辑换行不会重建 textarea 或丢失光标',async()=>{
  await show('first paragraph\n\nlast paragraph');await page.locator('[data-md-from="0"]').first().click();await editor().evaluate(el=>el.dataset.identity='same-editor');await editor().fill('changed\nnew paragraph\n');await page.keyboard.press('End');await page.keyboard.type('!');const edit=await editState();assert(await editor().getAttribute('data-identity')==='same-editor'&&edit.focused&&edit.start===edit.end,edit);await page.keyboard.press('Escape');assert((await state()).text.endsWith('last paragraph'),'outside content overwritten');return edit;
});
await step('MD34-18','外部内容修订到达时失效旧编辑范围，保留新内容',async()=>{
  await show('old paragraph');await page.locator('[data-md-from="0"]').click();await page.evaluate(()=>window.r34Markdown.update({text:'external replacement'}));await page.waitForFunction(()=>!document.querySelector('.fw-md-edit-block textarea'));assert((await state()).text==='external replacement'&&(await state()).edits.length===0,'stale write');assert((await page.locator('.fw-md-selection-notice').innerText()).includes('重新选择'),'revision notice absent');
});
await step('MD34-19','编辑权限变只读立即关闭编辑，任务框不得写入',async()=>{
  await show('- [ ] safe task');await page.locator('[data-md-from="0"]').click({position:{x:200,y:10}});await editor().waitFor();await page.evaluate(()=>window.r34Markdown.update({readOnly:true}));await page.waitForFunction(()=>!document.querySelector('.fw-md-edit-block textarea'));assert(await page.locator('input[data-md-task-line]').isDisabled(),'readonly checkbox enabled');assert((await state()).edits.length===0,'readonly mutation');
});
await step('MD34-20','只读跨块选区可报告来源但不进入编辑',async()=>{
  const text='first\n\nsecond';await show(text,{readOnly:true});await select(mapped(0),0,mapped(7),6);const value=await state();assert(await editor().count()===0&&value.selections.at(-1).from===0&&value.selections.at(-1).to===text.length&&value.edits.length===0,value);assert(await page.evaluate(()=>!window.getSelection().isCollapsed),'readonly native selection was lost');return value;
});
await step('MD34-21','搜索 mark 包装不破坏源坐标映射',async()=>{
  const text='find 中文 again';await show(text,{findQuery:'中文'});assert(await page.locator('mark').innerText()==='中文','mark missing');await select('mark',0,'mark',2);const edit=await editState();assert(edit.selected==='中文'&&edit.start===5&&edit.end===7,edit);return edit;
});
await step('MD34-22','无法逐字投影的转义表格单元明确退回完整源码块',async()=>{
  const text='| a\\|same | same |\n|---|---|\n| first | second |\n';await show(text);await select('.fw-md-table th',0,'.fw-md-table th',6);const edit=await editState();assert(edit.selected===text,edit);assert((await page.locator('.fw-md-selection-notice').innerText()).includes('完整源码单元'),'fallback not disclosed');return edit;
});
await step('MD34-23','合成 IME 组合时 Escape 不提前退出，结束后可退出',async()=>{
  await show('compose here');await page.locator('[data-md-from="0"]').click();await editor().dispatchEvent('compositionstart',{data:'中'});await editor().dispatchEvent('keydown',{key:'Escape',code:'Escape',isComposing:true,keyCode:229,bubbles:true});assert(await editor().count()===1,'composition Escape closed');await editor().dispatchEvent('compositionend',{data:'中文'});await page.keyboard.press('Escape');assert(await editor().count()===0,'post-composition Escape failed');assert((await state()).events.some(event=>event.kind==='composition'&&event.value===true),'composition event absent');return {boundary:'Synthetic composition events; actual OS IME not exercised.'};
});
await step('MD34-24','输入后重新选择后续块使用最新源码坐标',async()=>{
  await show('one\n\ntwo **bold**');await page.locator('[data-md-from="0"]').click();await editor().fill('longer first\n');await page.keyboard.press('Escape');const value=await state(),from=value.text.indexOf('two');await page.locator('[data-md-from="'+from+'"]').click();const edit=await editState();assert(edit.value==='two **bold**'&&(await state()).selections.at(-1).from===from,{edit,from,selections:(await state()).selections});return edit;
});
await step('MD34-25','多个图表在同一主题下串行渲染且深色代码高亮可读',async()=>{
  await page.evaluate(()=>document.documentElement.dataset.theme='dark');await show(diagram+'\n'+diagram+'\n```js\nconst value = 42;\n```');
  await page.waitForFunction(()=>document.querySelectorAll('.fw-md-mermaid[data-md-theme="dark"] svg').length===2);
  const fills=await page.locator('.fw-md-mermaid .node rect').evaluateAll(nodes=>nodes.map(el=>getComputedStyle(el).fill));assert(fills.every(fill=>fill===fills[0]&&fill!==lightFill),fills);
  const color=await page.locator('.hljs-keyword').evaluate(el=>getComputedStyle(el).color);assert(color==='rgb(194, 151, 255)',{color});assert(await page.locator('[id^="dfw-mermaid-"]').count()===0,'multiple diagram container leak');await shot('multiple-dark-diagrams');return {fills,color};
});
await step('MD34-26','本组页面没有未处理 JavaScript 异常',async()=>{assert(errors.length===0,errors);return {errors};});
const report={revision:'R3.4-20261017',attempt:suffix,timestamp:new Date().toISOString(),environment:{url:page.url(),browser:await browser.version(),viewport:{width:1512,height:949},storage:'isolated synthetic fixture harness'},boundary:'Source-token mapping and whole-unit fallbacks, not CodeMirror equivalence. No Codex, real filesystem, CLI/model, real OS IME, packaged application or visual-reference parity claim.',checks,errors,screenshots,summary:{passed:checks.filter(c=>c.status==='passed').length,failed:checks.filter(c=>c.status==='failed').length}};
fs.writeFileSync(path.join(out,'r34-markdown-report-'+suffix+'.json'),JSON.stringify(report,null,2)+'\n');await browser.close();console.log(JSON.stringify(report.summary));if(report.summary.failed)process.exitCode=1;
