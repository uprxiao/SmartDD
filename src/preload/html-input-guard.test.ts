// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { installHtmlInputGuard } from './html-input-guard';

it('stops file drops and file pastes before document handlers while retaining ordinary text paste', () => {
  const target = new EventTarget() as unknown as Window;
  installHtmlInputGuard(target);
  const page = vi.fn();
  for (const type of ['dragenter', 'dragover', 'drop', 'paste']) target.addEventListener(type, page, { capture: true });
  for (const type of ['dragenter', 'dragover', 'drop']) {
    const event = new Event(type, { cancelable: true }); target.dispatchEvent(event); expect(event.defaultPrevented).toBe(true);
  }
  const paste = (items: { kind: string }[]) => {
    const event = new Event('paste', { cancelable: true }); Object.defineProperty(event, 'clipboardData', { value: { files: [], items } }); target.dispatchEvent(event); return event;
  };
  expect(paste([{ kind: 'file' }]).defaultPrevented).toBe(true); expect(page).not.toHaveBeenCalled();
  expect(paste([{ kind: 'string' }]).defaultPrevented).toBe(false); expect(page).toHaveBeenCalledOnce();
});
