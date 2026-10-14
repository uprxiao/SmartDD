import { safeStorage } from 'electron';
import type { Db } from './db';

// The master key lives in the macOS Keychain ("<app name> Safe Storage"); SQLite only holds ciphertext.
export class SecretsStore {
  constructor(private readonly db: Db) {}

  set(key: string, secret: string): void {
    this.assertAvailable();
    const enc = safeStorage.encryptString(secret).toString('base64');
    this.db
      .prepare('INSERT INTO app_secrets (key, secret) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET secret = excluded.secret')
      .run(key, enc);
  }

  get(key: string): string | null {
    const row = this.db.prepare('SELECT secret FROM app_secrets WHERE key = ?').get(key) as { secret: string } | undefined;
    if (!row) return null;
    this.assertAvailable();
    return safeStorage.decryptString(Buffer.from(row.secret, 'base64'));
  }

  delete(key: string): void {
    this.db.prepare('DELETE FROM app_secrets WHERE key = ?').run(key);
  }

  private assertAvailable(): void {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('系统安全存储不可用（safeStorage），拒绝以明文保存密钥');
    }
  }
}
