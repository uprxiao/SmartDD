import {describe,it,expect,vi} from 'vitest';
import {ApplicationError} from '@shared/applications';
import {CredentialHandles,type CredentialHandle} from '../credential-handles';

describe('process-local single-use credential capabilities',()=>{
 it('defers secret access until authentication and carries no serialized secret or callback',()=>{
  const handles=new CredentialHandles<string>(),owner={},read=vi.fn(()=> 'private-credential'),handle=handles.issue(owner,read);
  expect(read).not.toHaveBeenCalled();expect(JSON.stringify(handle)).toBe('{}');expect(Reflect.ownKeys(handle)).toEqual([]);
  expect(handles.consume(owner,handle)).toBe('private-credential');expect(read).toHaveBeenCalledTimes(1);
  expect(()=>handles.consume(owner,handle)).toThrow(expect.objectContaining({code:'SCOPE_DENIED'}));expect(read).toHaveBeenCalledTimes(1);
 });
 it('rejects foreign owners, copied and other-registry handles without invoking authentication',()=>{
  const handles=new CredentialHandles<string>(),owner={},read=vi.fn(()=> 'secret'),handle=handles.issue(owner,read);
  for(const attempt of [()=>handles.consume({},handle),()=>handles.consume(owner,JSON.parse(JSON.stringify(handle)) as CredentialHandle),()=>new CredentialHandles<string>().consume(owner,handle)])expect(attempt).toThrow(expect.objectContaining({code:'SCOPE_DENIED'}));
  expect(read).not.toHaveBeenCalled();expect(handles.consume(owner,handle)).toBe('secret');
 });
 it('revalidates at consumption and permanently rejects replay after revocation',()=>{
  const handles=new CredentialHandles<string>(),owner={};let active=true;const read=vi.fn(()=> 'secret');
  const handle=handles.issue(owner,()=>{if(!active)throw new ApplicationError('CANCELED','operation ended');return read();});
  active=false;expect(()=>handles.consume(owner,handle)).toThrow(expect.objectContaining({code:'CANCELED'}));active=true;
  expect(()=>handles.consume(owner,handle)).toThrow(expect.objectContaining({code:'SCOPE_DENIED'}));expect(read).not.toHaveBeenCalled();
 });
 it('reads current authentication material instead of caching issuance-time secrets',()=>{
  const handles=new CredentialHandles<string>(),owner={};let secret='old';const handle=handles.issue(owner,()=>secret);secret='new';expect(handles.consume(owner,handle)).toBe('new');
 });
});
