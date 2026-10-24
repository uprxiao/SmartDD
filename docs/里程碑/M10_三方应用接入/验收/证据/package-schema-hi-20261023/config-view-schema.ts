import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {AjvJsonSchemaValidator} from '@modelcontextprotocol/server/validators/ajv';
import type {JsonSchemaType} from '@modelcontextprotocol/server';
import {ApplicationError,type InstalledApplicationPackage} from '@shared/applications';
import type {ResourceStore} from './resource-store';
import {digest} from './manifest';
const validator=new AjvJsonSchemaValidator();
/** Validate the converted view against the exact retained package contract. */
export function validateConfigViewSchema(store:ResourceStore,pack:InstalledApplicationPackage,providerId:string,view:unknown){
 const contract=pack.manifest.connectionContracts.find(item=>item.providerId===providerId);
 if(!contract)throw new ApplicationError('CONFIG_COMPATIBILITY_UNVERIFIED','原包没有连接配置契约');
 const bytes=readFileSync(join(store.root,pack.relativePath,contract.inputSchemaPath)),declared=pack.manifest.files.find(file=>file.path===contract.inputSchemaPath);
 if(!declared||bytes.length!==declared.size||digest(bytes)!==declared.sha256)throw new ApplicationError('HASH_MISMATCH','原包连接Schema内容不符');
 if(!validator.getValidator(JSON.parse(bytes.toString('utf8')) as JsonSchemaType)(view).valid)throw new ApplicationError('CONFIG_INCOMPATIBLE','当前连接不能转换为原包所需配置');
 return declared.sha256;
}
