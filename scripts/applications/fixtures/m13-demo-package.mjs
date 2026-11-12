import {mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {resolve,join,dirname,basename} from 'node:path';
import {fileURLToPath} from 'node:url';

/** Creates test input only. Does not inspect, install, execute or grant trust. */
export function buildDemoPackage(destination,{version='0.4.0',failInitialize=false,dropDetail=false}={}){
 const root=resolve(destination);
 if(!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)||existsSync(root))throw Error('Fresh destination and numeric version required');
 const object=properties=>({type:'object',additionalProperties:false,properties});
 const text={type:'string'},row={...object({id:text,title:text}),required:['id','title']};
 const files=new Map();
 const json=(path,value)=>files.set(path,Buffer.from(JSON.stringify(value,null,2)+'\n'));
 json('runtime/fixture.json',{version,failInitialize});
 files.set('runtime/main.mjs',readFileSync(new URL('./m13-demo-runtime.mjs',import.meta.url)));
 json('schemas/list.input.json',object({delayMs:{type:'integer',minimum:0,maximum:3000},mode:{type:'string',enum:['normal','crash']}}));
 json('schemas/add.input.json',{...object({title:{type:'string',minLength:1,maxLength:200}}),required:['title']});
 json('schemas/get.input.json',{...object({id:text}),required:['id']});
 json('schemas/items.output.json',{...object({version:text,account:text,items:{type:'array',items:row}}),required:['version','account','items']});
 json('schemas/detail.output.json',{...object({fields:{...object({id:text,title:text,body:text,version:text,account:text}),required:['id','title','body','version','account']}}),required:['fields']});
 const cap=(title,semantics,input,output)=>({title,semantics,permission:'demo-tracker.'+(semantics==='read'?'read':'write'),retry:semantics==='read'?'safe-read':'never',slots:['demo-local'],input:'schemas/'+input,output:'schemas/'+output});
 const capabilities={
  'demo-tracker.items.list':cap('列出合成待办','read','list.input.json','items.output.json'),
  'demo-tracker.items.add':cap('新增合成待办','write','add.input.json','items.output.json'),
  ...(!dropDetail?{'demo-tracker.items.get':cap('读取合成详情','read','get.input.json','detail.output.json')}:{})
 };
 const panel={id:'items',title:'合成待办',kind:'list',refresh:true,requires:{projectConnection:'demo-local',emptyAction:'projectSelection'},source:{capability:'demo-tracker.items.list',items:'items'},rowKey:'id',columns:[{field:'id',title:'编号'},{field:'title',title:'标题'}],...(!dropDetail?{onRowOpen:{detail:'item'},details:{item:{titleTemplate:'合成待办 #{row.id}',source:{capability:'demo-tracker.items.get',input:{id:'{row.id}'}},sections:[{kind:'fields',from:'fields'}]}}}:{})};
 const manifest={schema:'willyou-plugin/v0-draft2',id:'demo-tracker',version,hostApi:1,displayName:'Demo Tracker',description:'P1 完整合成夹具：本地列表、详情、连接、延迟调用及回滚。',author:{name:'WillYou P1 Synthetic QA'},permissions:[],providers:[{id:'demo-local',displayName:'本地合成账号',config:{...object({account:{type:'string',minLength:1,maxLength:40,title:'合成账号'}}),required:['account']},summaryFields:['account'],secret:{title:'公开测试值 P1_PUBLIC_ONLY',required:true,modes:['token','password']}}],projectPolicy:{connectionsPerProject:1},capabilities,runtime:{type:'process',entry:'runtime/main.mjs',protocol:'jsonrpc-stdio/1'},skills:['skills'],ui:{panels:[panel]}};
 json('.willyou-plugin/plugin.json',manifest);
 files.set('skills/query/SKILL.md',Buffer.from('---\nname: query\ndescription: P1 public synthetic Demo Tracker acceptance\n---\n{{WILLYOU_APPLICATION}}\n{{WILLYOU_ENTRYPOINTS}}\nUse only these host tools for synthetic items. A write needs a one-time host decision. Never replay an unknown write. delayMs is only for bounded lifecycle acceptance. No external service or real credentials.\n'));
 for(const [path,bytes]of files){const target=join(root,path);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,bytes);}
 return{root,manifest,files};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const root=resolve(process.argv[2]??'');
 if(!basename(root).startsWith('willyou-m13-'))throw Error('Explicit new willyou-m13-* test root required');
 mkdirSync(root,{recursive:false});
 const results=[['0.4.0',{}],['0.5.0',{}],['0.6.0',{failInitialize:true}],['0.5.0-drop',{version:'0.5.0',dropDetail:true}]].map(([name,options])=>buildDemoPackage(join(root,'demo-tracker-'+name),{version:name,...options}));
 writeFileSync(join(root,'fixture-boundary.json'),JSON.stringify({schema:1,scope:'Test package preparation only; not installation authorization or acceptance',versions:results.map(p=>({path:p.root,version:p.manifest.version})),network:false,realCredentials:false,publicTestValue:'P1_PUBLIC_ONLY',failureAlias:'0.5.0-drop has numeric manifest0.5.0 and removes detail capability',replacesOldFixtures:false},null,2)+'\n');
 console.log(JSON.stringify({root,packages:results.length,installed:false}));
}
