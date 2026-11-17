// T1.5 §10: identification is pinned T3 logic; opening is a host action bounded by the item's task roots.
import { realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, relative, resolve } from 'node:path';
import { z } from 'zod';
import { parseMarkdownFileLink } from '@shared/t3-links/markdownLinks';
import type { RootSource, SourceResolver } from '../files/roots';
import type { AgentStore } from './agent-store';
import { DriverError } from './driver';
const inside = (root: string, path: string) => { const r=relative(root,path);return !r || !isAbsolute(r)&&r!=='..'&&!r.startsWith('../'); };
const linkInput=z.object({taskId:z.string().min(1).max(128),itemId:z.string().min(1).max(128),href:z.string().min(1).max(16*1024)}).strict();
export class MessageLinks {
  constructor(private readonly store:AgentStore,private readonly roots:SourceResolver,private readonly home=homedir()) {}
  async resolve(raw:z.infer<typeof linkInput>) {
    const input=linkInput.parse(raw),task=this.store.task(input.taskId),item=this.store.itemById(input.taskId,input.itemId);
    if(!task||task.archived_at||!item)throw new DriverError('REJECTED','消息不属于当前可用任务');
    const href=input.href.trim();if(/[\x00-\x1f\x7f]/.test(href))throw new DriverError('REJECTED','链接含有无效字符');
    if(/^https?:\/\//i.test(href)) {
      const url=new URL(href);if(url.username||url.password)throw new DriverError('REJECTED','网页链接不能包含账号或密码');
      if(!task.project_id)throw new DriverError('REJECTED','请先关联项目，再在内置浏览器中打开网页');
      const project=this.store.sqlite.prepare('SELECT archived_at FROM projects WHERE id=?').get(task.project_id) as {archived_at:number|null}|undefined;
      if(!project||project.archived_at!==null)throw new DriverError('REJECTED','关联项目已不存在');
      return {kind:'web' as const,taskId:input.taskId,url:url.href};
    }
    // T3 intentionally treats bare inline names as plain text. Markdown destinations are parsed here.
    let decodedForValidation:string;try { decodedForValidation=decodeURIComponent(href); } catch { throw new DriverError('REJECTED','链接编码无效'); }
    const parsed=parseMarkdownFileLink(href);
    if (!parsed && /^[a-z][a-z\d+.-]*:/i.test(href) && !/^file:/i.test(href)) throw new DriverError('REJECTED','不支持该链接协议');
    if(!parsed||parsed.path.includes('\0')||/^[/\\]{2}/.test(parsed.path)||/:(?:0|-\d+)(?::|$)/.test(decodedForValidation)||/#L(?:0|-\d+)(?:\D|$)/i.test(decodedForValidation))throw new DriverError('REJECTED','文件路径或行列无效');
    if(parsed.line!==undefined&&!Number.isSafeInteger(parsed.line)||parsed.column!==undefined&&!Number.isSafeInteger(parsed.column))throw new DriverError('REJECTED','文件行列超出范围');
    const target=parsed.path.startsWith('~/')?resolve(this.home,parsed.path.slice(2)):resolve(task.cwd,parsed.path);
    let actual:string,directory:boolean;
    try { actual=await realpath(target);const info=await stat(actual);if(!info.isFile()&&!info.isDirectory())throw Error('不是普通文件或目录');directory=info.isDirectory(); }
    catch(e){throw new DriverError('REJECTED',`文件不存在、已删除或不可访问：${(e as Error).message}`);}
    const candidates:{source:RootSource;actual:string}[]=[];
    for(const source of this.roots.sources({kind:'task',taskId:task.id})) {
      try { const root=await realpath(source.path);if(inside(root,actual))candidates.push({source,actual:root}); }catch{/* A missing root does not expand authority. */}
    }
    const match=candidates.sort((a,b)=>b.actual.length-a.actual.length)[0];
    if(!match)throw new DriverError('REJECTED','链接越出了本任务已授权的文件根（包括符号链接越界）');
    const current=this.store.task(task.id);if(!current||current.cwd!==task.cwd||current.project_id!==task.project_id||!this.roots.sources({kind:'task',taskId:task.id}).some(r=>r.kind===match.source.kind&&r.id===match.source.id&&r.path===match.source.path))throw new DriverError('REJECTED','打开期间任务目录或授权来源已变化');
    return {kind:'file' as const,taskId:task.id,source:match.source,relativePath:relative(match.actual,actual),absolutePath:actual,directory,line:parsed.line,column:parsed.column,endLine:parsed.endLine};
  }
}
