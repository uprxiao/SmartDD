// Display-only acceptance: compare visible package rows to trusted public declarations.
// Does not install, grant or invoke tools, and does not mutate business state.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {definitions} from '../../../resources/applications/definitions.mjs';
const labels=JSON.parse(await readFile(new URL('../../../src/shared/application-permission-labels.json',import.meta.url),'utf8'));
const properties=['fontFamily','fontSize','fontWeight','lineHeight','letterSpacing','color','display','flexWrap','overflowWrap','minWidth','paddingTop','paddingBottom','gap','alignItems'];
async function measure(app){
 return app.evaluate(`(()=>{const content=document.querySelector('.m10-content'),section=document.querySelector('.m10-package-contents');if(!content||!section)throw Error('Open package contents required');const rect=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}},box=rect(content),clip={left:Math.max(0,box.x),top:Math.max(0,box.y),right:Math.min(innerWidth,box.right),bottom:Math.min(innerHeight,box.bottom)},style=e=>Object.fromEntries(${JSON.stringify(properties)}.map(p=>[p,getComputedStyle(e)[p]])),clear=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&[Math.min(6,r.width/2),r.width/2,Math.max(r.width-6,r.width/2)].every(dx=>e.contains(document.elementFromPoint(r.left+dx,r.top+r.height/2)))};return{viewport:{width:innerWidth,height:innerHeight},theme:document.documentElement.classList.contains('ydark')||document.documentElement.dataset.theme==='dark'?'dark':'light',clip,scrollTop:content.scrollTop,scrollHeight:content.scrollHeight,rows:[...section.querySelectorAll(':scope>div')].map(row=>({name:row.querySelector('span')?.textContent,effect:row.querySelector('small')?.textContent,rect:rect(row),nameRect:rect(row.querySelector('span')),effectRect:rect(row.querySelector('small')),clientWidth:row.clientWidth,scrollWidth:row.scrollWidth,unobscured:clear(row.querySelector('span'))&&clear(row.querySelector('small')),style:style(row),nameStyle:style(row.querySelector('span')),effectStyle:style(row.querySelector('small'))})),footer:rect(section.querySelector('p:last-child')),footerUnobscured:clear(section.querySelector('p:last-child'))}})()`);
}
async function wheel(app,deltaY){
 const point=await app.evaluate(`(()=>{const c=document.querySelector('.m10-content'),r=c.getBoundingClientRect(),x=(Math.max(0,r.left)+Math.min(innerWidth,r.right))/2,y=(Math.max(0,r.top)+Math.min(innerHeight,r.bottom))/2;if(!c.contains(document.elementFromPoint(x,y)))throw Error('Scroll point is covered');return{x,y}})()`);
 await app.cdp('Input.dispatchMouseEvent',{type:'mouseWheel',...point,deltaX:0,deltaY});
 await app.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))');
 return{...point,deltaY};
}
async function capture(app,root,name){
 const result=await app.cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
 await writeFile(join(root,name),Buffer.from(result.data,'base64'));
}
async function checkWindows({app,result,root,applicationId,theme,layer}){
 assert(root.startsWith('/private/tmp/willyou-m10-'));
 await app.waitFor('!document.querySelector(".m10-toast,[data-sonner-toast]")',6000);
 const own=await app.mainEvaluate(`(()=>{const E=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');if(E.app.getPath('userData')!==${JSON.stringify(join(root,'userdata'))})throw Error('Only own package-window test');const windows=E.BrowserWindow.getAllWindows();if(windows.length!==1)throw Error('Single test window required');const w=windows[0];return{minimum:w.getMinimumSize(),content:w.getContentSize()}})()`);
 const data={applicationId,theme,layer,native:own,samples:[],transientNotificationsAbsent:true,boundary:'Native window resize,guarded real wheel and elementFromPoint occlusion checks;no business mutation'};
 result.packageWindowChecks??=[];result.packageWindowChecks.push(data);
 const resize=async minimum=>{
  const content=await app.mainEvaluate(`(()=>{const E=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');if(E.app.getPath('userData')!==${JSON.stringify(join(root,'userdata'))})throw Error('Only own window');const w=E.BrowserWindow.getAllWindows()[0];${minimum?'w.setSize(...w.getMinimumSize(),false)':'w.setContentSize('+own.content.join(',')+',false)'};return w.getContentSize()})()`);
  await app.waitFor(`innerWidth===${content[0]}&&innerHeight===${content[1]}`);return content;
 };
 try{
  for(const size of ['regular','minimum']){
   const nativeContent=await resize(size==='minimum');
   const sample={size,nativeContent,frames:[],inputs:[],seen:[]};data.samples.push(sample);
   let state=await measure(app),seen=new Set(),initialScroll=state.scrollTop;
   for(let frame=0;frame<32;frame++){
    assert.equal(state.theme,theme);sample.frames.push(state);
    if(process.env.WILLYOU_PACKAGE_WRAP_PARITY==='1')for(const row of state.rows){assert.equal(row.nameStyle.minWidth,'0px',layer+' '+row.name+' minWidth must match validated App wrapping');assert.equal(row.nameStyle.overflowWrap,'anywhere',layer+' '+row.name+' overflowWrap must match validated App wrapping');}
    for(const row of state.rows){
     assert(row.scrollWidth<=row.clientWidth+1,`${size} ${row.name} row horizontally overflows`);
     assert(row.nameRect.x>=row.rect.x-1&&row.nameRect.right<=row.rect.right+1,`${size} ${row.name} name horizontally overflows`);
     if(row.rect.y>=state.clip.top-1&&row.rect.bottom<=state.clip.bottom+1&&row.unobscured)seen.add(row.name);
    }
    sample.seen=[...seen];
    const missing=state.rows.find(row=>!seen.has(row.name));
    const target=missing?.rect??state.footer;
    const visible=target.y>=state.clip.top-1&&target.bottom<=state.clip.bottom+1;
    const file=theme+'-'+applicationId+'-package-'+size+'-'+frame+'.png';
    await capture(app,root,file);sample.lastScreenshot=file;
    if(!missing&&visible&&state.footerUnobscured)break;
    assert(frame<31,'Bounded package scroll did not expose all rows/footer');
    const delta=target.bottom>state.clip.bottom?Math.min(target.bottom-state.clip.bottom+16,(state.clip.bottom-state.clip.top)*0.6):Math.max(target.y-state.clip.top-16,-(state.clip.bottom-state.clip.top)*0.6);
    const before=state.scrollTop;sample.inputs.push(await wheel(app,delta));
    await app.waitFor(`Math.abs(document.querySelector('.m10-content').scrollTop-${before})>0.5`,5000);
    state=await measure(app);
   }
   assert.equal(seen.size,state.rows.length);sample.allRowsAndFooterReached=true;
   state=await measure(app);
   if(Math.abs(state.scrollTop-initialScroll)>1){sample.inputs.push(await wheel(app,initialScroll-state.scrollTop));await app.waitFor(`Math.abs(document.querySelector('.m10-content').scrollTop-${initialScroll})<=1`,5000);}
  }
 }finally{await resize(false);}
}
export async function checkPackageDeclarations({app,result,root,applicationId,theme,layer}){
 const declaration=definitions.find(d=>d.appId===applicationId);assert(declaration);
 const expected=declaration.tools.map(t=>({name:t.name,effect:t.annotations.readOnlyHint?'读取':Object.hasOwn(labels,t.permission)?labels[t.permission].effect:'作用范围待核对'}));
 const observed=await app.evaluate(`(()=>{const section=document.querySelector('.m10-package-contents');if(!section)throw Error('Open package contents required');const rows=[...section.querySelectorAll(':scope>div')];return{rows:rows.map(row=>({name:row.querySelector('span')?.textContent,effect:row.querySelector('small')?.textContent})),actions:section.querySelectorAll('button,a,input,select').length,viewport:{width:innerWidth,height:innerHeight},theme:document.documentElement.classList.contains('ydark')||document.documentElement.dataset.theme==='dark'?'dark':'light'}})()`);
 assert.deepEqual(observed.rows,expected);assert.equal(observed.actions,0);assert.equal(observed.theme,theme);
 result.packageDeclarationChecks??=[];result.packageDeclarationChecks.push({applicationId,theme,layer,declaredPackageVersion:declaration.version,...observed,at:new Date().toISOString(),boundary:'Displayed public metadata only; no capability invocation or authentication proof'});
 await checkWindows({app,result,root,applicationId,theme,layer});
}
