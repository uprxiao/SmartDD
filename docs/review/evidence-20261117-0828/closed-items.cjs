// Offline checks of the actual normalizer, command exports and Composer submit closure.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url'),{createRequire}=require('node:module');
const root=process.cwd(),out=__dirname,src=path.join(root,'prototypes/m6-codex/src');
const {buildSync}=createRequire(fs.realpathSync(path.join(root,'node_modules/vite/package.json')))('esbuild');
(async()=>{
 const {AGENTS}=await import(pathToFileURL(path.join(src,'m14-model.mjs')));
 const build=buildSync({stdin:{contents:`export {mentionItems,slashBlocked} from ${JSON.stringify(path.join(src,'M14Extras.jsx'))}`,resolveDir:root},bundle:true,jsx:'automatic',platform:'node',format:'cjs',write:false,nodePaths:[path.join(root,'node_modules')]});
 const mod={exports:{}};new Function('module','exports','require',build.outputFiles[0].text)(mod,mod.exports,require);
 const {mentionItems,slashBlocked}=mod.exports;
 const menus=[];
 for(const id of ['cc-sub','cx-ds','oc']){
  const a=AGENTS.find(x=>x.id===id),commands=mentionItems({ch:'/',q:''},a.caps).map(x=>x.insert);
  const blocked=Object.fromEntries(['/goal','/compact','/review','/init'].map(c=>[c,slashBlocked(c+' fixture',a.caps)]));
  menus.push({id,commands,blocked});
 }
 assert(!menus[0].commands.includes('/review'));assert(menus[0].commands.includes('/init'));
 assert(menus[1].commands.includes('/review'));assert(!menus[1].commands.includes('/init'));
 assert.equal(menus[0].blocked['/review'],'/review');assert.equal(menus[1].blocked['/init'],'/init');
 const source=fs.readFileSync(path.join(src,'M14TaskArea.jsx'),'utf8');const a=source.indexOf('const submit = ')+'const submit = '.length,b=source.indexOf('\n  };',a)+'\n  }'.length,submit=source.slice(a,b);
 const attachments=[];
 for(const state of ['preparing','failed',null])for(const running of [false,true]){
  let draft='Keep draft',chips=[{id:'attachment',name:'fixture.png',kind:'image',...(state?{state}:{})}],queue=[],toast=[];
  const cx={text:draft,chips,running,unavailable:false,req:null,a:AGENTS.find(x=>x.id==='cc-sub'),slashBlocked,Date,
   setQueued:f=>{queue=f(queue)},setText:v=>{draft=v},setChips:v=>{chips=v},setFresh:()=>{},onToast:x=>toast.push(x)};
  vm.runInNewContext('('+submit+')()',cx);
  if(state){assert.equal(draft,'Keep draft');assert.equal(chips.length,1);assert.equal(queue.length,0)}
  else {assert.equal(draft,'');assert.equal(chips.length,0);assert.equal(queue.length,running?1:0)}
  attachments.push({state,running,draft,chips:chips.length,queue:queue.length,toast});
 }
 const result={scope:'Pure command helpers and exact Composer closure with synthetic state; not homepage/UI/real model',menus,attachments};
 fs.writeFileSync(path.join(out,'closed-items.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({menus:menus.map(x=>({id:x.id,commands:x.commands})),attachmentCases:attachments.length,allPassed:true}));
})().catch(e=>{console.error(e);process.exitCode=1});
