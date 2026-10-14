import { describe, expect, it } from 'vitest';
import { classifyError, DeadlineError, withDeadline } from './classify';
import { redact } from './redact';

const err = (props: Record<string, unknown>) => Object.assign(new Error(String(props.message ?? 'x')), props);

describe('classifyError', () => {
  it.each([
    ['mysql', err({ code: 'ECONNREFUSED' }), 'network'],
    ['postgres', err({ code: 'ENOTFOUND' }), 'network'],
    ['ssh', err({ code: 'EHOSTUNREACH' }), 'network'],
    ['mysql', err({ code: 'ETIMEDOUT' }), 'timeout'],
    ['postgres', new DeadlineError(100), 'timeout'],
    ['mysql', err({ code: 'ER_ACCESS_DENIED_ERROR' }), 'auth'],
    ['mysql', err({ code: 'ER_DBACCESS_DENIED_ERROR' }), 'auth'],
    ['mysql', err({ code: 'ER_BAD_DB_ERROR' }), 'database'],
    ['mysql', err({ code: 'AUTH_SWITCH_PLUGIN_ERROR' }), 'unsupported_auth'],
    ['postgres', err({ code: '28P01' }), 'auth'],
    ['postgres', err({ code: '28000' }), 'auth'],
    ['postgres', err({ code: '3D000' }), 'database'],
    ['postgres', err({ code: '3F000' }), 'database'],
    ['postgres', err({ message: 'SASL: Only mechanism SCRAM-SHA-256 is currently supported' }), 'unsupported_auth'],
    ['postgres', err({ message: 'Unknown authenticationOk message type 99' }), 'unsupported_auth'],
    ['postgres', err({ message: 'SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a non-empty string' }), 'auth'],
    ['postgres', err({ message: 'timeout expired' }), 'timeout'],
    ['ssh', err({ level: 'client-authentication', message: 'All configured authentication methods failed' }), 'auth'],
    ['ssh', err({ level: 'client-timeout' }), 'timeout'],
    ['ssh', err({ message: 'Cannot parse privateKey: Unsupported key format' }), 'config'],
    ['mysql', err({ code: 'SOMETHING_NEW' }), 'other'],
    ['postgres', 'plain string', 'other'],
  ] as const)('%s %o → %s', (protocol, error, expected) => {
    expect(classifyError(protocol, error).category).toBe(expected);
  });

  it('appends the driver code once, so a vague server text still says what happened', () => {
    expect(classifyError('mysql', err({ code: 'ER_ACCESS_DENIED_ERROR', message: 'Unknown error 1045' })).message).toBe(
      'Unknown error 1045 [ER_ACCESS_DENIED_ERROR]'
    );
    expect(classifyError('mysql', err({ code: 'ECONNREFUSED', message: 'connect ECONNREFUSED 127.0.0.1:1' })).message).toBe(
      'connect ECONNREFUSED 127.0.0.1:1'
    );
    expect(classifyError('mysql', new DeadlineError(300)).message).toBe('300 ms 内未完成');
    expect(classifyError('mysql', err({ code: 'ER_DBACCESS_DENIED_ERROR' })).message).toContain('也可能库名填错');
  });

  it('does not let a protocol-specific code leak into another protocol', () => {
    expect(classifyError('mysql', err({ code: '28P01' })).category).toBe('other');
  });
});

describe('withDeadline', () => {
  it('rejects with a timeout and calls the teardown', async () => {
    let torn = false;
    const never = new Promise<never>(() => {});
    await expect(withDeadline(never, 20, () => (torn = true))).rejects.toBeInstanceOf(DeadlineError);
    expect(torn).toBe(true);
  });

  it('passes through results and errors that arrive in time', async () => {
    await expect(withDeadline(Promise.resolve(1), 1000, () => {})).resolves.toBe(1);
    await expect(withDeadline(Promise.reject(new Error('boom')), 1000, () => {})).rejects.toThrow('boom');
  });
});

describe('redact', () => {
  it('masks known secrets, longest first', () => {
    expect(redact('pw is hunter2hunter2 and hunter2', ['hunter2', 'hunter2hunter2'])).toBe('pw is *** and ***');
  });

  it('ignores secrets too short to mask safely', () => {
    expect(redact('a b ab', ['ab', '', null, undefined])).toBe('a b ab');
  });

  it('masks well-known token shapes', () => {
    const out = redact(
      'github_pat_11ABCDEFG0123456789_abcdef ghp_abcdefghijklmnopqrstuvwxyz sk-abcdefghijklmnop1234 AKIAABCDEFGHIJKLMNOP xoxb-123-abc'
    );
    expect(out).toBe('*** *** *** *** ***');
  });

  it('masks URL passwords and key=value secrets but keeps MySQL wording', () => {
    expect(redact('postgres://ais:s3cr3t@db:5432/x')).toBe('postgres://ais:***@db:5432/x');
    expect(redact('password=abc token: "xyz"')).toBe('password=*** token: ***');
    expect(redact("Access denied for user 'ais'@'1.2.3.4' (using password: YES)")).toBe(
      "Access denied for user 'ais'@'1.2.3.4' (using password: YES)"
    );
  });
});
