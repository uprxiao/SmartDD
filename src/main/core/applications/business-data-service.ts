import { ApplicationError } from '@shared/applications';
import type { ApplicationDataHost,ApplicationDataBinding } from './application-adapter-registry';
import type { ApplicationExecutionContext } from './execution-context';
import type { MailDraftDataService } from './draft-data-service';
import type { MailSendDataService } from './mail-send-data-service';
import type { MailReadDataService } from './mail-read-data-service';
import type { ZentaoDataService } from './zentao-data-service';
import type {ApplicationHostCatalog} from './host-application-registry';
type RegisteredData=ApplicationDataHost&{legacyData?:ApplicationDataHost;execute?:(context:ApplicationExecutionContext,method:string,input:unknown)=>Promise<unknown>};
interface RegisteredHostData {registry:ApplicationHostCatalog;hosts:readonly {appId:string;data:RegisteredData}[]}
export class ApplicationBusinessDataService implements ApplicationDataHost {
  private readonly builtinMail?:MailDraftDataService;
  private readonly builtinZentao?:ZentaoDataService;
  /** Compatibility accessors for retained internal M10 consumers. New callers use the generic dispatch below. */
  get mail():MailDraftDataService{const service=this.builtinMail??this.hosts.get('mail')?.legacyData;if(!service||typeof Reflect.get(service,'execute')!=='function')throw new ApplicationError('CAPABILITY_UNAVAILABLE','当前宿主未提供内置邮件Data API');return service as MailDraftDataService;}
  get zentao():ZentaoDataService{const service=this.builtinZentao??this.hosts.get('zentao');if(!service||typeof Reflect.get(service,'assertStoredReference')!=='function')throw new ApplicationError('CAPABILITY_UNAVAILABLE','当前宿主未提供内置禅道Data API');return service as ZentaoDataService;}
  readonly mailRead?:MailReadDataService;
  readonly mailSend?:MailSendDataService;
  private readonly hosts=new Map<string,RegisteredData>();
  constructor(registration:RegisteredHostData);
  constructor(mail:MailDraftDataService,zentao:ZentaoDataService,mailRead?:MailReadDataService,mailSend?:MailSendDataService);
  constructor(first:MailDraftDataService|RegisteredHostData,zentao?:ZentaoDataService,mailRead?:MailReadDataService,mailSend?:MailSendDataService){
    if('hosts' in first){
      const ids=new Set(first.registry.appIds());
      if(!Array.isArray(first.hosts)||!first.hosts.length||first.hosts.length>128)throw new ApplicationError('INVALID_INPUT','受信宿主Data API登记无效');
      for(const host of first.hosts){if(!host||!ids.has(host.appId)||this.hosts.has(host.appId)||!host.data||typeof host.data.resolve!=='function')throw new ApplicationError('INVALID_INPUT','受信宿主Data API未登记或重复');this.hosts.set(host.appId,host.data);}
    }else{
      if(!zentao)throw new ApplicationError('INVALID_INPUT','内置应用Data API未准备');
      this.builtinMail=first;this.builtinZentao=zentao;this.mailRead=mailRead;this.mailSend=mailSend;
      this.hosts.set('zentao',zentao);
      const target=(method:string)=>mailSend&&method.startsWith('mail.send.')?mailSend:mailRead&&['mail.query','mail.read','mail.resource.read'].includes(method)?mailRead:first;
      this.hosts.set('mail',{resolve:(version,method,binding)=>target(method).resolve(version,method,binding),execute:(context,method,input)=>target(method).execute(context,method,input)});
    }
  }
  resolve(version:1,method:string,binding:Readonly<ApplicationDataBinding>){
    const host=this.hosts.get(binding.appId);if(!host||!method.startsWith(binding.appId+'.'))throw new ApplicationError('CAPABILITY_UNAVAILABLE','当前宿主没有该应用Data API');return host.resolve(version,method,binding);
  }
  execute(context:ApplicationExecutionContext,method:string,input:unknown){
    const host=this.hosts.get(context.appId);if(!host?.execute||!method.startsWith(context.appId+'.'))throw new ApplicationError('CAPABILITY_UNAVAILABLE','当前宿主没有该应用Data API');return host.execute(context,method,input);
  }
}
