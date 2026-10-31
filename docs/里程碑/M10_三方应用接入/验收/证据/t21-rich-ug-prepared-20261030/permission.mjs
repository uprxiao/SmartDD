import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
export const DIR='/private/tmp/willyou-m10-ug-20261030';
export const SCOPE='UG_T21_PROTECTED_NATIVE_TASKS_20261030';
export const REPLY='允许本次隔离新会话验证';
export const QUESTION='是否允许仅为本次T21非空数据与新会话验证，在继续使用App-only系统HOME的隔离实例内，最多创建2个Codex测试任务？Agent HOME／ZDOTDIR／CODEX_HOME全部为本次新目录，模型地址固定为127.0.0.1合成服务；只使用自建配置、创建本地草稿并验证导入保留，不连接配置中的DB／SSH、不运行数据库调研工具、不发送SMTP或对外消息、不导入日常配置。此前钥匙串对照明确禁止创建Agent任务，本次扩展这一点，保留禁止发送等边界。';
export const digest=b=>createHash('sha256').update(b).digest('hex');
export function checkApproval(a,pinsHash){
 if(!a||a.approved!==true||a.source!=='explicit-user-reply'||a.scope!==SCOPE||a.replyText!==REPLY||a.questionText!==QUESTION||a.pinsSha256!==pinsHash||a.maxTaskCreates!==2||typeof a.questionReference!=='string'||!/^\["request_user_input_async","call_[^\"]+",0\]$/.test(a.questionReference))throw Error('UG explicit reviewed two-task permission missing or mismatched');
 return{scope:SCOPE,maxTaskCreates:2,questionReference:a.questionReference,pinsSha256:pinsHash};
}
export function assertPrivateProfile(profile,cfg){
 if(profile.runner!=='codex'||profile.executable!==cfg.cli||JSON.stringify(profile.args)!==JSON.stringify(cfg.args))throw Error('UG fixed native CLI/read-only arguments required');
 const entries=profile.env??[],env=Object.fromEntries(entries.map(x=>[x.name,x.value]));
 if(entries.some(x=>x.secret)||Object.keys(env).sort().join('\n')!==Object.keys(cfg.env).sort().join('\n')||Object.entries(cfg.env).some(([k,v])=>env[k]!==v))throw Error('UG exact private Agent envelope required');
 return true;
}
export function readReviewedInputs(){
 const bytes=readFileSync(DIR+'/expected-pins.json'),pins=JSON.parse(bytes);
 if(pins.scope!==SCOPE||pins.maxTaskCreates!==2)throw Error('UG reviewed scope mismatch');
 for(const[path,hash]of Object.entries(pins.inputs))if(digest(readFileSync(path))!==hash)throw Error('UG reviewed input changed: '+path);
 return{pins,hash:digest(bytes)};
}
export function requirePermission(hash){
 if(!existsSync(DIR+'/approval.json'))throw Error('UG new scope not yet approved');
 return checkApproval(JSON.parse(readFileSync(DIR+'/approval.json','utf8')),hash);
}
