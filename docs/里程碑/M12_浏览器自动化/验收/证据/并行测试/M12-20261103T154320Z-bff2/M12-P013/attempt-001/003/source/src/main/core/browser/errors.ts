import { ApplicationError } from '@shared/applications';

export type BrowserErrorCode = 'BROWSER_NO_TAB' | 'BROWSER_UNAVAILABLE' | 'BROWSER_STALE_REF' | 'BROWSER_PAUSED' |
  'BROWSER_TIMEOUT' | 'BROWSER_TAB_NOT_FOUND' | 'BROWSER_TAB_CLOSED' | 'BROWSER_TAB_CHANGED' |
  'BROWSER_EVAL_ERROR' | 'BROWSER_ERROR';

export class BrowserError extends ApplicationError {
  constructor(code: BrowserErrorCode, message: string) { super(code, message); }
}

export function staleReference(): BrowserError {
  return new BrowserError('BROWSER_STALE_REF', '页面引用已经失效，请重新 snapshot');
}

export function helperError(message: string): BrowserError {
  if (/timed out|timeout/i.test(message)) return new BrowserError('BROWSER_TIMEOUT', message.slice(0,2048));
  return /unknown ref|ref not found|element not found|could not locate element|no element matches/i.test(message)
    ? staleReference()
    : new BrowserError('BROWSER_ERROR', message.slice(0, 2048));
}
