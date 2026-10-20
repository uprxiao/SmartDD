import { ApplicationError } from '@shared/applications';
import type { ApplicationDataHost,ApplicationDataBinding } from './application-adapter-registry';
import type { ApplicationExecutionContext } from './execution-context';
import type { MailDraftDataService } from './draft-data-service';
import type { MailReadDataService } from './mail-read-data-service';
import type { ZentaoDataService } from './zentao-data-service';
export class ApplicationBusinessDataService implements ApplicationDataHost {
  constructor(readonly mail:MailDraftDataService,readonly zentao:ZentaoDataService,readonly mailRead?:MailReadDataService){}
  resolve(version:1,method:string,binding:Readonly<ApplicationDataBinding>){
    if(binding.appId==='mail')return this.mailRead&&['mail.query','mail.read','mail.resource.read'].includes(method)?this.mailRead.resolve(version,method,binding):this.mail.resolve(version,method,binding);if(binding.appId==='zentao')return this.zentao.resolve(version,method,binding);throw new ApplicationError('CAPABILITY_UNAVAILABLE','当前宿主没有该应用Data API');
  }
  execute(context:ApplicationExecutionContext,method:string,input:unknown){
    if(context.appId==='mail')return this.mailRead&&['mail.query','mail.read','mail.resource.read'].includes(method)?this.mailRead.execute(context,method,input):this.mail.execute(context,method,input);if(context.appId==='zentao')return this.zentao.execute(context,method,input);throw new ApplicationError('CAPABILITY_UNAVAILABLE','当前宿主没有该应用Data API');
  }
}
