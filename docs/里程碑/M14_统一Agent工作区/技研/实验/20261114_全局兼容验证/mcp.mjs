import {appendFileSync} from 'node:fs';
import {createInterface} from 'node:readline';
const send=x=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',...x})+'\n');
createInterface({input:process.stdin}).on('line',s=>{let x;try{x=JSON.parse(s);}catch{return;}
 if(x.method==='initialize')send({id:x.id,result:{protocolVersion:x.params?.protocolVersion??'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'m14-probe',version:'1'}}});
 else if(x.method==='tools/list')send({id:x.id,result:{tools:[{name:'wy_echo',description:'Return synthetic marker',inputSchema:{type:'object',properties:{},additionalProperties:false}}]}});
 else if(x.method==='tools/call'){const value={tool:x.params.name,cwd:process.cwd(),marker:process.env.WY_STATIC,hasModelKey:!!process.env.WY_MOCK_KEY,hasAnthropicKey:!!process.env.ANTHROPIC_AUTH_TOKEN};appendFileSync(process.argv[2],JSON.stringify(value)+'\n');send({id:x.id,result:{content:[{type:'text',text:JSON.stringify(value)}]}});}
 else if(x.id!==undefined)send({id:x.id,result:{}});
});
