import { AlertCircle, LoaderCircle, Mic, Settings, X } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { voiceStore } from '@renderer/core/voice-store';
import { navigation } from '@renderer/core/navigation';
import { rpc } from '@renderer/lib/ipc';

export const VoiceButton = observer(function VoiceButton({ onClick, disabled = false, disabledHint, compact = false, label }: { onClick(): void; disabled?: boolean; disabledHint?: string; compact?: boolean; label?: string }) {
  const { t } = useTranslation();
  const unavailable = disabled || voiceStore.inspection?.settings.enabled === false || voiceStore.inspection?.supported === false;
  const hint = disabled ? disabledHint || t('voice.errors.TASK_STOPPED') : voiceStore.inspection?.supported === false ? t('voice.errors.UNSUPPORTED_PLATFORM') : voiceStore.inspection?.settings.enabled === false ? t('voice.errors.DISABLED') : label || t('voice.use');
  return <button type="button" data-testid="voice-trigger" className={`voice-button ${compact ? 'voice-compact' : ''} ${voiceStore.busy ? 'voice-busy' : ''}`} aria-label={label || t('voice.use')} title={hint} aria-busy={voiceStore.busy} disabled={unavailable || voiceStore.busy} onPointerDown={e => e.preventDefault()} onClick={onClick}>{voiceStore.busy ? <LoaderCircle size={17} className="animate-spin" /> : <Mic size={17} strokeWidth={1.65} />}{!compact && <span>{t('voice.title')}</span>}</button>;
});

export const VoiceFeedback = observer(function VoiceFeedback() {
  const { t } = useTranslation();
  const [openingSettings, setOpeningSettings] = useState(false);
  const [settingsOpenFailed, setSettingsOpenFailed] = useState(false);
  useEffect(() => voiceStore.connect(), []);
  const n = voiceStore.notice;
  useEffect(() => { setSettingsOpenFailed(false); }, [n]);
  // Keep normal dictation unobstructed; the microphone itself shows dispatch progress.
  if (n?.kind !== 'error') return null;
  const needsAccessibility = n.error === 'ACCESSIBILITY_REQUIRED';
  const focusIssue = n.error === 'TARGET_CHANGED' || n.error === 'INPUT_FOCUS_UNAVAILABLE' || n.error === 'SECURE_INPUT';
  const openSettings = async () => {
    if (!needsAccessibility) { voiceStore.clear(); navigation.openSettings('voice'); return; }
    setOpeningSettings(true);
    setSettingsOpenFailed(false);
    try {
      await rpc.voice.openSetupGuide('permission');
      if (voiceStore.notice === n) voiceStore.clear();
    } catch {
      if (voiceStore.notice === n) setSettingsOpenFailed(true);
    } finally { setOpeningSettings(false); }
  };
  return <aside className="voice-feedback voice-feedback-error" aria-label={t('voice.feedback')}>
    <div className="voice-feedback-title"><AlertCircle size={17} /><strong role="alert">{t(`voice.errors.${n.error}`)}</strong><button type="button" className="icon-button" aria-label={t('voice.close')} onClick={voiceStore.clear}><X size={15} /></button></div>
    <p>{t(needsAccessibility ? 'voice.permissionErrorHint' : focusIssue ? 'voice.focusErrorHint' : 'voice.errorHint')}</p>
    {settingsOpenFailed && <p role="alert">{t('voice.openAccessibilityFailed')}</p>}
    {!focusIssue && <div className="voice-feedback-actions"><button type="button" className="text-button" disabled={openingSettings} onClick={() => void openSettings()}><Settings size={13} />{t(openingSettings ? 'voice.openingSettings' : needsAccessibility ? 'voice.openAccessibility' : 'voice.settings')}</button></div>}
  </aside>;
});
