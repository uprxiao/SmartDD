import type {Session} from 'electron';
/** Fetch with the page's profile and expose only an image data URL to the App.
 * No remote image request or profile credential is delegated to the renderer. */
export async function browserFavicon(session:Session,url:string,signal:AbortSignal):Promise<string|null>{
  const maximum=256*1024,types=new Set(['image/png','image/jpeg','image/gif','image/webp','image/x-icon','image/vnd.microsoft.icon','image/svg+xml','image/bmp']);
  try{
    let target=new URL(url);const bounded=AbortSignal.any([signal,AbortSignal.timeout(3000)]);
    for(let redirects=0;redirects<=3;redirects++){
      if(!['http:','https:'].includes(target.protocol))return null;
      const reply=await session.fetch(target.href,{redirect:'manual',credentials:'include',signal:bounded});
      if([301,302,303,307,308].includes(reply.status)){const location=reply.headers.get('location');await reply.body?.cancel();if(!location)return null;target=new URL(location,target);continue;}
      const type=reply.headers.get('content-type')?.split(';')[0].trim().toLowerCase()??'';
      if(!reply.ok||!types.has(type)||Number(reply.headers.get('content-length'))>maximum){await reply.body?.cancel();return null;}
      const reader=reply.body?.getReader();if(!reader)return null;const chunks:Uint8Array[]=[];let bytes=0;
      try{while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>maximum){await reader.cancel();return null;}chunks.push(part.value);}}finally{reader.releaseLock();}
      return bytes?'data:'+type+';base64,'+Buffer.concat(chunks).toString('base64'):null;
    }
  }catch{/* A missing favicon does not turn a usable page into a failure. */}
  return null;
}
