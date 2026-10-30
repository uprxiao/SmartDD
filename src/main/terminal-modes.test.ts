import { describe, expect, it } from 'vitest';
import { TerminalModes } from './terminal-modes';

describe('native output paste mode uses the production xterm parser', () => {
  it('handles split CSI, multiple parameters, disable and reset', async () => {
    const modes = new TerminalModes();
    try {
      expect(await modes.bracketedPaste()).toBe(false);
      for (const char of '\x1b[?25;2004h') modes.feed(char);
      expect(await modes.bracketedPaste()).toBe(true);
      modes.feed('\x1b[?2004l'); expect(await modes.bracketedPaste()).toBe(false);
      modes.feed('\x1b[?2004h\x1bc'); expect(await modes.bracketedPaste()).toBe(false);
      modes.feed('\x1b[?2004h\x1b[!p'); expect(await modes.bracketedPaste()).toBe(false);
    } finally { modes.dispose(); }
  });
  it('does not interpret printable OSC/DCS lookalikes; actual ESC terminates them exactly as xterm does', async () => {
    const modes = new TerminalModes();
    try {
      modes.feed('\x1b]0;[?2004h\x07\x1bP0q[?2004h\x1b\\');
      expect(await modes.bracketedPaste()).toBe(false);
      modes.feed('\x1b]0;title\x1b[?2004h'); expect(await modes.bracketedPaste()).toBe(true);
      modes.feed('\x1bP0qignored\x1b[?2004l'); expect(await modes.bracketedPaste()).toBe(false);
      modes.feed('\x1b[?2004\x18h'); expect(await modes.bracketedPaste()).toBe(false);
    } finally { modes.dispose(); }
  });
  it('does not retain screen history or hang a pending flush after disposal', async () => {
    const modes = new TerminalModes(); modes.feed('x'.repeat(100_000)); const pending = modes.bracketedPaste(); modes.dispose();
    await expect(pending).rejects.toThrow('不可用');
    await expect(modes.bracketedPaste()).rejects.toThrow('不可用');
  });
});
