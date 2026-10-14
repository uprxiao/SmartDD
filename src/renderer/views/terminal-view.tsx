import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { reaction } from 'mobx';
import { observer } from 'mobx-react-lite';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ptyDataEvent, ptyExitEvent, ptyInputEvent, ptyResizeEvent } from '@shared/events';
import { sessionsStore } from '@renderer/core/sessions-store';
import { useAppSettingsKey } from '@renderer/lib/hooks/useAppSettingsKey';
import i18n from '@renderer/lib/i18n';
import { events } from '@renderer/lib/ipc';
import { useTheme } from '@renderer/lib/theme';
import { cssVar } from '@renderer/utils/cssVars';

function xtermTheme() {
  return {
    background: cssVar('--xterm-bg'),
    foreground: cssVar('--xterm-fg'),
    cursor: cssVar('--xterm-cursor'),
    cursorAccent: cssVar('--xterm-cursor-accent'),
    selectionBackground: cssVar('--xterm-selection-bg'),
    selectionForeground: cssVar('--xterm-selection-fg'),
  };
}

/**
 * Stays mounted (hidden) while other views show, so the scrollback survives navigation.
 */
export const TerminalView = observer(function TerminalView() {
  const { t } = useTranslation();
  const { effectiveTheme } = useTheme();
  const { value: terminalSettings } = useAppSettingsKey('terminal');
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  const fitAndSync = () => {
    const term = termRef.current;
    const host = hostRef.current;
    // Hidden (display:none) hosts measure 0×0; fitting then would shrink the PTY to nothing.
    if (!term || !host || host.clientWidth === 0 || host.clientHeight === 0) return;
    fitRef.current?.fit();
    const ptyId = sessionsStore.activePtyId;
    if (ptyId) events.emit(ptyResizeEvent, { ptyId, cols: term.cols, rows: term.rows });
  };

  useEffect(() => {
    const term = new Terminal({ cursorBlink: true, theme: xtermTheme() });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(hostRef.current!);
    termRef.current = term;
    fitRef.current = fit;

    const offInput = term.onData((data) => {
      const ptyId = sessionsStore.activePtyId;
      if (ptyId) events.emit(ptyInputEvent, { ptyId, data });
    });
    const offData = events.on(ptyDataEvent, ({ ptyId, data }) => {
      if (ptyId === sessionsStore.activePtyId) term.write(data);
    });
    const offExit = events.on(ptyExitEvent, ({ ptyId, code }) => {
      if (ptyId === sessionsStore.activePtyId) term.write(`\r\n[${i18n.t('session.exited', { code })}]\r\n`);
    });
    const offActive = reaction(
      () => sessionsStore.activePtyId,
      () => {
        term.reset();
        fitAndSync();
        term.focus();
      }
    );
    const observer = new ResizeObserver(() => fitAndSync());
    observer.observe(hostRef.current!);

    return () => {
      observer.disconnect();
      offActive();
      offExit();
      offData();
      offInput.dispose();
      term.dispose();
      termRef.current = null;
    };
  }, []);

  // ThemeProvider swaps the <html> class in a layout effect, so the CSS vars are current here.
  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = xtermTheme();
  }, [effectiveTheme]);

  useEffect(() => {
    const term = termRef.current;
    if (!term || !terminalSettings) return;
    term.options.fontFamily = terminalSettings.fontFamily;
    term.options.fontSize = terminalSettings.fontSize;
    fitAndSync();
  }, [terminalSettings]);

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-(--xterm-bg)">
      <div ref={hostRef} className="min-h-0 flex-1 p-2" />
      {!sessionsStore.activePtyId && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-foreground-muted">
          {t('session.noTerminal')}
        </div>
      )}
    </div>
  );
});
