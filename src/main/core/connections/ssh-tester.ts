import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Client, type ConnectConfig } from 'ssh2';
import type { ConnectionTestResult } from '@shared/projects';
import { classifyError, withDeadline } from './classify';
import { DEFAULT_TEST_TIMEOUT_MS } from './db-tester';
import { redact } from './redact';

export interface SshTarget {
  host: string;
  port: number;
  username: string;
  authType: 'password' | 'key';
  password: string;
  privateKeyPath: string | null;
  passphrase: string;
}

/** Read-only: prints who and where we are. Never changes anything on the server. */
export const SSH_TEST_COMMAND = 'hostname; whoami';

/**
 * SSH handshake, authentication and one read-only command. The host key is not verified in M2;
 * its SHA256 fingerprint is reported so the user can check they reached the right machine.
 */
export async function testSsh(target: SshTarget, timeoutMs = DEFAULT_TEST_TIMEOUT_MS): Promise<ConnectionTestResult> {
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  const secrets = [target.password, target.passphrase];
  const fail = (category: ConnectionTestResult['category'], message: string): ConnectionTestResult => ({
    ok: false,
    category,
    message: redact(message, secrets),
    ms: elapsed(),
  });

  let privateKey: Buffer | undefined;
  if (target.authType === 'key') {
    if (!target.privateKeyPath) return fail('config', '未填写私钥路径');
    try {
      privateKey = await readFile(target.privateKeyPath);
    } catch (e) {
      return fail('config', `私钥文件不可读：${(e as Error).message}`);
    }
  }

  const client = new Client();
  let fingerprint = '';
  const config: ConnectConfig = {
    host: target.host,
    port: target.port,
    username: target.username,
    readyTimeout: timeoutMs,
    // No ssh-agent and no ~/.ssh lookups: test exactly the credentials in the form.
    agent: undefined,
    hostVerifier: (key: Buffer) => {
      fingerprint = `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`;
      return true;
    },
    ...(target.authType === 'password'
      ? { password: target.password, tryKeyboard: true }
      : { privateKey, passphrase: target.passphrase || undefined }),
  };

  const work = new Promise<string>((resolve, reject) => {
    client.on('keyboard-interactive', (_name, _instructions, _lang, prompts, finish) => {
      finish(prompts.map(() => target.password));
    });
    client.on('error', reject);
    client.on('ready', () => {
      client.exec(SSH_TEST_COMMAND, (err, stream) => {
        if (err) return reject(err);
        let out = '';
        let errOut = '';
        stream.on('data', (d: Buffer) => (out += d.toString()));
        stream.stderr.on('data', (d: Buffer) => (errOut += d.toString()));
        stream.on('close', (code: number | null) => {
          if (code === 0) resolve(out.trim().split(/\s+/).join(' / '));
          else reject(new Error(`只读命令退出码 ${code}：${errOut.trim() || out.trim()}`));
        });
      });
    });
    try {
      client.connect(config);
    } catch (e) {
      // ssh2 throws synchronously for unusable keys (bad format, missing passphrase).
      reject(e);
    }
  });

  try {
    const who = await withDeadline(work, timeoutMs, () => client.end());
    return {
      ok: true,
      category: 'ok',
      message: '',
      ms: elapsed(),
      detail: redact(`${who}；主机指纹 ${fingerprint}`, secrets),
    };
  } catch (error) {
    const { category, message } = classifyError('ssh', error);
    return fail(category, message);
  } finally {
    client.end();
  }
}
