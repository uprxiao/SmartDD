import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/server/validators/ajv';
import type { JsonSchemaType } from '@modelcontextprotocol/server';
import { ApplicationError } from '@shared/applications';
import type { ResourceStore } from './resource-store';
import type { ApplicationConnection,ConnectionConfig } from '@shared/application-connections';
import type { ApplicationExecutionContexts,ApplicationExecutionContext } from './execution-context';
import { BuiltinPackageRegistry } from './builtin-package-registry';
import { digest } from './manifest';
import {builtinConfigViews} from './config-view-registry';
/** Physical configuration is projected through known configApi1 fields and the original package schema. */
export class PackageConfigViews {
  private readonly validator=new AjvJsonSchemaValidator();
  constructor(private readonly contexts:ApplicationExecutionContexts){}
  get(context:ApplicationExecutionContext,connection:ApplicationConnection):ConnectionConfig{
    this.contexts.assertActive(context);if(context.appId!==connection.appId)throw new ApplicationError('SCOPE_DENIED','连接不属于当前应用');
    return packageConnectionView(this.contexts.store,context.packageHash,connection,this.validator);
  }
}
/** Local compatibility only; neither a network health check nor a new permission. */
export function packageConnectionView(store:ResourceStore,packageHash:string,connection:ApplicationConnection,validator=new AjvJsonSchemaValidator()):ConnectionConfig{
 const pack=new BuiltinPackageRegistry(store).assertTrusted(packageHash),contract=pack.manifest.connectionContracts.find(c=>c.providerId===connection.providerId);
 if(pack.appId!==connection.appId||!contract||contract.configApiMajor!==1||contract.identityContractMajor!==1)throw new ApplicationError('CONFIG_COMPATIBILITY_UNVERIFIED','原包连接视图尚未有兼容转换依据');
 const {view}=builtinConfigViews.resolve({providerId:connection.providerId,sourceSchemaVersion:1,targetApiMajor:contract.configApiMajor,identityContractMajor:contract.identityContractMajor},connection.config,contract.authModes);
 const bytes=readFileSync(join(store.root,pack.relativePath,contract.inputSchemaPath)),declared=pack.manifest.files.find(f=>f.path===contract.inputSchemaPath);
 if(!declared||bytes.length!==declared.size||digest(bytes)!==declared.sha256)throw new ApplicationError('HASH_MISMATCH','原包连接Schema内容不符');
 if(!validator.getValidator(JSON.parse(bytes.toString('utf8')) as JsonSchemaType)(view).valid)throw new ApplicationError('CONFIG_INCOMPATIBLE','当前连接不能转换为原包所需配置');return Object.freeze(view);
}
