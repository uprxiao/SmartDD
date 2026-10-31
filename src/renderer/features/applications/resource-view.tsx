import {useInfiniteQuery} from '@tanstack/react-query';
import {useId,useMemo} from 'react';
import type {ApplicationResourceChunk,ApplicationResourceRef} from '@shared/application-data';
import {AppEmpty} from './controls';
const inertText=(text:string)=>{const doc=new DOMParser().parseFromString(text,'text/html');doc.querySelectorAll('script,style,iframe,object,embed').forEach(e=>e.remove());doc.querySelectorAll('br').forEach(e=>e.replaceWith('\n'));doc.querySelectorAll('p,div,li,h1,h2,h3,section').forEach(e=>e.append('\n'));return doc.body.textContent?.trim()??'';};
export function formatZentaoResource(text:string,format:'zentao-body'|'zentao-history'){
 try{const parsed:unknown=JSON.parse(text);if(format==='zentao-body'&&parsed&&typeof parsed==='object'&&!Array.isArray(parsed))return Object.entries(parsed).map(([key,value])=>{const label=({steps:'重现步骤与说明',spec:'需求描述',description:'说明',verify:'验收标准',verifyCriteria:'验收标准'} as Record<string,string>)[key]??key;return label+'\n'+inertText(typeof value==='string'?value:JSON.stringify(value,null,2));}).join('\n\n');
  const rows=Array.isArray(parsed)?parsed:parsed&&typeof parsed==='object'?Object.values(parsed):[];
  return rows.map(row=>{if(!row||typeof row!=='object')return String(row);const value=row as Record<string,unknown>;return [value.date,value.actor,value.action].filter(Boolean).join(' · ')+(typeof value.comment==='string'&&value.comment?'\n'+inertText(value.comment):'');}).join('\n\n')||'当前没有历史记录。';
 }catch{return text;}
}
/** Source markup is inert text. No remote images, links, scripts or styles are mounted. */
export function ResourceView({resource,scope,read,format}:{format?:'zentao-body'|'zentao-history';resource:ApplicationResourceRef;scope:string;read:(offset:number,signal?:AbortSignal)=>Promise<ApplicationResourceChunk>}){
 // A new opening verifies from its first chunk; prior pages are not a new read grant.
 const opening=useId(),query=useInfiniteQuery({queryKey:['applications','resource',scope,resource.id,resource.revision,opening],initialPageParam:0,queryFn:({pageParam,signal})=>read(pageParam,signal),getNextPageParam:last=>last.nextOffset??undefined,retry:false,gcTime:0,refetchOnWindowFocus:false});
 const value=useMemo(()=>{const chunks=query.data?.pages??[],bytes=chunks.map(chunk=>chunk.encoding==='utf8'?new TextEncoder().encode(chunk.data):Uint8Array.from(atob(chunk.data),c=>c.charCodeAt(0))),joined=new Uint8Array(bytes.reduce((n,b)=>n+b.length,0));let offset=0;for(const b of bytes){joined.set(b,offset);offset+=b.length;}let text=new TextDecoder().decode(joined);if(format)text=formatZentaoResource(text,format);else if(resource.mediaType.split(';',1)[0].trim().toLowerCase()==='text/html')text=inertText(text);return text;},[query.data,resource.mediaType,format]);
 if(query.isPending||query.isRefetching)return <p role="status">正在读取原内容…</p>;
 if(query.error&&!query.isFetchNextPageError)return <AppEmpty error title="内容读取未完成" text={query.error.message} action="重试" onAction={()=>void query.refetch()}/>;
 return <div className="m10-resource-view">{query.error&&!query.isFetchingNextPage&&<AppEmpty error title="内容读取未完成" text={query.error.message} action="重试" onAction={()=>void query.refetch()}/>}<pre>{value}</pre>{query.hasNextPage&&<><p className="m10-muted">内容尚未全部显示；已读取 {query.data?.pages.reduce((n,p)=>n+p.length,0)} / {resource.size} 字节。</p><button className="m10-button secondary" disabled={query.isFetchingNextPage} onClick={()=>void query.fetchNextPage()}>继续读取内容</button></>}</div>;
}
