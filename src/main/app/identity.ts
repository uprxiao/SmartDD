import { join } from 'node:path';
import type { App } from 'electron';

export const APP_NAME = 'WillYou';
const STORAGE_NAME = 'SmartDD';

/**
 * Run before app readiness. Electron uses its internal app name for macOS
 * Keychain / Linux safeStorage, not just for the data directory. Keep that
 * identity stable across rebrands; use APP_NAME for visible titles and menus.
 * https://github.com/electron/electron/issues/40430
 */
export function configureAppIdentity(app: Pick<App, 'setName' | 'getPath' | 'setPath'>, override?: string): void {
  app.setName(STORAGE_NAME);
  app.setPath('userData', resolveUserData(app.getPath('appData'), override));
}

/** The display name must never redirect an existing installation to an empty database. */
export function resolveUserData(appData: string, override?: string): string {
  return override || join(appData, STORAGE_NAME);
}
