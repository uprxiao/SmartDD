import assert from'node:assert/strict';import{join,basename}from'node:path';import{sha}from'./io.mjs';
export async function runViewerMenuCases({app:rawApp,ui,mode,oracle,project,persist,screenshot,fingerprints,trace,setStage,poll}){
 const original=oracle.originalMD,html=oracle.originalHTML,scratch=mode.runtime,r=mode,q=JSON.stringify;
 const open=async name=>{await ui.insert('[aria-label="筛选文件"]',name);const path=project+'/'+name;await poll(()=>rawApp.evaluate(`(()=>{const e=document.querySelector('.fw-name-results');return e?.getAttribute('aria-busy')==='false'&&[...e.querySelectorAll('[role=option]')].filter(x=>x.title===${JSON.stringify(path)}).length===1})()`),15000);await ui.click('.fw-name-results [role=option][title='+JSON.stringify(path)+']');};
 const app={evaluate:(...x)=>rawApp.evaluate(...x),waitFor:(...x)=>rawApp.waitFor(...x),invoke:(...x)=>rawApp.invoke(...x),cdp:(...x)=>rawApp.cdp(...x),click:(...x)=>ui.click(...x),open,screenshot:path=>screenshot(mode,basename(path))};
 const mark=async stage=>{setStage(stage);mode.stage=stage;await persist();};
 const configuration={adapters:[{id:'f01-local',name:'A F01 本机只读资源',enabled:true,suffixes:['.md','.html','.pdf'],sources:['project-directory'],provider:{kind:'local-resource',writable:false}}],preferred:{'.md':'f01-local','.html':'f01-local','.pdf':'f01-local'}};
 const cm="document.querySelector('.fw-editor-host .cm-content')?.cmTile?.root?.view";
 const snapshot=()=>app.evaluate(`(()=>{const v=${cm};return{resource:!!document.querySelector('.fw-content pre'),resourceText:document.querySelector('.fw-content pre')?.textContent,cm:!!v,doc:v?.state.doc.toString(),selected:v?.state.sliceDoc(v.state.selection.main.from,v.state.selection.main.to),selection:v?.state.selection.toJSON(),focus:v?.hasFocus,tabCount:document.querySelectorAll('.fw-tab').length,tabTitles:[...document.querySelectorAll('.fw-tab [role=tab]')].map(x=>x.title),menu:!!document.querySelector('.fw-file-menu'),dialog:document.querySelector('[role=dialog]')?.textContent,notice:[...document.querySelectorAll('[role=status]')].map(x=>x.textContent)}})()`);
async function menu(label){await app.click('[aria-label=文件菜单]');await app.waitFor("!!document.querySelector('.fw-file-menu')");await app.click('.fw-file-menu [role=menuitem]',label);await app.waitFor("!document.querySelector('.fw-file-menu')");}
async function register(){await menu('管理扩展文件查看器…');await app.waitFor("!!document.querySelector('[role=dialog] textarea[aria-label=文件查看器适配清单]')");const selector='[role=dialog] textarea[aria-label=文件查看器适配清单]';await app.click(selector);for(const type of ['keyDown','keyUp'])await app.cdp('Input.dispatchKeyEvent',{type,key:'a',code:'KeyA',modifiers:4,commands:['selectAll']});await app.cdp('Input.insertText',{text:JSON.stringify(configuration,null,2)});await app.waitFor(`document.querySelector(${q(selector)})?.value===${q(JSON.stringify(configuration,null,2))}`);await app.click('[role=dialog] button','保存登记');await app.waitFor("!document.querySelector('[role=dialog]')");}
async function extension(){await app.waitFor("document.querySelector('.fw-save-strip[role=status]')?.textContent.includes('A F01 本机只读资源')&&!!document.querySelector('.fw-content pre')",15000);assert.equal((await snapshot()).tabCount,1);}
async function builtin(kind){await app.waitFor(kind==='pdf'?"!!document.querySelector('.fw-pdf canvas[data-rendered=true]')":`!!${cm}`,20000);assert.equal((await snapshot()).tabCount,1);}
async function searchRange(needle,expected){
 const traceStart=(await trace()).length;
 await app.click('[aria-label=在文件中搜索]');await app.waitFor("document.activeElement?.getAttribute('aria-label')==='全文搜索内容'");
 for(const type of ['keyDown','keyUp'])await app.cdp('Input.dispatchKeyEvent',{type,key:'a',code:'KeyA',modifiers:4,commands:['selectAll']});
 await app.cdp('Input.insertText',{text:needle});await app.waitFor("document.querySelectorAll('[role=dialog] [data-search-row]').length===1");
 const rows=await app.evaluate("[...document.querySelectorAll('[role=dialog] [data-search-row]')].map(x=>x.textContent)");
 await app.click('[role=dialog] [data-search-row]');await app.waitFor("!document.querySelector('.fw-search-dialog')");
 await app.waitFor(`!!${cm}&&${cm}.state.sliceDoc(${cm}.state.selection.main.from,${cm}.state.selection.main.to)===${q(needle)}`,10000);
 const state=await snapshot(),calls=(await trace()).slice(traceStart);assert.equal(state.doc,expected.replace(/\r\n/g,'\n'));assert.equal(state.selected,needle);assert.equal(state.tabCount,1);assert(!calls.some(x=>x.method==='open'));
 const from=expected.replace(/\r\n/g,'\n').indexOf(needle);assert.equal(state.selection.ranges[0].anchor,from);assert.equal(state.selection.ranges[0].head,from+needle.length);
 return{rows,state};
}
async function documentView(kind){await app.waitFor(kind==='html'?"document.querySelector('.fw-html-preview .sr-only')?.textContent.includes('文档已加载')":`!!${cm}`,15000);assert.equal((await snapshot()).tabCount,1);}

 await mark('real-registration-precondition');await app.open('route.md');await builtin('md');await register();await extension();
 for(const theme of ['light','dark']){await app.invoke('appSettings.update','theme','y'+theme);for(const kind of ['md','html','pdf']){
  if(theme==='light'&&kind==='md')continue; // Original001 complete; Root composes exact six later.
  await mark(theme+':'+kind+':existing-viewer-choices');const name='route.'+kind;
  if(await app.evaluate('document.querySelectorAll(".fw-tab").length>0')){const current=await app.evaluate("document.querySelector('.fw-tab-close')?.getAttribute('aria-label')");await app.click('[aria-label='+q(current)+']');await app.waitFor("document.querySelectorAll('.fw-tab').length===0");}
  const start=(await trace()).length;await app.open(name);await extension();const automatic=await snapshot();await menu('内置文件查看器');await builtin(kind);const internal=await snapshot();await menu('A F01 本机只读资源');await extension();const explicit=await snapshot();await menu('自动选择查看器');await extension();const backAutomatic=await snapshot();
  let sourceNavigation,toggleDocument,toggleSource;
  if(kind!=='pdf'){
   if(kind==='html'){await menu('内置文件查看器');await builtin(kind);await app.click('[aria-label=查看文档]');await documentView(kind);await menu('A F01 本机只读资源');await extension();}
   sourceNavigation=await searchRange(kind==='md'?'NEEDLE_ROUTE_NAV':'NEEDLE_HTML_NAV',kind==='md'?original:html);await app.screenshot(join(scratch,`${theme}-${kind}-search-selected.png`));
   await menu('A F01 本机只读资源');await extension();await app.click('[aria-label=查看文档]');await documentView(kind);toggleDocument=await snapshot();
   await menu('A F01 本机只读资源');await extension();await app.click('[aria-label=查看源码]');await builtin(kind);toggleSource=await snapshot();
  }
  const calls=(await trace()).slice(start),source=calls.find(x=>x.method==='open'&&x.delivered)?.output;assert(source);const sessions=calls.filter(x=>x.method==='openViewer'&&x.delivered);assert(sessions.length>=2);for(const s of sessions){assert.equal(s.args[0].ref.id,source.ref.id);assert.equal(s.args[0].baseHash,r.before[name].sha256);assert.equal(sha(Buffer.from(s.output.resource.base64,'base64')),r.before[name].sha256);assert.equal(s.output.writable,false);}assert.equal(calls.filter(x=>x.method==='open').length,1);r.checks.push({theme,kind,scenario:'actual viewer menu choices, validated search range and explicit source/document mode priority on same document',sourceId:source.ref.id,automatic,internal,explicit,backAutomatic,sourceNavigation,toggleDocument,toggleSource,sessionIds:sessions.map(x=>x.output.id),pass:true});await persist();
 }}

 if(await app.evaluate('document.querySelectorAll(".fw-tab").length>0')){const close=await app.evaluate("document.querySelector('.fw-tab-close').getAttribute('aria-label')");await app.click('[aria-label='+q(close)+']');await app.waitFor('!document.querySelector(".fw-tab")');}
 mode.closedSessions=await poll(async()=>{const rows=await trace(),opened=rows.filter(x=>x.method==='openViewer'&&x.delivered),closed=rows.filter(x=>x.method==='closeViewer'&&x.delivered);return opened.length&&opened.every(x=>closed.some(y=>y.args[0]===x.output.id))?{opened:opened.map(x=>x.output.id),closed:closed.map(x=>x.args[0])}:null;},15000);
 assert.deepEqual(await fingerprints(),mode.before);await persist();
}
