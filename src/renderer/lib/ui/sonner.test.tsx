// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { cleanup, render, waitFor, act } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { Toaster } from './sonner';

vi.mock('@renderer/lib/theme', () => ({ useTheme: () => ({ effectiveTheme: 'ylight' }) }));

afterEach(() => {
  toast.dismiss();
  cleanup();
  document.querySelector('[data-test-legacy-toast]')?.remove();
  vi.unstubAllGlobals();
});

it('keeps Sonner positioning independent from the legacy centered page toast', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  const style = document.createElement('style');
  style.dataset.testLegacyToast = '';
  const legacy = readFileSync('src/renderer/m6.css', 'utf8').match(/\.toast\s*\{[^}]+\}/)?.[0];
  expect(legacy).toContain('left: 50%');
  style.textContent = legacy!;
  document.head.append(style);
  render(<Toaster />);
  act(() => { toast.success('检测到 Codex，新建智能体时可以选择它'); });
  await waitFor(() => expect(document.querySelector('[data-sonner-toast]')).not.toBeNull());
  const notice = document.querySelector('[data-sonner-toast]')!;
  const computed = getComputedStyle(notice);
  expect(computed.position).toBe('absolute');
  expect(computed.left).not.toBe('50%');
});
