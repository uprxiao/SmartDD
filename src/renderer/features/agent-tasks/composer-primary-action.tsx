import type { MouseEventHandler } from 'react';
import { CornerUpRight, ListPlus, Play } from 'lucide-react';
import './composer-primary-action.css';

// Arrow and stop glyphs from T3 Code's ComposerPrimaryActions (MIT, see NOTICE).
export function ComposerSendIcon() {
  return <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
    <path d="M7 11.5V2.5M7 2.5L3 6.5M7 2.5L11 6.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}

export function ComposerStopIcon() {
  return <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
    <rect x="2" y="2" width="8" height="8" rx="1.5" />
  </svg>;
}

export function QueuedSendIcon({ steer }: { steer: boolean }) {
  return steer ? <CornerUpRight size={14} aria-hidden="true" /> : <ComposerSendIcon />;
}

export function ComposerPrimaryAction({ action, label, disabled, escapeEnabled, onClick }: {
  action: 'send' | 'queue' | 'stop' | 'resume';
  label: string;
  disabled: boolean;
  escapeEnabled?: boolean;
  onClick?: MouseEventHandler<HTMLButtonElement>;
}) {
  const submits = action === 'send' || action === 'queue';
  return <button type={submits ? 'submit' : 'button'} className="agent-send agent-composer-primary"
    data-action={action} disabled={disabled} aria-label={label}
    aria-keyshortcuts={escapeEnabled ? 'Escape' : undefined}
    title={escapeEnabled ? label + '（Esc）' : label} onClick={onClick}>
    {action === 'stop' ? <><ComposerStopIcon />{escapeEnabled && <span className="agent-composer-escape" aria-hidden="true">Esc</span>}</>
      : action === 'resume' ? <Play size={14} fill="currentColor" aria-hidden="true" />
      : action === 'queue' ? <ListPlus size={16} aria-hidden="true" />
      : <ComposerSendIcon />}
  </button>;
}
