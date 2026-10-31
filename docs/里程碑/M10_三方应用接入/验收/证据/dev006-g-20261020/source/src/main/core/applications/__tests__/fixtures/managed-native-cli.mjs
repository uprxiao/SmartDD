// Private OS integration fixture. Parses real host argv and drives the immutable
// MCP child; it never loads CC/Codex, a model, external mail or user credentials.
import {existsSync,writeFileSync,appendFileSync} from 'node:fs';
import {parse} from 'smol-toml';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
if(process.argv.includes('--version')){process.stdout.write('0.162.1\n');process.exit(0);}
const servers={};
for(let i=2;i<process.argv.length;i++)if(process.argv[i]==='-c'){
 const config=parse(process.argv[++i]);
 for(const[name,value]of Object.entries(config.mcp_servers??{}))servers[name]={...servers[name],...value};
}
const server=Object.values(servers).find(value=>value.args?.includes('--bootstrap'));
if(!server)throw new Error('private bridge config missing');
const client=new Client({name:'private-native-cli-fixture',version:'1.0.0'}),transport=new StdioClientTransport({...server,env:{...process.env,...server.env},stderr:'pipe'});
// Optional raw byte observer for controlled-paste integration; never an actual model.
if(process.env.WY_M10_TEST_INPUT_REPORT){writeFileSync(process.env.WY_M10_TEST_INPUT_REPORT,'',{flag:'wx',mode:0o600});process.stdin.setRawMode(true);process.stdin.on('data',data=>appendFileSync(process.env.WY_M10_TEST_INPUT_REPORT,data));process.stdin.resume();}
let closing;
const close=()=>closing??=(async()=>{clearInterval(timer);if(process.env.WY_M10_TEST_INPUT_REPORT)process.stdin.pause();await client.close();process.exitCode=0;})();
const timer=setInterval(()=>{if(existsSync(process.env.WY_M10_TEST_STOP))void close();},20);
process.once('SIGTERM',()=>void close());
try{
 await client.connect(transport);const list=await client.listTools(),tool=list.tools.find(t=>t.name.includes('draft')&&t.name.includes('list'));
 if(!tool)throw new Error('private draft list contract missing');
 const result=await client.callTool({name:tool.name,arguments:{}});
 writeFileSync(process.env.WY_M10_TEST_REPORT,JSON.stringify({cliPid:process.pid,bridgePid:transport.pid,tool:tool.name,result})+'\n',{flag:'wx',mode:0o600});
}catch(error){clearInterval(timer);await client.close().catch(()=>{});process.stderr.write('private managed CLI integration failed\n');process.exitCode=1;}
