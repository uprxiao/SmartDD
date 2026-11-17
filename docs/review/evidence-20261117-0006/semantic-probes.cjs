// Review-only probes: pure exported functions and exact extracted handlers.
// No browser, DOM input, production run or real model is used.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const {createRequire} = require('node:module');
const {pathToFileURL} = require('node:url');
const root = process.cwd();
const output = __dirname;
const exp = path.join(root, 'docs/里程碑/M14_统一Agent工作区/技研/实验/20261116_复核修订验证');
const src = path.join(root, 'prototypes/m6-codex/src');
const hash = s => crypto.createHash('sha256').update(s).digest('hex');
const {buildSync} = createRequire(fs.realpathSync(path.join(root,'node_modules/vite/package.json')))('esbuild');
(async () => {
  const results = {scope:'Pure functions + exact extracted closure with explicit synthetic state; not a browser/App test'};
  const {normalizer} = await import(pathToFileURL(path.join(exp,'timeline.mjs')));
  const n = normalizer('failed-update-fixture');
  const events = [
    {driver:'claude',type:'assistant',uuid:'create',message:{content:[{type:'tool_use',id:'c1',name:'TaskCreate',input:{subject:'Keep this task pending'}}]}},
    {driver:'claude',type:'user',uuid:'created',tool_use_result:{task:{id:'1'}},message:{content:[{type:'tool_result',tool_use_id:'c1',content:'Task #1 created successfully'}]}},
    {driver:'claude',type:'assistant',uuid:'update',message:{content:[{type:'tool_use',id:'u1',name:'TaskUpdate',input:{taskId:'1',status:'completed'}}]}},
    {driver:'claude',type:'user',uuid:'failed',message:{content:[{type:'tool_result',tool_use_id:'u1',is_error:true,content:'TaskUpdate failed; no change was applied'}]}}
  ];
  const projected = events.flatMap(n);
  const finalTodo = projected.filter(x=>x.type==='todo_list').at(-1);
  results.failedTaskUpdate = {input:events,expected:'pending',actual:finalTodo.data.items[0].status,lastResult:projected.at(-1)};

  // Bundle only actual exports; do not render or interact with a page.
  const bundled = buildSync({stdin:{contents:`import {mentionItems} from ${JSON.stringify(path.join(src,'M14Extras.jsx'))}; export {mentionItems};`,resolveDir:root},bundle:true,format:'cjs',platform:'node',jsx:'automatic',write:false,nodePaths:[path.join(root,'node_modules')]}).outputFiles[0].text;
  const mod = {exports:{}};
  new Function('module','exports','require',bundled)(mod,mod.exports,require);
  const commands = caps => mod.exports.mentionItems({ch:'/',q:''},caps).map(x=>x.insert);
  results.commandMenus = {claude:commands({goal:true,compact:true}),unsupported:commands({}),note:'/review and /init have no executor capability key'};

  const text = fs.readFileSync(path.join(src,'M14TaskArea.jsx'),'utf8');
  const start = text.indexOf('const submit = () => {') + 'const submit = '.length;
  const end = text.indexOf('\n  };',start) + '\n  }'.length;
  const submitSource = text.slice(start,end);
  results.submitSource = {file:'prototypes/m6-codex/src/M14TaskArea.jsx',sha256:hash(submitSource),source:submitSource};
  results.attachmentSend = [];
  for (const state of ['preparing','failed']) for (const running of [false,true]) {
    let queued = [],toast = [],currentChips = [{id:'a',name:'fixture.png',kind:'image',state}],draft = 'Review attachment';
    const context = {text:draft,unavailable:false,req:null,a:{name:'Claude',caps:{goal:true}},running,chips:currentChips,
      setQueued:fn=>{queued=fn(queued)},setText:v=>{draft=v},setChips:v=>{currentChips=v},setFresh:()=>{},onToast:v=>toast.push(v),Date};
    vm.runInNewContext('('+submitSource+')()',context);
    results.attachmentSend.push({state,running,queued:queued.length,queuedState:queued[0]?.chips?.[0]?.state,draftAfter:draft,chipsAfter:currentChips.length,toast});
  }
  fs.writeFileSync(path.join(output,'semantic-probes.json'),JSON.stringify(results,null,2)+'\n');
  console.log(JSON.stringify({failedTaskUpdate:results.failedTaskUpdate.actual,menus:results.commandMenus,attachmentSend:results.attachmentSend}));
})().catch(e=>{console.error(e);process.exitCode=1});
