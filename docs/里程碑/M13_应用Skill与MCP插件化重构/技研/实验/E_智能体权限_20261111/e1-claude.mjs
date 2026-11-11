// 补验 E · E1：Claude Code 2.1.322 各权限模式在非交互下的放行范围（经 SMG，用户已授权）。
// --permission-prompts none：凡是会弹出询问的操作一律自动拒绝，于是“被拒绝”即“交互时会询问”。
// 每个模式一个新项目目录与新的配置目录；Key 只经环境变量 SMG_KEY 传入，不写入任何文件。
import {spawnSync} from 'node:child_process';import {mkdirSync,existsSync,writeFileSync} from 'node:fs';import {join} from 'node:path';import os from 'node:os';
const KEY=process.env.SMG_KEY, BASE=process.env.SMG_URL; if(!KEY||!BASE) throw new Error('缺 SMG_KEY/SMG_URL');
const root=process.argv[2]; const MODEL='deepseek-v4-pro-0813';
const modes=(process.env.MODES||'default,acceptEdits,auto,plan,dontAsk,bypassPermissions').split(',');
const out={cli:spawnSync('claude',['--version'],{encoding:'utf8'}).stdout.trim(),model:MODEL,runs:{}};
for(const mode of modes){
  const proj=join(root,'proj-'+mode), outside=join(root,'outside-'+mode), cfg=join(root,'cfg-'+mode);
  for(const d of [proj,outside,cfg]) mkdirSync(d,{recursive:true});
  const tiers=Object.fromEntries(['ANTHROPIC_MODEL','ANTHROPIC_DEFAULT_OPUS_MODEL','ANTHROPIC_DEFAULT_SONNET_MODEL','ANTHROPIC_DEFAULT_HAIKU_MODEL','ANTHROPIC_DEFAULT_FABLE_MODEL','CLAUDE_CODE_SUBAGENT_MODEL'].map(k=>[k,MODEL]));
  const env={PATH:process.env.PATH,HOME:os.homedir(),TMPDIR:process.env.TMPDIR||'/tmp',CLAUDE_CONFIG_DIR:cfg,ANTHROPIC_BASE_URL:BASE,ANTHROPIC_AUTH_TOKEN:KEY,CLAUDE_CODE_DISABLE_1M_CONTEXT:'1',DISABLE_AUTOUPDATER:'1',...tiers};
  const prompt=`Do these three steps in order, each with a tool call, and continue even if one is denied:
1. Use the Write tool to create the file ${join(proj,'in-cwd.txt')} with content "a".
2. Use the Bash tool to run: echo b > ${join(proj,'bash.txt')}
3. Use the Write tool to create the file ${join(outside,'outside.txt')} with content "c".
Finally reply with one line per step: allowed or denied.`;
  const args=['-p','--setting-sources','user','--strict-mcp-config','--permission-mode',mode,'--permission-prompts','none','--output-format','json','--max-turns','8',prompt];
  const t=Date.now(); const r=spawnSync('claude',args,{cwd:proj,env,encoding:'utf8',timeout:240000});
  let j=null; try{ j=JSON.parse(r.stdout); }catch{}
  out.runs[mode]={exit:r.status,ms:Date.now()-t,files:{inCwd:existsSync(join(proj,'in-cwd.txt')),bash:existsSync(join(proj,'bash.txt')),outside:existsSync(join(outside,'outside.txt'))},
    denials:(j?.permission_denials||[]).map(d=>({tool:d.tool_name,input:d.tool_input?.file_path||d.tool_input?.command})),result:(j?.result||'').slice(0,400),isError:j?.is_error??null,
    stderr:(r.stderr||'').split('\n').filter(Boolean).slice(-4).join(' / ').slice(0,400),stdoutHead:j?undefined:(r.stdout||'').slice(0,300)};
  console.error(mode, JSON.stringify(out.runs[mode].files), out.runs[mode].exit);
}
writeFileSync(join(root,'e1-result.json'),JSON.stringify(out,null,1));
