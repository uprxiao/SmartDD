import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { ApplicationError } from '@shared/applications';
export interface HttpReadOptions {method?:'GET'|'POST';token?:string;body?:unknown;signal:AbortSignal;timeoutMs?:number;maxBytes?:number;accept?:string}
export interface HttpBytes {bytes:Buffer;mediaType:string}
/** One bounded attempt; only the owning execution service may retry. Redirects are never followed. */
export function requestBytes(url:URL,options:HttpReadOptions):Promise<HttpBytes>{
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new ApplicationError('INVALID_INPUT','服务地址无效');
  if(options.token&&/[\r\n\x00]/.test(options.token))throw new ApplicationError('AUTH_REQUIRED','Token格式无效');
  if(options.signal.aborted)return Promise.reject(options.signal.reason instanceof ApplicationError?options.signal.reason:new ApplicationError('CANCELED','请求已取消'));
  return new Promise((resolve,reject)=>{
    const body=options.body===undefined?undefined:Buffer.from(JSON.stringify(options.body));
    const headers:Record<string,string|number>={Accept:options.accept??'*/*','User-Agent':'WillYou/Applications'};
    if(options.token)headers.Token=options.token;if(body){headers['Content-Type']='application/json; charset=utf-8';headers['Content-Length']=body.length;}
    const max=options.maxBytes??8*1024*1024;let settled=false;
    const fail=(error:ApplicationError)=>{if(!settled){settled=true;reject(error);}};
    const request=(url.protocol==='https:'?httpsRequest:httpRequest)(url,{method:options.method??'GET',headers,agent:false},response=>{
      const status=response.statusCode??0;
      if(status<200||status>=300){response.destroy();fail(new ApplicationError(status===401?'AUTH_FAILED':status===403?'SCOPE_DENIED':status===404?'NOT_FOUND':status===429||status>=500?'TRANSIENT_FAILURE':'CONNECTION_UNAVAILABLE',status===401?'服务拒绝当前认证':status===403?'当前账号无权读取该对象':status===404?'来源对象已不存在':'服务暂时不可用或返回非成功状态'));return;}
      const declared=response.headers['content-length'];
      if(declared!==undefined&&(!/^\d+$/.test(declared)||!Number.isSafeInteger(Number(declared)))){fail(new ApplicationError('INVALID_RESPONSE','服务内容长度无效'));response.destroy();return;}
      if(declared!==undefined&&Number(declared)>max){fail(new ApplicationError('INCOMPLETE_RESULT','服务响应超过本次资源预算'));response.destroy();return;}
      const chunks:Buffer[]=[];let received=0;
      response.on('data',(chunk:Buffer)=>{if(settled)return;received+=chunk.length;if(received>max){fail(new ApplicationError('INCOMPLETE_RESULT','服务响应超过本次资源预算'));response.destroy();return;}chunks.push(chunk);});
      response.on('end',()=>{
        if(settled)return;if(declared!==undefined&&received!==Number(declared)){fail(new ApplicationError('INCOMPLETE_RESULT','服务内容未完整接收'));return;}
        const raw=response.headers['content-type']?.split(';')[0].trim().toLowerCase();const mediaType=raw&&/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(raw)&&raw.length<=200?raw:'application/octet-stream';settled=true;resolve({bytes:Buffer.concat(chunks),mediaType});
      });
      response.on('error',()=>fail(new ApplicationError('TRANSIENT_FAILURE','服务响应中断')));response.on('aborted',()=>fail(new ApplicationError('TRANSIENT_FAILURE','服务响应未完整接收')));
    });
    const abort=()=>request.destroy(options.signal.reason instanceof ApplicationError?options.signal.reason:new ApplicationError('CANCELED','请求已取消'));
    const timer=setTimeout(()=>request.destroy(new ApplicationError('TIMEOUT','服务请求超时')),options.timeoutMs??8000);options.signal.addEventListener('abort',abort,{once:true});
    request.on('error',error=>fail(error instanceof ApplicationError?error:new ApplicationError('TRANSIENT_FAILURE','无法完成服务请求')));
    request.on('close',()=>{clearTimeout(timer);options.signal.removeEventListener('abort',abort);});
    if(options.signal.aborted)abort();if(body)request.write(body);request.end();
  });
}
export async function requestJson(url:URL,options:HttpReadOptions):Promise<unknown>{
  const response=await requestBytes(url,{...options,accept:'application/json'});
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(response.bytes),(_key,item:unknown)=>{if(typeof item==='number'&&(!Number.isFinite(item)||(Number.isInteger(item)&&!Number.isSafeInteger(item))))throw new Error();return item;});}
  catch{throw new ApplicationError('INVALID_RESPONSE','服务返回的JSON无效或包含无法保真的数字');}
}
