import {randomUUID} from 'node:crypto';
import {ApplicationError} from '@shared/applications';
import {BrowserOperations} from '../operations';
import {BrowserCookieSourceError} from './chromium-source';

/** User actions have their own run identity, separate from authenticated CLI
 * runs. Only fixed public metadata is recorded; values/paths/errors never are. */
export class BrowserCookieImportAudit {
  private readonly runId='browser-ui-'+randomUUID();
  constructor(private readonly operations:BrowserOperations,private readonly taskProject?:(taskId:string)=>string|null){}
  async run<T>(taskId:string,profileId:string,action:'import'|'recover'|'clear',work:()=>Promise<T>):Promise<T>{
    const requestId=randomUUID(),summary={actor:'user',projectId:this.taskProject?.(taskId)??null,profileId,action};
    this.operations.begin(this.runId,requestId,taskId,null,'ui cookie '+action);
    this.operations.update(this.runId,requestId,'running','unknown',{summary});
    try{
      const result=await work();this.operations.update(this.runId,requestId,'succeeded','completed',{summary});return result;
    }catch(error){
      const source=error instanceof BrowserCookieSourceError,code=error instanceof ApplicationError?error.code:source?error.reason:'BROWSER_ERROR';
      this.operations.update(this.runId,requestId,source?'failed':'unknown',source?'not-started':'unknown',{summary,code});throw error;
    }
  }
}
