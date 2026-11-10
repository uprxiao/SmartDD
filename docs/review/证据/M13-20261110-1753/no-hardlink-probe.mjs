import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';import {join} from 'node:path';
const dir=fs.mkdtempSync('/private/tmp/m13-swap-audit-');const target=join(dir,'config.toml');
const before={model:'user-default'},expect={model:'session-model'},raw={model:'model = "user-default"'};
const current='model = "session-model"\n';const external='model = "external-choice"\nexternal_writer_mark = true\n';
fs.writeFileSync(target,current,{mode:0o600});
fs.linkSync=()=>{const e=new Error('simulated filesystem without hard-link support');e.code='ENOTSUP';throw e;};syncBuiltinESMExports();
const {restoreFileSwap}=await import("file:///Users/liubu/hx/4.uprxiao/SmartDD/docs/%E9%87%8C%E7%A8%8B%E7%A2%91/M13_%E5%BA%94%E7%94%A8Skill%E4%B8%8EMCP%E6%8F%92%E4%BB%B6%E5%8C%96%E9%87%8D%E6%9E%84/%E6%8A%80%E7%A0%94/%E5%AE%9E%E9%AA%8C/C_%E5%AE%A1%E6%A0%B8%E4%B8%89%E4%BF%AE%E6%AD%A3_20261110/c2-restore-swap.mjs");let result;try{result=restoreFileSwap(target,before,expect,{raw});}catch(e){result={threw:e.code,message:e.message};}
console.log(JSON.stringify({method:'本测试进程中模拟 link 不支持；只操作临时文件',result,targetExists:fs.existsSync(target),files:fs.readdirSync(dir).map(n=>({name:n,text:fs.readFileSync(join(dir,n),'utf8')}))},null,2));
