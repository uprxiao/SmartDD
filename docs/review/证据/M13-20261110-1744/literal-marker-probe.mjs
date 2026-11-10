import {emit} from "file:///Users/liubu/hx/4.uprxiao/SmartDD/docs/%E9%87%8C%E7%A8%8B%E7%A2%91/M13_%E5%BA%94%E7%94%A8Skill%E4%B8%8EMCP%E6%8F%92%E4%BB%B6%E5%8C%96%E9%87%8D%E6%9E%84/%E6%8A%80%E7%A0%94/%E5%AE%9E%E9%AA%8C/B_%E5%AE%A1%E6%A0%B8%E4%BA%8C%E4%BF%AE%E6%AD%A3_20261110/b3-emit-v2.mjs";
import {spawnSync} from 'node:child_process';
const lit=s=>({lit:s});
const servers=[{name:'alpha',transport:'stdio',command:'node',args:[],env:{API_KEY:lit('decoy-alpha-key')}},{name:'beta',transport:'stdio',command:'node',args:[lit('-e'),lit('process.stdout.write(JSON.stringify(process.argv.slice(1)))'),lit('@WYARG:WY_MCPV_1')],env:{}}];
const e=emit(servers,'claude',{launchEnv:{},strip:[]});
const beta=e.claude.mcpServers.beta;
const args=["/Users/liubu/hx/4.uprxiao/SmartDD/docs/\u91cc\u7a0b\u7891/M13_\u5e94\u7528Skill\u4e0eMCP\u63d2\u4ef6\u5316\u91cd\u6784/\u6280\u7814/\u5b9e\u9a8c/B_\u5ba1\u6838\u4e8c\u4fee\u6b63_20261110/wy-mcp-launch.sh",...beta.args.slice(1)];
const p=spawnSync('/bin/sh',args,{env:{PATH:'/Users/liubu/.local/bin:/usr/bin:/bin',...e.add},encoding:'utf8'});
console.log(JSON.stringify({literalSourceArg:'@WYARG:WY_MCPV_1',allocatedSlots:e.add,betaLaunchArgs:args,exit:p.status,actualArgv:p.stdout,stderr:p.stderr},null,2));
