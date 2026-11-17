// Pure-model and exact-source handler probes. No browser, DOM interaction or production run.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const {pathToFileURL} = require('node:url');
const root = process.cwd(), out = __dirname;
const src = path.join(root,'prototypes/m6-codex/src');
const sha = x => crypto.createHash('sha256').update(x).digest('hex');
const arrow = (source, marker) => {
  const a=source.indexOf(marker); if(a<0)throw Error('missing '+marker);
  const b=source.indexOf('\n  };',a); if(b<0)throw Error('missing function end');
  return source.slice(a+marker.length,b+'\n  }'.length);
};
(async()=>{
  const model=await import(pathToFileURL(path.join(src,'m14-model.mjs')));
  const m13=await import(pathToFileURL(path.join(src,'m13-model.mjs')));
  const app=fs.readFileSync(path.join(src,'App.jsx'),'utf8');
  const area=fs.readFileSync(path.join(src,'M14TaskArea.jsx'),'utf8');
  const result={scope:'Synthetic input on actual pure exports and exact extracted handlers; not UI/model-service verification'};
  const createSource=arrow(app,'const createTask = ');
  result.createSource={sha256:sha(createSource),source:createSource};
  result.homeCreate=[];
  for(const state of [null,'preparing','failed']){
    let created=[],chips=[{id:'image',name:'fixture.png',kind:'image',...(state?{state}:{})}],prompt='Review this image';
    const config={id:'legacy-claude',name:'Existing Claude',tool:'claude',source:'native',method:'login'};
    const c={project:{id:'p1',configVersion:1},dir:{available:true,path:'/workspace/SmartDD'},profile:{id:config.id,name:config.name,runner:'claude'},
      m13Active:true,m13:{configs:[config],providers:[],plugins:[],defaults:{},bindings:[]},m14Preview:true,m14HomeSel:{agent:'cx-ds',model:'deepseek-flash',effort:'中'},m13Permission:'auto',m13Tool:'codex',
      prompt,m14HomeChips:chips,integration:{data:{}},id:()=> 'new-task',
      launchBlock:m13.launchBlock,agentSnapshot:m13.agentSnapshot,pluginSnapshot:m13.pluginSnapshot,permissionSnapshot:m13.permissionSnapshot,
      integrationSnapshot:()=>({fixture:true}),setLaunchError:()=>{},setLaunchFix:()=>{},setTasks:f=>{created=f([])},setPrompt:v=>{prompt=v},setM14HomeChips:v=>{chips=v},nav:()=>{}};
    vm.runInNewContext('('+createSource+')()',c);
    result.homeCreate.push({inputAttachmentState:state,created:created.length,promptAfter:prompt,chipsAfter:chips.length,
      task:created[0]&&{runner:created[0].runner,agent:created[0].agent,permission:created[0].permission,m14Sel:created[0].m14Sel,first:created[0].m14First}});
  }
  const branch=model.TEAM_CHILDREN.find(x=>x.branch)?.branch;
  const childRoot='~/Library/Application Support/SmartDD/worktrees/SmartDD/'+branch;
  const message='`/workspace/SmartDD/scripts/build.mjs:1`';
  const replaced=message.replaceAll('/workspace/SmartDD',childRoot);
  result.childInlineLink={branch,root:childRoot,message,replaced,segments:model.inlineSegments(replaced),relative:model.routeLink('scripts/build.mjs:1',{projectRoot:childRoot})};
  const copySource=area.slice(area.indexOf('const linkAction = ')+ 'const linkAction = '.length,area.indexOf('\n',area.indexOf('const linkAction = '))).replace(/;$/,'');
  let copied;
  vm.runInNewContext('('+copySource+')(' + JSON.stringify('copy-full')+')',{linkMenu:{href:'scripts/build.mjs',route:{path:'scripts/build.mjs'}},setLinkMenu:()=>{},onLink:()=>{},setToast:x=>{copied=x},projectRoot:'/workspace/SmartDD',ctxRoot:childRoot});
  result.childCopy={actual:copied,expectedRoot:childRoot,source:copySource};
  const resolveLine=area.split('\n').find(x=>x.includes('const resolveChild = '));
  const stateLine=area.split('\n').find(x=>x.includes('const childState = '));
  const resolveSource=resolveLine.trim().replace(/^const resolveChild = /,'').replace(/;$/,'');
  const stateSource=stateLine.trim().replace(/^const childState = /,'').replace(/;$/,'');
  let resolved={},toast;
  const context={setChildResolved:f=>{resolved=f(resolved)},setToast:x=>{toast=x}};
  const resolve=vm.runInNewContext('('+resolveSource+')',context);
  const child={id:'child-1',state:'waiting',approval:{title:'Review'},live:'等待批准'};
  resolve(child.id,'已停止该子任务本轮，挂起的请求已作废');
  const after=vm.runInNewContext('('+stateSource+')(child)',{childResolved:resolved,child});
  result.childStop={before:child,after,toast,resolveSource,stateSource};
  fs.writeFileSync(path.join(out,'focused-recheck.json'),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify({homeCreate:result.homeCreate.map(x=>({state:x.inputAttachmentState,created:x.created,prompt:x.promptAfter,runner:x.task?.runner,selected:x.task?.m14Sel?.agent})),childLink:result.childInlineLink.segments,childCopy:copied,childAfterStop:after}));
})().catch(e=>{console.error(e);process.exitCode=1});
