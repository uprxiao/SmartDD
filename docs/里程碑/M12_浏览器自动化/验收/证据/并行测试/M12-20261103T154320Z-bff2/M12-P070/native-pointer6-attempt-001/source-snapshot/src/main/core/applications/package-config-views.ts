import {connectionConfigSchema,type ApplicationConnection,type ConnectionConfig} from '@shared/application-connections';
import type {ApplicationExecutionContexts,ApplicationExecutionContext} from './execution-context';

/** Typed built-in view; authorization, pinning and conversion stay in the execution context. */
export class PackageConfigViews {
 constructor(private readonly contexts:ApplicationExecutionContexts){}
 get(context:ApplicationExecutionContext,connection:ApplicationConnection):ConnectionConfig{
  return connectionConfigSchema.parse(this.contexts.configView(context,connection).view);
 }
}
