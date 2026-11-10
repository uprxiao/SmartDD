// 补验 B2（审核二 F03）：v1（A1 原脚本）红测与 v2 绿测对照。全部诱饵值。
import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';import {dirname,join} from 'node:path';
const here=dirname(fileURLToPath(import.meta.url));
const V={v1:join(here,'../A1_MCP语义与策略_20261110/wy-mcp-launch.sh'),v2:join(here,'wy-mcp-launch.sh')};
const show="const e=process.env;console.log(JSON.stringify({ANTHROPIC_API_KEY:e.ANTHROPIC_API_KEY??null,API_KEY:e.API_KEY??null,ANTHROPIC_AUTH_TOKEN:e.ANTHROPIC_AUTH_TOKEN??null,WILLYOU_RUN_TOKEN:e.WILLYOU_RUN_TOKEN??null,slots:Object.keys(e).filter(k=>k.startsWith('WY_MCPV_')||k.startsWith('__wy_')),argv:process.argv.slice(1)}))";
const cases={
 W1_same_name_collision:{env:{WY_MCPV_1:'decoy-mcp-key',ANTHROPIC_API_KEY:'decoy-model-key'},args:['--set','ANTHROPIC_API_KEY=WY_MCPV_1','--unset','ANTHROPIC_API_KEY','--unset-prefix','WY_MCPV_'],expect:{ANTHROPIC_API_KEY:'decoy-mcp-key'}},
 W2_distinct_name:{env:{WY_MCPV_1:'decoy-mcp-key',ANTHROPIC_API_KEY:'decoy-model-key',ANTHROPIC_AUTH_TOKEN:'decoy-tok',WILLYOU_RUN_TOKEN:'run'},args:['--set','API_KEY=WY_MCPV_1','--unset','ANTHROPIC_API_KEY','--unset','ANTHROPIC_AUTH_TOKEN','--unset','WILLYOU_RUN_TOKEN','--unset-prefix','WY_MCPV_'],expect:{API_KEY:'decoy-mcp-key',ANTHROPIC_API_KEY:null,ANTHROPIC_AUTH_TOKEN:null,WILLYOU_RUN_TOKEN:null}},
 W3_arg_slot:{env:{WY_MCPV_1:'k',WY_MCPV_2:'arg with space $HOME'},args:['--set','API_KEY=WY_MCPV_1','--unset-prefix','WY_MCPV_'],tail:['@WYARG:WY_MCPV_2','plain'],expect:{API_KEY:'k',argv:['arg with space $HOME','plain']}},
 W4_missing_source:{env:{},args:['--set','API_KEY=WY_MCPV_9','--unset-prefix','WY_MCPV_'],expectExit:65},
};
const out={};
for(const [ver,sh] of Object.entries(V))for(const [k,c] of Object.entries(cases)){
 const r=spawnSync('/bin/sh',[sh,...c.args,'--','node','-e',show,...(c.tail||[])],{env:{PATH:process.env.PATH,...c.env},encoding:'utf8'});
 let got=null;try{got=JSON.parse(r.stdout)}catch{}
 let pass;if(c.expectExit!==undefined)pass=r.status===c.expectExit;else pass=r.status===0&&got&&got.slots.length===0&&Object.entries(c.expect).every(([kk,v])=>JSON.stringify(got[kk])===JSON.stringify(v));
 out[ver+'/'+k]={exit:r.status,got,stderr:r.stderr.trim(),pass};}
console.log(JSON.stringify(out,null,1));
