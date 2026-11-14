import {createInterface} from 'node:readline';
import {appendFileSync} from 'node:fs';
const [url,token,log]=process.argv.slice(2);
const audit=e=>appendFileSync(log,JSON.stringify({pid:process.pid,...e})+'\n');
audit({event:'mcp-start'});process.on('exit',code=>audit({event:'mcp-exit',code}));process.stdin.on('end',()=>process.exit(0));
const send=x=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',...x})+'\n');
createInterface({input:process.stdin}).on('line',async s=>{let x;try{x=JSON.parse(s);}catch{return;}
 if(x.method==='initialize')send({id:x.id,result:{protocolVersion:x.params?.protocolVersion??'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'willyou-delegation-probe',version:'1'}}});
 else if(x.method==='tools/list')send({id:x.id,result:{tools:[{name:'wy_delegate',description:'Delegate an isolated task to the explicit target and return its result.',inputSchema:{type:'object',properties:{target:{type:'string'},clientRequestId:{type:'string'}},required:['target','clientRequestId'],additionalProperties:false}}]}});
 else if(x.method==='tools/call'){try{const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},body:JSON.stringify(x.params)});const data=await r.json();audit({event:'mcp-tool-result',status:r.status});send({id:x.id,result:{content:[{type:'text',text:JSON.stringify(data)}],...(r.ok?{}:{isError:true})}});}catch(e){send({id:x.id,error:{code:-32603,message:String(e)}});}}
 else if(x.id!==undefined)send({id:x.id,result:{}});
});
