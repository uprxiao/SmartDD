import { ApplicationError } from '@shared/applications';
import type { ApplicationDataHost,ApplicationDataBinding } from './application-adapter-registry';
import type { ApplicationExecutionContext } from './execution-context';
import type { MailDraftDataService } from './draft-data-service';
import type { MailSendDataService } from './mail-send-data-service';
import type { MailReadDataService } from './mail-read-data-service';
import type { ZentaoDataService } from './zentao-data-service';
import type {ApplicationHostCatalog} from './host-application-registry';
interface RegisteredHostData {registry:ApplicationHostCatalog;hosts:readonly {appId:string;data:ApplicationDataHost}[]}
export class ApplicationBusinessDataService implements ApplicationDataHost {
  private readonly builtinMail?:MailDraftDataService;
  private readonly builtinZentao?:ZentaoDataService;
  get mail():MailDraftDataService{if(!this.builtinMail)throw new ApplicationError('CAPABILITY_UNAVAILABLE','当前宿主未提供内置邮件Data API');return this.builtinMail;}
  get zentao():ZentaoDataService{if(!this.builtinZentao)throw new ApplicationError('CAPABILITY_UNAVAILABLE','当前宿主未提供内置禅道Data API');return this.builtinZentao;}
  readonly mailRead?:MailReadDataService;
  readonly mailSend?:MailSendDataService;
  private readonly hosts=new Map<string,ApplicationDataHost>();
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
      this.hosts.set('mail',{resolve:(version,method,binding)=>mailSend&&method.startsWith('mail.send.')?mailSend.resolve(version,method,binding):mailRead&&['mail.query','mail.read','mail.resource.read'].includes(method)?mailRead.resolve(version,method,binding):first.resolve(version,method,binding)});
    }
  }
  resolve(version:1,method:string,binding:Readonly<ApplicationDataBinding>){
    const host=this.hosts.get(binding.appId);if(!host||!method.startsWith(binding.appId+'.'))throw new ApplicationError('CAPABILITY_UNAVAILABLE','当前宿主没有该应用Data API');return host.resolve(version,method,binding);
  }
  execute(context:ApplicationExecutionContext,method:string,input:unknown){
    if(context.appId==='mail'&&this.builtinMail)return this.mailSend&&method.startsWith('mail.send.')?this.mailSend.execute(context,method,input):this.mailRead&&['mail.query','mail.read','mail.resource.read'].includes(method)?this.mailRead.execute(context,method,input):this.mail.execute(context,method,input);if(context.appId==='zentao'&&this.builtinZentao)return this.zentao.execute(context,method,input);throw new ApplicationError('CAPABILITY_UNAVAILABLE','当前宿主没有该应用Data API');
  }
}
