// minimal MCP stdio server: logs calls with env/cwd to argv[2]
import {appendFileSync} from 'node:fs';import readline from 'node:readline';
const LOG=process.argv[2];const rl=readline.createInterface({input:process.stdin});
const send=o=>process.stdout.write(JSON.stringify(o)+'\n');
rl.on('line',l=>{let m;try{m=JSON.parse(l)}catch{return}
 if(m.method==='initialize')send({jsonrpc:'2.0',id:m.id,result:{protocolVersion:m.params?.protocolVersion||'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'wy-fake-stdio',version:'1'}}});
 else if(m.method==='tools/list')send({jsonrpc:'2.0',id:m.id,result:{tools:[{name:'wy_echo',description:'Return WY_ENV_PROBE value',inputSchema:{type:'object',properties:{},additionalProperties:false}}]}});
 else if(m.method==='tools/call'){const rec={kind:'stdio',tool:m.params?.name,cwd:process.cwd(),WY_STATIC:process.env.WY_STATIC??null,WY_PASS:process.env.WY_PASS??null,hasAnthropicToken:!!process.env.ANTHROPIC_AUTH_TOKEN,hasModelKeyEnv:!!process.env.WY_MOCK_KEY,hasHttpTokenEnv:!!process.env.WY_HTTP_TOKEN,t:Date.now()};appendFileSync(LOG,JSON.stringify(rec)+'\n');
   send({jsonrpc:'2.0',id:m.id,result:{content:[{type:'text',text:'ECHO '+JSON.stringify(rec)}]}});}
 else if(m.id!==undefined)send({jsonrpc:'2.0',id:m.id,result:{}});});
