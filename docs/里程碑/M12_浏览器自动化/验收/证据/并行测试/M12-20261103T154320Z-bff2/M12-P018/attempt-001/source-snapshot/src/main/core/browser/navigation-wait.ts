import {ApplicationError} from '@shared/applications';
/** A navigation may wait on a user auth prompt indefinitely. Stop awaiting the
 * command on its budget/cancellation without discarding that user's prompt.
 * Always observe the eventual native settlement, including a late rejection. */
export function awaitBrowserNavigation<T>(navigation:Promise<T>,signal:AbortSignal):Promise<T>{
  return new Promise<T>((resolve,reject)=>{
    let settled=false;const finish=(success:boolean,value:unknown)=>{if(settled)return;settled=true;signal.removeEventListener('abort',aborted);success?resolve(value as T):reject(value);};
    const aborted=()=>finish(false,signal.reason??new ApplicationError('CANCELED','导航等待已取消'));
    signal.addEventListener('abort',aborted,{once:true});void navigation.then(value=>finish(true,value),error=>finish(false,error));if(signal.aborted)aborted();
  });
}
