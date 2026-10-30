// SR: synthetic resource UI only; no product IPC or real source access.
import assert from 'node:assert/strict';
import {join} from 'node:path';

export async function checkPrototypeResourceRead({app,result,root,userData,click,theme,scenario}){
 const record=result.resourceRead??={contexts:[],checks:[],boundary:'P fixed synthetic text and UI-held callbacks; no App/provider or system claim'};
 const outer=scenario==='html'?'.m10-html-preview':'.m10-attachment-preview',scope=outer+' .m10-prototype-resource';
 const expression=source=>`(()=>{const p=document.querySelector(${JSON.stringify(scope)});${source}})()`;
 const localState=()=>app.evaluate("localStorage.getItem('willyou-m10-prototype-v2')");
 const error='合成资源暂时不可读，请核对后重试。';
 async function release(){await click(scope+' button','交回内容读取 · 合成');}
 async function keyboardRetry(){
  const selector=scope+' .m10-empty button';
  for(let i=0;i<100&&!await app.evaluate('document.activeElement?.matches('+JSON.stringify(selector)+')');i++)
   for(const type of ['keyDown','keyUp'])await app.cdp('Input.dispatchKeyEvent',{type,key:'Tab',code:'Tab',windowsVirtualKeyCode:9,nativeVirtualKeyCode:48});
  assert(await app.evaluate('document.activeElement?.matches('+JSON.stringify(selector)+')'));
  await app.cdp('Input.dispatchKeyEvent',{type:'keyDown',key:' ',code:'Space',text:' ',unmodifiedText:' ',windowsVirtualKeyCode:32,nativeVirtualKeyCode:49});
  await app.cdp('Input.dispatchKeyEvent',{type:'keyUp',key:' ',code:'Space',windowsVirtualKeyCode:32,nativeVirtualKeyCode:49});
  result.inputs.push({source:'SR',theme,scenario,keyboard:'Tab + Space on resource Retry'});
 }
 for(const size of ['regular','minimum']){
  const context={theme,scenario,size,frames:[]};record.contexts.push(context);const saved=await localState();
  await app.mainEvaluate(`(()=>{const E=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');if(E.app.getPath('userData')!==${JSON.stringify(userData)})throw Error('Own SR P required');E.BrowserWindow.getAllWindows()[0].setContentSize(${size==='regular'?'1400,900':'700,500'},false);return true})()`);
  await app.waitFor(`innerWidth===${size==='regular'?1400:700}&&innerHeight===${size==='regular'?900:500}&&document.fonts.status==='loaded'`);
  const full=await app.evaluate(expression("return p.querySelector('.m10-resource-view pre').textContent;"));
  const frame=async label=>{const file=`${theme}-${scenario}-${size}-sr-${label}.png`;await app.screenshot(join(root,file));context.frames.push(file);};
  await click(scope+' summary','内容读取演示 · 仅合成');
  await click(scope+' [aria-label="启用分块内容演示"]');
  await app.waitFor(expression("return [...p.querySelectorAll('button')].some(e=>e.textContent==='继续读取内容');"));
  const partial=await app.evaluate(expression("return p.querySelector('pre').textContent;"));assert(full.startsWith(partial)&&partial!==full);
  await click(scope+' [aria-label="下次内容读取失败"]');await click(scope+' button','继续读取内容');
  await app.waitFor(expression('return p.textContent.includes('+JSON.stringify(error)+');'));
  assert.equal(await app.evaluate(expression("return p.querySelector('pre').textContent;")),partial);
  await frame('partial-error');record.checks.push({theme,scenario,size,name:'Failed continuation preserves this opening partial text'});
  await click(scope+' [aria-label="暂存内容读取"]');await click(scope+' button','继续读取内容');
  await app.waitFor(expression("return [...p.querySelectorAll('button')].some(e=>e.textContent==='继续读取内容'&&e.disabled);"));
  assert(!await app.evaluate(expression('return p.textContent.includes('+JSON.stringify(error)+")||[...p.querySelectorAll('button')].some(e=>e.textContent==='重试');")));
  assert.equal(await app.evaluate(expression("return p.querySelector('pre').textContent;")),partial);
  await frame('continuing');await release();await app.waitFor(expression('return p.querySelector("pre")?.textContent==='+JSON.stringify(full)+';'));
  record.checks.push({theme,scenario,size,name:'Held continuation hides stale failure and conflicting Retry,then completes fixed text'});
  await click(scope+' [aria-label="下次内容读取失败"]');await click(scope+' button','重新核对内容 · 合成');
  await app.waitFor(expression("return p.textContent.includes('正在读取原内容…')&&!p.querySelector('pre');"));
  await frame('revalidation');await release();await app.waitFor(expression('return p.textContent.includes('+JSON.stringify(error)+')&&!p.querySelector("pre");'));
  await keyboardRetry();await app.waitFor(expression("return p.textContent.includes('正在读取原内容…')&&!p.querySelector('pre')&&!p.querySelector('.m10-empty');"));
  await release();await app.waitFor(expression('return p.querySelector("pre")?.textContent==='+JSON.stringify(partial)+';'));
  await click(scope+' button','继续读取内容');await release();await app.waitFor(expression('return p.querySelector("pre")?.textContent==='+JSON.stringify(full)+';'));
  await frame('complete');record.checks.push({theme,scenario,size,name:'Explicit keyboard Retry revalidates first part without old text or error;explicit Continue completes again'});
  await click(scope+' button','重新核对内容 · 合成');await app.waitFor(expression("return p.textContent.includes('正在读取原内容…');"));
  if(scenario==='html')await click('.m10-html-preview>summary','HTML 正文 · 安全文本预览');else await click(outer+'>button','收起附件文字');
  await app.waitFor('!document.querySelector('+JSON.stringify(scope)+')');
  if(scenario==='html')await click('.m10-html-preview>summary','HTML 正文 · 安全文本预览');else await click(outer+'>button','查看附件文字');
  await app.waitFor(expression('return p?.querySelector("pre")?.textContent==='+JSON.stringify(full)+';'));
  assert(await app.evaluate(expression("return !p.querySelector('[aria-label=\"暂存内容读取\"]').checked&&[...p.querySelectorAll('button')].find(e=>e.textContent==='交回内容读取 · 合成').disabled;")));
  assert.equal(await localState(),saved);await frame('fresh-opening');context.statePreserved=true;
  record.checks.push({theme,scenario,size,name:'Collapse abandons held synthetic callback;fresh opening has no pending read or persisted mutation'});
 }
}
