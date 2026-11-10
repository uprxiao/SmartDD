// 补验 C1（审核三 G01）：生成器 v3＋包装器 v3 的真实组合运行（父进程放入全部槽，模拟 Claude 目标共用槽环境）。
// 旧红：B 目录 v2 生成器＋v2 包装器复现审核反例；新绿：v3。并回归 B2 四例与 B3 矩阵要点。全部诱饵值。
import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';import {dirname,join} from 'node:path';
const here=dirname(fileURLToPath(import.meta.url));const B=join(here,'../B_审核二修正_20261110');
const v2=await import(join(B,'b3-emit-v2.mjs'));const v3=await import(join(here,'c1-emit-v3.mjs'));v3.setWrap(join(here,'wy-mcp-launch.sh'));
const lit=s=>({lit:s}),ref=n=>({tpl:[{ref:n}]});
const PRINT=lit('const e=process.env;process.stdout.write(JSON.stringify({argv:process.argv.slice(1),API_KEY:e.API_KEY??null,ANTHROPIC_API_KEY:e.ANTHROPIC_API_KEY??null,slots:Object.keys(e).filter(k=>k.startsWith("WY_MCPV_")||k.startsWith("__wy_"))}))');
const runServer=(emitted,name,wrapPath,extraEnv={})=>{const s=emitted.claude.mcpServers[name];const args=[wrapPath,...s.args.slice(1)];
 const p=spawnSync('/bin/sh',args,{env:{PATH:process.env.PATH,...emitted.add,...extraEnv},encoding:'utf8'});let got=null;try{got=JSON.parse(p.stdout)}catch{};return {exit:p.status,got,stderr:p.stderr.trim()};};
const out={};
// G01 审核反例（node 的 -e 后加 "--"，避免 node 自己解析形如选项的数据参数；attempt1 因此误判）：alpha 自有 Key；beta 只有字面参数 @WYARG:<alpha 槽名>
const mk=(marker)=>[{name:'alpha',transport:'stdio',command:'node',args:[lit('-e'),PRINT],env:{API_KEY:lit('decoy-alpha-key')}},{name:'beta',transport:'stdio',command:'node',args:[lit('-e'),PRINT,lit('--'),lit(marker)],env:{}}];
{const e=v2.emit(mk('@WYARG:WY_MCPV_1'),'claude',{launchEnv:{},strip:[]});const r=runServer(e,'beta',join(B,'wy-mcp-launch.sh'));out.G01_red_v2={...r,leaked:JSON.stringify(r.got?.argv||[]).includes('decoy-alpha-key')};}
for(const [lbl,marker] of [['G01_v3_alpha_slot_name','@WYARG:WY_MCPV_1_1'],['G01_v3_old_style_name','@WYARG:WY_MCPV_1'],['G01_v3_unknown_marker','@WYARG:NOPE'],['G01_v3_option_like','--arg']]){
 const e=v3.emit(mk(marker),'claude',{launchEnv:{},strip:[]});const b=runServer(e,'beta',join(here,'wy-mcp-launch.sh'));const a=runServer(e,'alpha',join(here,'wy-mcp-launch.sh'));
 out[lbl]={beta:b,alpha:a,pass:b.exit===0&&JSON.stringify(b.got.argv)===JSON.stringify([marker])&&b.got.API_KEY===null&&b.got.slots.length===0&&a.got.API_KEY==='decoy-alpha-key'&&a.got.slots.length===0};}
// 两个 MCP 不同 Key、模板参数：各自只拿自己的值
{const sv=[{name:'m1',transport:'stdio',command:'node',args:[lit('-e'),PRINT,ref('K1'),lit('tail')],env:{API_KEY:ref('K1')}},{name:'m2',transport:'stdio',command:'node',args:[lit('-e'),PRINT,ref('K2')],env:{API_KEY:ref('K2')}}];
 const e=v3.emit(sv,'claude',{launchEnv:{K1:'decoy-k1',K2:'decoy-k2'},strip:['ANTHROPIC_API_KEY']});const r1=runServer(e,'m1',join(here,'wy-mcp-launch.sh'),{ANTHROPIC_API_KEY:'decoy-model'}),r2=runServer(e,'m2',join(here,'wy-mcp-launch.sh'),{ANTHROPIC_API_KEY:'decoy-model'});
 out.T2_two_mcp_template_args={m1:r1,m2:r2,pass:JSON.stringify(r1.got.argv)==='["decoy-k1","tail"]'&&r1.got.API_KEY==='decoy-k1'&&JSON.stringify(r2.got.argv)==='["decoy-k2"]'&&r2.got.API_KEY==='decoy-k2'&&r1.got.ANTHROPIC_API_KEY===null&&r2.got.ANTHROPIC_API_KEY===null};}
