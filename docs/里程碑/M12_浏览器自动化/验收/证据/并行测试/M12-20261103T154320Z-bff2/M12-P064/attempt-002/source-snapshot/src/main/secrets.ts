import { eq, inArray } from 'drizzle-orm';
import type { AppDb } from './db/client';
import { appSecrets } from './db/schema';

/**
 * Encryption backend. In the app this is Electron safeStorage (master key in the macOS
 * Keychain, "<app name> Safe Storage"); tests inject a fake so they run without Electron.
 */
export interface SecretCipher {
  isAvailable(): boolean;
  encrypt(plain: string): Buffer;
  decrypt(cipher: Buffer): string;
}

// SQLite only holds ciphertext (base64).
export class SecretsStore {
  constructor(
    private readonly db: AppDb,
    private readonly cipher: SecretCipher
  ) {}

  set(key: string, secret: string): void {
    this.assertAvailable();
    const enc = this.cipher.encrypt(secret).toString('base64');
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
    return this.cipher.decrypt(Buffer.from(row.secret, 'base64'));
  }

  /** Presence check without decrypting (no Keychain prompt). */
  has(key: string): boolean {
    return Boolean(this.db.select({ key: appSecrets.key }).from(appSecrets).where(eq(appSecrets.key, key)).get());
  }

  delete(key: string): void {
    this.db.delete(appSecrets).where(eq(appSecrets.key, key)).run();
  }

  deleteMany(keys: string[]): void {
    if (keys.length) this.db.delete(appSecrets).where(inArray(appSecrets.key, keys)).run();
  }

  assertAvailable(): void {
    if (!this.cipher.isAvailable()) {
      throw new Error('系统安全存储不可用（safeStorage），拒绝以明文保存密钥');
    }
  }
}
