import {connectionConfigSchema} from '@shared/application-connections';
import type {z} from 'zod';
type RetainedConnectionConfig=z.infer<typeof connectionConfigSchema>;
// Retained v1 converters keep their schema and function identity. New providers
// declare converters in their module or use the registry's identity converter.
const auth=(source:unknown)=>{const config=source as RetainedConnectionConfig;return config.kind==='foxmail'?'local-readonly':config.authMode;};
export const retainedConfigViewDefinitions=['zentao','foxmail','smtp'].map(providerId=>({providerId,sourceSchemaVersion:1,targetApiMajor:1,identityContractMajor:1,implementationVersion:'1',sourceSchema:connectionConfigSchema,targetSchema:connectionConfigSchema,outputAuthentication:auth,authModes:providerId==='foxmail'?['local-readonly']:providerId==='smtp'?['password']:['token','password'],authentication:auth,convert:(source:unknown)=>source}));
