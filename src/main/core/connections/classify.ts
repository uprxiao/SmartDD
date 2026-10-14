import type { TestCategory } from '@shared/projects';

export type Protocol = 'mysql' | 'postgres' | 'ssh';

interface DriverError {
  message?: string;
  code?: string | number;
  errno?: number;
  level?: string;
}

const NETWORK_CODES = new Set([
  'ECONNREFUSED',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EHOSTDOWN',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EAI_NONAME',
  'EADDRNOTAVAIL',
  'ECONNRESET',
  'EPIPE',
]);

/** Our own deadline (see withDeadline) throws this so it classifies as a timeout. */
export class DeadlineError extends Error {
  readonly code = 'SMARTDD_DEADLINE';
  constructor(ms: number) {
    super(`${ms} ms 内未完成`);
  }
}

/**
 * Map a driver/socket error to a category. Order matters: socket-level codes first (they are
 * unambiguous), then protocol-specific codes, then message patterns as the last resort.
 */
export function classifyError(protocol: Protocol, error: unknown): { category: TestCategory; message: string } {
  const e = (typeof error === 'object' && error !== null ? error : { message: String(error) }) as DriverError;
  const message = e.message || String(error);
  const code = typeof e.code === 'string' ? e.code : undefined;
  // Keep the driver code visible: some servers send a vague text (e.g. "Unknown error 1045").
  const shown = code && code !== 'SMARTDD_DEADLINE' && !message.includes(code) ? `${message} [${code}]` : message;
  const category = (c: TestCategory) => ({ category: c, message: shown });

  if (code === 'SMARTDD_DEADLINE' || code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT') return category('timeout');
  if (code && NETWORK_CODES.has(code)) return category('network');

  if (protocol === 'mysql') {
    switch (code) {
      case 'ER_DBACCESS_DENIED_ERROR': // 1044
        // MySQL answers 1044, not 1049, when an account without rights names a missing database.
        return { category: 'auth', message: `${shown}（该账号无权访问此库，也可能库名填错：MySQL 对无权限账号不区分“库不存在”）` };
      case 'ER_ACCESS_DENIED_ERROR': // 1045 wrong user/password
      case 'ER_ACCESS_DENIED_NO_PASSWORD_ERROR':
        return category('auth');
      case 'ER_BAD_DB_ERROR': // 1049
        return category('database');
      case 'ER_NOT_SUPPORTED_AUTH_MODE':
      case 'AUTH_SWITCH_PLUGIN_ERROR':
        return category('unsupported_auth');
      case 'PROTOCOL_CONNECTION_LOST':
        return category('network');
    }
    if (/auth(entication)? plugin|not supported auth/i.test(message)) return category('unsupported_auth');
  }

  if (protocol === 'postgres') {
    switch (code) {
      case '28P01': // invalid_password
      case '28000': // invalid_authorization_specification (no pg_hba entry, role does not exist)
        return category('auth');
      case '3D000': // invalid_catalog_name: database does not exist
      case '3F000': // invalid_schema_name
        return category('database');
      case '57P03': // cannot_connect_now (starting up / shutting down)
        return category('network');
    }
    if (/client password must be a non-empty string/i.test(message)) return category('auth');
    // openGauss/GaussDB answer with auth codes vanilla `pg` does not know (sha256, sm3).
    if (/^SASL: Only mechanism|Unknown authenticationOk message type|authentication method.*not supported/i.test(message)) {
      return category('unsupported_auth');
    }
    if (/timeout expired|Connection terminated due to connection timeout/i.test(message)) return category('timeout');
  }

  if (protocol === 'ssh') {
    switch (e.level) {
      case 'client-authentication':
        return category('auth');
      case 'client-timeout':
        return category('timeout');
      case 'client-dns':
        return category('network');
      case 'client-socket':
        return category('network');
    }
    if (/Cannot parse privateKey|private key|passphrase/i.test(message)) return category('config');
    if (/Timed out while waiting for handshake/i.test(message)) return category('timeout');
  }

  return category('other');
}

/** Rejects with DeadlineError after `ms`, calling `onTimeout` so the caller can tear the socket down. */
export function withDeadline<T>(work: Promise<T>, ms: number, onTimeout: () => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout();
      reject(new DeadlineError(ms));
    }, ms);
    work.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}
