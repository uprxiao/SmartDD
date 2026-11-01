// Test-only immutable original upstream: local synthetic records, no real network or credentials.
'use strict';
const fs=require('node:fs'),readline=require('node:readline');
const mode=process.argv[2],argv=process.argv.slice(3),audit=event=>fs.appendFileSync(process.env.WILLYOU_FIXTURE_AUDIT,JSON.stringify({...event,pid:process.pid,argv,home:process.env.HOME})+'\n');
if(mode==='cli'&&argv.length===1&&argv[0]==='--version'){audit({event:'version'});process.stdout.write('1.0.0\n');process.exit(0);}
const credential=JSON.parse(fs.readFileSync(process.env.WILLYOU_UPSTREAM_CREDENTIAL_FILE,'utf8')).credential;
function execute(name,args){
 audit({event:'invoke',name,args});
 if(typeof credential!=='string'||!credential.startsWith('SYNTHETIC_'))throw Error('auth');
 if(name!=='mapped_read')throw Error('unmapped');
 if(args.fault==='stderr-error')throw Error('stderr');
 if(args.fault==='wrong-shape')return{records:'invalid-but-exit-zero',nextCursor:null};
 if(args.fault==='json-string')return 'signed in successfully';
 const rows=args.pageIndex===2?[{id:'second',raw:args.literal??'raw-second'}]:[{id:'first',raw:args.literal??'raw-first'}],nextCursor=args.pageIndex===2?null:'page:2';
 if(args.fault==='thin')return{rows:rows.map(r=>[r.id,r.raw]),next:nextCursor};
 return{records:rows,nextCursor};
}
const send=value=>process.stdout.write(JSON.stringify(value)+'\n');
if(mode==='cli'){
 const i=argv.indexOf('--json');if(i!==2||argv[0]!=='records'||argv[1]!=='list')process.exit(2);
 const args=JSON.parse(argv[3]);
 if(args.fault==='plain-text'){audit({event:'invoke',name:'mapped_read',args});process.stdout.write('signed in successfully\n');process.exit(0);}
 try{send(execute('mapped_read',args));}catch{process.stderr.write(String(credential)+'\n');process.exitCode=2;}
}else if(mode==='mcp'){
 audit({event:'mcp-open'});
 readline.createInterface({input:process.stdin}).on('line',line=>{
  const req=JSON.parse(line),reply=value=>send({jsonrpc:'2.0',id:req.id,result:value});
  if(req.method==='initialize')return reply({protocolVersion:req.params.protocolVersion,serverInfo:{name:'Controlled upstream',version:'1.0.0'},capabilities:{tools:{}}});
  if(req.method==='ping')return reply({});
  if(req.method==='tools/list')return reply({tools:['mapped_read','extra_secret_tool'].map(name=>({name,inputSchema:{type:'object',properties:{pageIndex:{type:'integer'},literal:{type:'string'},fault:{type:'string'}},additionalProperties:false}}))});
  if(req.method==='tools/call'){
   try{const data=execute(req.params.name,req.params.arguments);return reply({content:[{type:'text',text:JSON.stringify(data)}],structuredContent:typeof data==='object'?data:undefined,isError:false});}catch{return reply({content:[{type:'text',text:'upstream '+credential}],isError:true});}
  }
 });process.stdin.on('close',()=>process.exit(0));
}else process.exit(2);
