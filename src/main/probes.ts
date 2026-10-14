import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { safeStorage } from 'electron';
import type { ProbeResult } from '@shared/types';
import type { DbClient } from './db/client';
import { PtyManager } from './pty-manager';
import { safeStorageCipher } from './safe-storage-cipher';
import { SecretsStore } from './secrets';

const execFileP = promisify(execFile);

async function probe(name: string, fn: () => Promise<string> | string): Promise<ProbeResult> {
  try {
    return { name, ok: true, detail: await fn() };
  } catch (e) {
    return { name, ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

// Run a command through the same login-shell wrapper the terminals use and collect its output.
function runInPty(command: string, args: string[], env: Record<string, string>, cwd: string): Promise<{ code: number; out: string }> {
  const mgr = new PtyManager();
  return new Promise((resolve, reject) => {
    let out = '';
    const timer = setTimeout(() => {
      mgr.killAll();
      reject(new Error(`PTY 超时，已收到输出：${out.slice(-200)}`));
    }, 20_000);
    mgr.on('data', (_id: string, d: string) => (out += d));
    mgr.on('exit', (_id: string, code: number) => {
      clearTimeout(timer);
      resolve({ code, out });
    });
    mgr.spawn({ command, args, env, cwd });
  });
}

export async function runProbes(client: DbClient, dbFile: string, baseEnv: Record<string, string>): Promise<ProbeResult[]> {
  const results: ProbeResult[] = [];
  const home = baseEnv.HOME || process.cwd();
  const db = client.sqlite;

  results.push(
    await probe('P1 better-sqlite3', () => {
      const { v } = db.prepare('SELECT sqlite_version() AS v').get() as { v: string };
      db.exec('CREATE TABLE IF NOT EXISTS probe_kv (k TEXT PRIMARY KEY, v TEXT)');
      db.prepare('INSERT INTO probe_kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').run('ping', 'pong');
      const row = db.prepare('SELECT v FROM probe_kv WHERE k = ?').get('ping') as { v: string } | undefined;
      if (row?.v !== 'pong') throw new Error('写入后读回不一致');
      return `sqlite ${v}，读写一致，文件 ${dbFile}`;
    })
  );

  results.push(
    await probe('P1 node-pty', async () => {
      const marker = `smartdd-pty-${Date.now()}`;
      const { code, out } = await runInPty('echo', [marker], baseEnv, home);
      if (code !== 0 || !out.includes(marker)) throw new Error(`exit=${code}，输出中未找到标记`);
      return `登录 shell 包装执行成功，exit=${code}`;
    })
  );

  results.push(
    await probe('P5 safeStorage', () => {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('isEncryptionAvailable() = false');
      const store = new SecretsStore(client.db, safeStorageCipher);
      const plain = `probe-secret-${Date.now()}`;
      store.set('probe', plain);
      const back = store.get('probe');
      if (back !== plain) throw new Error('解密结果与原文不一致');
      db.pragma('wal_checkpoint(TRUNCATE)');
      const leaked = readFileSync(dbFile).includes(Buffer.from(plain));
      store.delete('probe');
      if (leaked) throw new Error('数据库文件中发现明文');
      return '加解密往返一致，数据库文件中无明文';
    })
  );

  results.push(
    await probe('P7 环境变量注入', async () => {
      const value = `injected-${Date.now()}`;
      // A grandchild process proves the variable survives the login shell and is inherited further down.
      const { out } = await runInPty('/bin/sh', ['-c', "sh -c 'echo SMARTDD_PROBE_VAR=$SMARTDD_PROBE_VAR'"], { ...baseEnv, SMARTDD_PROBE_VAR: value }, home);
      if (!out.includes(`SMARTDD_PROBE_VAR=${value}`)) throw new Error(`孙进程未读到注入值，输出：${out.slice(-200)}`);
      return 'PTY → 登录 shell → 子进程 → 孙进程，均读到注入值';
    })
  );

  for (const cli of ['claude', 'codex'] as const) {
    results.push(
      await probe(`CLI ${cli}`, async () => {
        const { out, code } = await runInPty('/bin/sh', ['-c', `command -v ${cli} && ${cli} --version`], baseEnv, home);
        if (code !== 0) throw new Error(`登录 shell 中找不到 ${cli}（exit=${code}）`);
        return out.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '').trim().split(/\r?\n/).slice(-2).join(' | ');
      })
    );
  }

  results.push(
    await probe('PATH 来源', async () => {
      const { stdout } = await execFileP('/bin/sh', ['-c', 'echo "$PATH"']);
      return `主进程 PATH 段数 ${stdout.trim().split(':').length}（Finder 启动时通常很短，终端统一走登录 shell）`;
    })
  );

  return results;
}
