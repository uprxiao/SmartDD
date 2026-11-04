import {ApplicationError} from '@shared/applications';

declare const credentialBrand:unique symbol;
export type CredentialHandle=Readonly<{[credentialBrand]:true}>;
/** Process-local capabilities. Never serialize, persist or expose to adapters/renderer. */
export class CredentialHandles<T>{
 private readonly entries=new WeakMap<object,{owner:object;authenticate:()=>T}>();
 issue(owner:object,authenticate:()=>T):CredentialHandle{
  const handle=Object.freeze(Object.create(null)) as CredentialHandle;
  this.entries.set(handle,{owner,authenticate});return handle;
 }
 consume(owner:object,handle:CredentialHandle):T{
  const entry=this.entries.get(handle);
  if(!entry||entry.owner!==owner)throw new ApplicationError('SCOPE_DENIED','凭据句柄不属于当前操作或已经使用');
  // Consume even when revalidation fails. A failed authorization cannot be replayed.
  this.entries.delete(handle);return entry.authenticate();
 }
}
