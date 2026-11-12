import {ApplicationError} from '@shared/applications';
import {buildApplicationResultV2} from '../result-v2';
import type {ValidatedPlugin} from './package';

/** The declared wire projection may change data keys, never host source or operation authority. */
export function pluginLegacyResult(plugin:ValidatedPlugin,name:string,identity:Parameters<typeof buildApplicationResultV2>[0],raw:unknown){
  const contract=plugin.manifest.legacyToolContracts?.[name];
  if(!contract||plugin.manifest.legacyToolNames[name]!==identity.capabilityId)throw new ApplicationError('CONFIG_INCOMPATIBLE','旧工具契约与实际执行能力不符');
  const data=contract.dataFields&&raw&&typeof raw==='object'&&!Array.isArray(raw)?Object.fromEntries(contract.dataFields.filter(key=>Object.hasOwn(raw,key)).map(key=>[key,Reflect.get(raw,key)])):raw;
  const value=buildApplicationResultV2(identity,data);
  if(!plugin.legacyContracts.get(name)!.output(value).valid)throw new ApplicationError('INVALID_RESPONSE','插件结果不符合旧版输出契约');
  return value;
}
