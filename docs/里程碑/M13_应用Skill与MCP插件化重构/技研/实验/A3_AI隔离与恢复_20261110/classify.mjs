// 旧 AI 配置迁移分类（只用变量名）：可拆分 → 工具＋Provider＋运行配置；否则保留为高级配置
import {readFileSync} from 'node:fs';
const P=JSON.parse(readFileSync(process.argv[2],'utf8'));
const PROVIDER={url:['ANTHROPIC_BASE_URL'],auth:['ANTHROPIC_AUTH_TOKEN','ANTHROPIC_API_KEY']};
const RUNCFG=new Set(['ANTHROPIC_MODEL','ANTHROPIC_DEFAULT_OPUS_MODEL','ANTHROPIC_DEFAULT_SONNET_MODEL','ANTHROPIC_DEFAULT_HAIKU_MODEL','ANTHROPIC_DEFAULT_FABLE_MODEL','ANTHROPIC_SMALL_FAST_MODEL','CLAUDE_CODE_SUBAGENT_MODEL','CLAUDE_CODE_EFFORT_LEVEL']);
const ADVANCED_KNOWN=new Set(['API_TIMEOUT_MS','CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC','CLAUDE_CODE_AUTO_COMPACT_WINDOW','CLAUDE_CODE_MAX_OUTPUT_TOKENS']);
for(const p of P){const env=JSON.parse(p.envNames||'[]');let r;
 if(p.runner==='codex'){const KNOWN=new Set(['--sandbox','-s','--model','-m','--ask-for-approval','-a','--no-alt-screen']);const unknownFlags=(p.argFlags||[]).filter(f=>!KNOWN.has(f));r=env.length||unknownFlags.length?{kind:'advanced',why:{env:env.length,unknownFlags}}:{kind:'split',tool:'codex',provider:'Codex 原有登录',runConfig:{model:'CLI 默认'},advancedArgsKept:p.argFlags};}
 else{const url=env.find(e=>PROVIDER.url.includes(e)),auth=env.filter(e=>PROVIDER.auth.includes(e));const unknown=env.filter(e=>!PROVIDER.url.includes(e)&&!PROVIDER.auth.includes(e)&&!RUNCFG.has(e)&&!ADVANCED_KNOWN.has(e));
  if(!env.length&&!p.nArgs)r={kind:'split',tool:'claude',provider:'Claude 原有登录'};
  else if(url&&auth.length===1&&!unknown.length&&!p.nArgs)r={kind:'split',tool:'claude',provider:{protocol:'anthropic',url,auth:auth[0]},runConfig:env.filter(e=>RUNCFG.has(e)),advanced:env.filter(e=>ADVANCED_KNOWN.has(e))};
  else r={kind:'advanced',why:{url:!!url,authCount:auth.length,unknown,nArgs:p.nArgs}};}
 console.log(JSON.stringify({name:p.name,runner:p.runner,...r}));}
