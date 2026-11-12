import type Database from 'better-sqlite3';
/** A completed migration or explicit uninstall must never revive the compiled legacy application. */
export function hasExternalPluginOwner(db:Database.Database,appId:string):boolean {
  return !!db.prepare('SELECT 1 WHERE EXISTS(SELECT 1 FROM plugin_installations WHERE app_id=?) OR EXISTS(SELECT 1 FROM plugin_builtin_migrations WHERE app_id=?)').get(appId,appId);
}