// 含 $ 的字面参数（Claude 会展开 ${}，须走槽）原样到达
{const sv=[{name:'d',transport:'stdio',command:'node',args:[lit('-e'),PRINT,lit('cost ${HOME} $5')],env:{}}];const e=v3.emit(sv,'claude',{launchEnv:{},strip:[]});const r=runServer(e,'d',join(here,'wy-mcp-launch.sh'));
 out.T3_dollar_literal={...r,usesSlot:Object.keys(e.add).length===1,pass:r.exit===0&&JSON.stringify(r.got.argv)==='["cost ${HOME} $5"]'};}
// B2 回归：同名自有 Key 保留、模型 Key 清除、缺来源 65、非私有槽来源拒绝 64、越界索引拒绝 64
const W=join(here,'wy-mcp-launch.sh');const sh=(args,env)=>{const p=spawnSync('/bin/sh',[W,...args],{env:{PATH:process.env.PATH,...env},encoding:'utf8'});let g=null;try{g=JSON.parse(p.stdout)}catch{};return {exit:p.status,got:g,stderr:p.stderr.trim()};};
{const r=sh(['--set','ANTHROPIC_API_KEY=WY_MCPV_1_1','--unset','ANTHROPIC_API_KEY','--unset-prefix','WY_MCPV_','--','node','-e',PRINT.lit],{WY_MCPV_1_1:'decoy-mcp',ANTHROPIC_API_KEY:'decoy-model'});out.R1_same_name={...r,pass:r.got?.ANTHROPIC_API_KEY==='decoy-mcp'&&r.got.slots.length===0};}
{const r=sh(['--set','API_KEY=WY_MCPV_9_9','--','node','-e',PRINT.lit],{});out.R2_missing_source={...r,pass:r.exit===65};}
{const r=sh(['--set','API_KEY=ANTHROPIC_AUTH_TOKEN','--','node','-e',PRINT.lit],{ANTHROPIC_AUTH_TOKEN:'decoy'});out.R3_non_slot_source={...r,pass:r.exit===64};}
{const r=sh(['--arg','5=WY_MCPV_1_1','--','node','-e',PRINT.lit],{WY_MCPV_1_1:'x'});out.R4_index_out_of_range={...r,pass:r.exit===64};}
// B3 矩阵要点回归：缺变量整台不生成、带凭据 URL 拒绝
{const sv=[{name:'ok',transport:'stdio',command:'node',args:[lit('a')],env:{}},{name:'miss',transport:'stdio',command:'node',args:[ref('NOT_SET')],env:{}},{name:'u',transport:'http',url:'https://x.test/mcp?api_key=1',headers:{}}];
 const e=v3.emit(sv,'claude',{launchEnv:{},strip:[]});out.R5_b3_regression={present:Object.keys(e.claude.mcpServers),skipped:e.skipped,slots:Object.keys(e.add),pass:JSON.stringify(Object.keys(e.claude.mcpServers))==='["ok"]'&&JSON.stringify(e.skipped)==='["miss","u"]'&&Object.keys(e.add).length===0};}
// Codex 目标生成形态检查（env_vars 列出本服务器槽、--arg 在 -- 之前）
{const sv=[{name:'c',transport:'stdio',command:'node',args:[lit('@WYARG:X'),ref('K1')],env:{API_KEY:ref('K1')}}];const e=v3.emit(sv,'codex',{launchEnv:{K1:'decoy'},strip:[]});out.R6_codex_shape={codex:e.codex,pass:/"--arg","1=WY_MCPV_1_2"/.test(e.codex[1])&&/"@WYARG:X",""\]/.test(e.codex[1])&&/env_vars=\["WY_MCPV_1_1","WY_MCPV_1_2"\]/.test(e.codex[1])};}
const pass=Object.fromEntries(Object.entries(out).filter(([k])=>k!=='G01_red_v2').map(([k,v])=>[k,v.pass]));
console.log(JSON.stringify({out,redReproduced:out.G01_red_v2.leaked,pass,allPass:Object.values(pass).every(Boolean)},null,1));
