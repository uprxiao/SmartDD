import policy from '@root/docs/里程碑/M12_浏览器自动化/技研/命令映射/exec-allowlist.json';
import { ApplicationError } from '@shared/applications';

/** Tokenize quoting/escaping only. There is no shell, expansion, pipe or command substitution. */
export function browserExecArguments(source:string):string[]{
  const args:string[]=[];let token='',quote='',escaped=false,started=false;
  for(const character of source){
    if(escaped){token+=character;escaped=false;started=true;continue;}
    if(character==='\\'&&quote!=="'"){escaped=true;started=true;continue;}
    if(quote){if(character===quote)quote='';else token+=character;started=true;continue;}
    if(character==='"'||character==="'"){quote=character;started=true;continue;}
    if(/\s/.test(character)){if(started){args.push(token);token='';started=false;}continue;}
    token+=character;started=true;
  }
  if(quote||escaped)throw new ApplicationError('INVALID_INPUT','exec引号或转义不完整');
  if(started)args.push(token);
  const commands=policy.commands as Record<string,string[]|Record<string,string[]>>;
  let rule=commands[args[0]],offset=1;
  if(rule&&!Array.isArray(rule)){rule=rule[args[1]];offset=2;}
  if(!Array.isArray(rule)||!args.length)throw new ApplicationError('INVALID_INPUT','exec子命令不在固定白名单中');
  for(const arg of args.slice(offset))if(arg.startsWith('-')&&!rule.includes(arg.split('=')[0]))throw new ApplicationError('INVALID_INPUT','exec包含未允许的参数');
  return args;
}
