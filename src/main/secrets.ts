import { eq } from 'drizzle-orm';
import { safeStorage } from 'electron';
import type { AppDb } from './db/client';
import { appSecrets } from './db/schema';

// The master key lives in the macOS Keychain ("<app name> Safe Storage"); SQLite only holds ciphertext.
export class SecretsStore {
  constructor(private readonly db: AppDb) {}

  set(key: string, secret: string): void {
    this.assertAvailable();
    const enc = safeStorage.encryptString(secret).toString('base64');
    this.db
      .insert(appSecrets)
      .values({ key, secret: enc })
      .onConflictDoUpdate({ target: appSecrets.key, set: { secret: enc } })
      .run();
  }

  get(key: string): string | null {
    const row = this.db.select().from(appSecrets).where(eq(appSecrets.key, key)).get();
    if (!row) return null;
    this.assertAvailable();
    return safeStorage.decryptString(Buffer.from(row.secret, 'base64'));
  }

  delete(key: string): void {
    this.db.delete(appSecrets).where(eq(appSecrets.key, key)).run();
  }

  private assertAvailable(): void {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('系统安全存储不可用（safeStorage），拒绝以明文保存密钥');
    }
  }
}
