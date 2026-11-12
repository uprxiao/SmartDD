import type {ApplicationErrorCode} from './applications';
export interface PluginStartupStatus {
  appId:'zentao';
  state:'not-requested'|'ready'|'migrated'|'retained-uninstalled'|'failed';
  fallbackBuiltin:boolean;
  errorCode:ApplicationErrorCode|null;
  message:string;
}
