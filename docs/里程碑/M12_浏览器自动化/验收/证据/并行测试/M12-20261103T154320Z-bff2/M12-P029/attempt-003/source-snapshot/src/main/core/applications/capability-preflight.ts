import {ApplicationError} from '@shared/applications';

// Host-only evidence for this exact operation, never a caller field/error code.
const operations=new WeakMap<ApplicationError,string>();
export function applicationPreflightFailure(error:unknown,operationId:string):unknown{
  if(error instanceof ApplicationError&&error.code==='UPSTREAM_RESULT_UNKNOWN')return error;
  const failure=error instanceof ApplicationError
    ?new ApplicationError(error.code,error.message)
    :new ApplicationError('CAPABILITY_UNAVAILABLE','本次应用前置检查未完成');
  operations.set(failure,operationId);
  return failure;
}
export function isApplicationPreflightFailure(error:unknown,operationId:string|undefined):boolean{
  return error instanceof ApplicationError&&operationId!==undefined&&operations.get(error)===operationId;
}
