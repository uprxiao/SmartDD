import picomatch from 'picomatch';
import {z} from 'zod';
import type {BrowserPage} from './page-registry';
import {ApplicationError} from '@shared/applications';
const headers=z.record(z.string(),z.unknown()).transform(value=>Object.entries(value).map(([name,value])=>({name,value:String(value)})));
const responseValue=z.object({status:z.number(),statusText:z.string(),headers,mimeType:z.string(),protocol:z.string().optional(),encodedDataLength:z.number().optional()});
const requestSchema=z.object({requestId:z.string(),timestamp:z.number(),wallTime:z.number().optional(),request:z.object({url:z.string(),method:z.string(),headers,postData:z.string().optional()}),redirectResponse:responseValue.optional()});
const responseSchema=z.object({requestId:z.string(),timestamp:z.number(),response:responseValue});
type Request=z.infer<typeof requestSchema>;
type Response=z.infer<typeof responseSchema>;
interface Entry {request:Request;response?:Response;finished?:number;decodedBytes?:number;encodedBytes?:number;transferBytes?:number;error?:string}

/** Passive observation only. In particular, intercept never enables Fetch or pauses a request. */
export class BrowserRecorder {
  private capture:Map<string,Entry>|null=null;
  private entries:Entry[]=[];
  private pattern:string|null=null;
  private matches:((url:string)=>boolean)|null=null;
  private intercepted:{requestId:string;url:string;method:string}[]=[];
  private readonly off:()=>void;
  constructor(private readonly page:BrowserPage){
    this.off=page.proxy.onEvent(event=>{
      if(event.method==='Network.requestWillBeSent'){
        const parsed=requestSchema.safeParse(event.params);if(!parsed.success)return;
        const request=parsed.data;
        if(this.capture){
          const key=(event.sessionId??'')+'\0'+request.requestId,previous=this.capture.get(key);
          if(previous&&request.redirectResponse){previous.response={requestId:request.requestId,timestamp:request.timestamp,response:request.redirectResponse};previous.finished=request.timestamp;}
          const entry={request};this.capture.set(key,entry);this.entries.push(entry);
        }
        if(this.matches?.(request.request.url))this.intercepted.push({requestId:request.requestId,url:request.request.url,method:request.request.method});
      }else if(event.method==='Network.responseReceived'){
        const parsed=responseSchema.safeParse(event.params);if(!parsed.success)return;
        const entry=this.capture?.get((event.sessionId??'')+'\0'+parsed.data.requestId);if(entry)entry.response=parsed.data;
      }else if(event.method==='Network.dataReceived'){
        const id=event.params.requestId,entry=typeof id==='string'?this.capture?.get((event.sessionId??'')+'\0'+id):undefined;
        if(entry){if(typeof event.params.dataLength==='number')entry.decodedBytes=(entry.decodedBytes??0)+event.params.dataLength;if(typeof event.params.encodedDataLength==='number')entry.encodedBytes=(entry.encodedBytes??0)+event.params.encodedDataLength;}
      }else if(event.method==='Network.loadingFinished'||event.method==='Network.loadingFailed'){
        const id=event.params.requestId,entry=typeof id==='string'?this.capture?.get((event.sessionId??'')+'\0'+id):undefined;
        if(entry){if(typeof event.params.timestamp==='number')entry.finished=event.params.timestamp;if(typeof event.params.encodedDataLength==='number')entry.transferBytes=event.params.encodedDataLength;if(typeof event.params.errorText==='string')entry.error=event.params.errorText;}
      }
    });
    page.abort.signal.addEventListener('abort',()=>this.dispose(),{once:true});
  }
  async start(dispatched:()=>void=()=>{}){if(this.capture)throw new ApplicationError('INVALID_INPUT','此页面已在采集，请先capture stop');dispatched();await this.page.proxy.send('Network.enable');this.capture=new Map();this.entries=[];return{capturing:true};}
  stop(){
    if(!this.capture)throw new ApplicationError('INVALID_INPUT','此页面尚未开始采集');
    const entries=this.entries.map(entry=>{
      // CDP can timestamp loadingFinished slightly before responseReceived.
      // HAR requires total time to equal its nonnegative timing components.
      const {request,response}=entry,req=request.request,res=response?.response,end=Math.max(entry.finished??request.timestamp,response?.timestamp??request.timestamp),time=Math.max(0,(end-request.timestamp)*1000),wait=Math.max(0,((response?.timestamp??end)-request.timestamp)*1000);
      const url=new URL(req.url),postData=req.postData,bodySize=postData===undefined?0:Buffer.byteLength(postData);
      return{startedDateTime:new Date((request.wallTime??Date.now()/1000)*1000).toISOString(),time,
        request:{method:req.method,url:req.url,httpVersion:res?.protocol??'HTTP/1.1',cookies:[],headers:req.headers,queryString:[...url.searchParams].map(([name,value])=>({name,value})),headersSize:-1,bodySize,...(postData===undefined?{}:{postData:{mimeType:req.headers.find(h=>h.name.toLowerCase()==='content-type')?.value??'application/octet-stream',text:postData}})},
        response:{status:res?.status??0,statusText:res?.statusText??entry.error??'',httpVersion:res?.protocol??'HTTP/1.1',cookies:[],headers:res?.headers??[],content:{size:entry.decodedBytes??0,mimeType:res?.mimeType??''},redirectURL:res?.headers.find(h=>h.name.toLowerCase()==='location')?.value??'',headersSize:-1,bodySize:entry.encodedBytes??-1,...(entry.transferBytes===undefined?{}:{_transferSize:entry.transferBytes})},cache:{},timings:{send:0,wait,receive:Math.max(0,time-wait)}};
    });this.capture=null;this.entries=[];return{log:{version:'1.2',creator:{name:'WillYou',version:'0.1.1'},entries}};
  }
  async enable(patterns:string[]){
    const pattern=patterns[0]??'**/*',matches=picomatch(pattern,{dot:true});await this.page.proxy.send('Network.enable');
    this.pattern=pattern;this.matches=matches;this.intercepted=[];return{enabled:true,recordOnly:true,pattern,ignoredPatterns:patterns.slice(1)};
  }
  disable(){this.pattern=null;this.matches=null;return{enabled:false,recordOnly:true};}
  list(){return{pattern:this.pattern,requests:[...this.intercepted],recordOnly:true};}
  dispose(){this.off();this.capture=null;this.entries=[];this.intercepted=[];this.matches=null;}
}
