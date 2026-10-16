import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { recordVoiceShortcut } from '@shared/voice-shortcut';
import { rpc } from '@renderer/lib/ipc';

/** Release our registered shortcut before focusing the recorder; restore it on every exit. */
export function useVoiceShortcutRecorder(onRecorded: (key: string) => void) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<'idle' | 'preparing' | 'recording' | 'stopping'>('idle');
  const [candidate, setCandidate] = useState('');
  const [message, setMessage] = useState('');
  const state = useRef({ active: false, revision: 0, key: '', mounted: true });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onRecordedRef = useRef(onRecorded);
  onRecordedRef.current = onRecorded;

  const stop = useCallback(async (accept = false, reason = '') => {
    const current = state.current;
    if (!current.active) return;
    current.active = false;
    const revision = ++current.revision;
    const key = accept ? current.key : '';
    current.key = '';
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (current.mounted) setPhase('stopping');
    try {
      await rpc.voice.setShortcutRecording(false);
      if (current.mounted && current.revision === revision && key) onRecordedRef.current(key);
    } catch { reason = 'voice.recordFailed'; }
    finally {
      if (current.mounted && current.revision === revision) {
        setPhase('idle'); setCandidate(''); setMessage(reason);
      }
    }
  }, []);

  const start = useCallback(async () => {
    const current = state.current;
    if (current.active) return;
    current.active = true; current.key = '';
    const revision = ++current.revision;
    setPhase('preparing'); setCandidate(''); setMessage('');
    timer.current = setTimeout(() => void stop(false, 'voice.recordTimedOut'), 60_000);
    try {
      await rpc.voice.setShortcutRecording(true);
      if (current.mounted && current.active && current.revision === revision) setPhase('recording');
    } catch { await stop(false, 'voice.recordFailed'); }
  }, [stop]);

  useLayoutEffect(() => { if (phase === 'recording') inputRef.current?.focus(); }, [phase]);
  useEffect(() => {
    state.current.mounted = true;
    const onBlur = () => void stop();
    window.addEventListener('blur', onBlur);
    return () => {
      state.current.mounted = false;
      window.removeEventListener('blur', onBlur);
      void stop();
    };
  }, [stop]);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (phase !== 'recording') return;
    event.preventDefault(); event.stopPropagation();
    const result = recordVoiceShortcut(event);
    if (result.kind === 'cancel') { void stop(); return; }
    if (result.kind === 'ignore') return;
    if (result.kind === 'invalid') {
      state.current.key = ''; setCandidate(''); setMessage('voice.recordInvalid'); return;
    }
    state.current.key = result.value;
    setCandidate(result.value);
    // Modifier key-up events vary by OS/input method. The main process waits for
    // physical release before re-arming; completing the UI must not depend on them.
    void stop(true);
  };
  return { inputRef, phase, busy: phase !== 'idle', candidate, message, start, cancel: () => void stop(), onKeyDown };
}
