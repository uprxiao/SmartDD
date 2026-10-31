import {describe,it,expect} from 'vitest';
import {HostApplicationRegistry,builtinHostApplications} from '../host-application-registry';
describe('trusted read-default declarations',()=>{
 it('pins only declared Foxmail preferences and freezes the private declaration copy',()=>{
  const keys=['queryDays'],providers=builtinHostApplications.providers.map(p=>p.id==='foxmail'?{...p,readDefaultKeys:keys}:p),registry=new HostApplicationRegistry({...builtinHostApplications,providers});
  keys.push('account');expect(registry.provider('foxmail').readDefaultKeys).toEqual(['queryDays']);expect(Object.isFrozen(registry.provider('foxmail').readDefaultKeys)).toBe(true);expect(registry.provider('smtp').readDefaultKeys).toBeUndefined();expect(registry.provider('zentao').readDefaultKeys).toBeUndefined();
 });
 for(const keys of [[],['kind'],['constructor'],['prototype'],['__proto__'],['queryDays','queryDays'],Array.from({length:9},(_,i)=>'field'+i),[1],'queryDays'])it('rejects malformed or unsafe default declarations '+JSON.stringify(keys),()=>{
  const providers=builtinHostApplications.providers.map(p=>p.id==='foxmail'?{...p,readDefaultKeys:keys}:p);expect(()=>new HostApplicationRegistry({...builtinHostApplications,providers} as never)).toThrow('受信宿主应用定义无效');
 });
 for(const id of ['smtp','zentao'])it('does not allow a credential provider to opt out of configuration revision checks '+id,()=>{
  const providers=builtinHostApplications.providers.map(p=>p.id===id?{...p,readDefaultKeys:['username']}:p);expect(()=>new HostApplicationRegistry({...builtinHostApplications,providers})).toThrow('受信宿主应用定义无效');
 });
});
