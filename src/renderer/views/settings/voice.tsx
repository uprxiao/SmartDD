import { AlertCircle, ChevronRight, RefreshCw } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { APP_SETTINGS_DEFAULTS } from '@shared/app-settings';
import type { VoiceSettings } from '@shared/voice';
import { rpcErrorMessage } from '@shared/ipc/rpc';
import { voiceStore, textareaVoiceTarget } from '@renderer/core/voice-store';
import { rpc } from '@renderer/lib/ipc';
import { useVoiceShortcutRecorder } from '@renderer/lib/hooks/useVoiceShortcutRecorder';
import { SettingRow } from '@renderer/lib/ui/section-page';
import { Dialog, DialogContent, DialogContentArea, DialogFooter, DialogHeader, DialogTitle } from '@renderer/lib/ui/dialog';
import { VoiceButton } from '../voice-controls';

export function readableVoiceKey(value: string) { return value.replace(/Command/g, '⌘').replace(/Control/g, '⌃').replace(/Alt|Option/g, '⌥').replace(/Shift/g, '⇧').replace(/Right⌥/g, '右 Option').replaceAll('+', ' '); }
function Toggle({ value, label, onChange, disabled }: { value: boolean; label: string; onChange(value: boolean): void; disabled?: boolean }) {
  return <button type="button" className={`toggle ${value ? 'checked' : ''}`} role="switch" aria-checked={value} aria-label={label} disabled={disabled} onClick={() => onChange(!value)}><span /></button>;
}

export const VoiceSettingsSection = observer(function VoiceSettingsSection() {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<VoiceSettings | null>(voiceStore.inspection?.settings ?? null);
  const [error, setError] = useState(''), [saving, setSaving] = useState(false), [help, setHelp] = useState<'install' | 'permission' | null>(null);
  const sampleRef = useRef<HTMLTextAreaElement>(null);
  const recorder = useVoiceShortcutRecorder(globalShortcut => {
    setDraft(value => value ? { ...value, globalShortcut } : value); setError('');
  });
  const status = voiceStore.inspection;
  useEffect(() => { if (!draft && status) setDraft(status.settings); }, [status, draft]);
  useEffect(() => { void voiceStore.inspect(); }, []);
  if (!draft) return <p role="status">{t('voice.detecting')}</p>;
  const saved = status?.settings ?? APP_SETTINGS_DEFAULTS.voice;
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const update = (patch: Partial<VoiceSettings>) => { setDraft({ ...draft, ...patch }); setError(''); };
  const save = async () => {
    setSaving(true); setError('');
    try { const value = await rpc.voice.updateSettings(draft); await voiceStore.inspect(); setDraft(value); }
    catch (e) { const code = rpcErrorMessage(e); setError(t(`voice.errors.${code}`, { defaultValue: t('voice.saveFailed') })); }
    finally { setSaving(false); }
  };
  const detected = status?.supported === false ? t('voice.errors.UNSUPPORTED_PLATFORM') : status?.installed ? t(status.running ? 'voice.running' : 'voice.installed') : t('voice.notInstalled');
  return <div className="voice-settings">
    <p className="voice-intro">{t('voice.intro')}</p>
    <section className="settings-group"><h2>{t('voice.provider')}</h2><div className="settings-card">
      <SettingRow label="Typeless" hint={t('voice.providerHint')}><span className={`voice-detection ${status?.installed ? 'available' : ''}`}>{voiceStore.inspecting ? t('voice.detecting') : detected}</span><button type="button" className="text-button" disabled={voiceStore.inspecting} onClick={() => void voiceStore.inspect()}><RefreshCw size={13} />{t('voice.recheck')}</button></SettingRow>
      <SettingRow label={t('voice.enable')} hint={t('voice.enableHint')}><Toggle value={draft.enabled} label={t('voice.enable')} onChange={enabled => update({ enabled })} disabled={saving} /></SettingRow>
      <SettingRow label={t('voice.dictationKey')} hint={draft.shortcutOverride ? t('voice.manual') : t('voice.autoHint')}><kbd className="voice-key">{draft.shortcutOverride ? readableVoiceKey(draft.shortcutOverride) : status?.shortcut && status.source === 'auto' ? readableVoiceKey(status.shortcut) : t('voice.unconfirmed')}</kbd></SettingRow>
      <SettingRow label={t('voice.preparation')} hint={status?.installed ? t(status.accessibility ? 'voice.preparationHint' : 'voice.permissionNeededHint') : t('voice.installHint')}><button type="button" className="button small secondary" onClick={() => setHelp(status?.installed ? 'permission' : 'install')}>{t(status?.installed ? 'voice.permissionGuide' : 'voice.installGuide')}<ChevronRight size={13} /></button></SettingRow>
    </div></section>
    <section className="settings-group"><h2>{t('voice.shortcuts')}</h2><div className="settings-card">
      <SettingRow label={t('voice.global')} hint={t('voice.globalHint')}><Toggle value={draft.globalEnabled} label={t('voice.globalEnable')} onChange={globalEnabled => update({ globalEnabled })} disabled={saving || status?.supported === false} /></SettingRow>
      <SettingRow label={t('voice.globalKey')} hint={t(draft.globalEnabled ? 'voice.globalKeyHint' : 'voice.globalKeyDisabledHint')}><div className="voice-key-editor"><input data-voice-shortcut-recording={recorder.busy} ref={recorder.inputRef} aria-label={t('voice.globalKey')} aria-describedby="voice-record-hint" disabled={!draft.globalEnabled || saving} value={recorder.busy ? recorder.candidate || t(recorder.phase === 'preparing' ? 'voice.recordPreparing' : 'voice.pressKey') : draft.globalShortcut} readOnly={recorder.busy} onBlur={recorder.cancel} onChange={e => update({ globalShortcut: e.target.value })} onKeyDown={recorder.onKeyDown} /><button type="button" className="button small secondary" disabled={!draft.globalEnabled || saving || recorder.phase === 'stopping'} onPointerDown={e => e.preventDefault()} onClick={() => recorder.busy ? recorder.cancel() : void recorder.start()}>{t(recorder.busy ? 'voice.cancel' : 'voice.recordKey')}</button></div></SettingRow>
    </div><p className="voice-caption" id="voice-record-hint" role="status">{t(recorder.message || (recorder.busy ? 'voice.recordHint' : 'voice.globalCaption'))}{!recorder.busy && status?.effectiveGlobalShortcut && <> · {t('voice.effective')}: {readableVoiceKey(status.effectiveGlobalShortcut)}</>}{!recorder.busy && status?.registrationError && <> · {t('voice.notEffective')}: {t(`voice.errors.${status.registrationError}`)}</>}</p></section>
    <details className="voice-advanced"><summary>{t('voice.advanced')}<ChevronRight size={14} /></summary><label className="field">{t('voice.override')}<input aria-label={t('voice.override')} disabled={saving} value={draft.shortcutOverride ?? ''} onChange={e => update({ shortcutOverride: e.target.value || null })} placeholder={t('voice.overridePlaceholder')} /></label><p className="voice-caption">{t('voice.overrideHint')}</p>{!status?.shortcut && status?.candidates.length ? <p className="voice-caption">{t('voice.candidates')}: {status.candidates.map(c => `${c.source}: ${c.shortcut}`).join(' · ')}</p> : null}<button type="button" className="text-button" disabled={saving} onClick={() => update({ shortcutOverride: null })}>{t('voice.restoreAuto')}</button></details>
    {!error && status?.lastError && <div className="voice-form-error" role="status"><AlertCircle size={16} />{t('voice.lastError')}{t(`voice.errors.${status.lastError}`)}</div>}
    {error && <div className="voice-form-error" role="alert"><AlertCircle size={16} />{error}</div>}
    <div className="voice-save"><span aria-live="polite">{t(dirty ? 'voice.unsaved' : 'voice.saved')}</span><button type="button" className="button secondary" disabled={!dirty || saving || recorder.busy} onClick={() => { setDraft(saved); setError(''); }}>{t('voice.revert')}</button><button type="button" className="button primary" disabled={!dirty || recorder.busy || saving} onClick={() => void save()}>{t(saving ? 'voice.saving' : 'voice.save')}</button></div>
    <section className="settings-group voice-try"><h2>{t('voice.try')}</h2><div className="settings-card"><p>{t('voice.tryHint')}</p><div className="voice-test-input"><textarea ref={sampleRef} aria-label={t('voice.sample')} placeholder={t('voice.samplePlaceholder')} /><VoiceButton compact label={t('voice.tryUse')} disabled={dirty || saving || recorder.busy} disabledHint={t('voice.saveBeforeTry')} onClick={() => void voiceStore.trigger(textareaVoiceTarget(sampleRef.current), 'settings')} /></div><small>{t(dirty ? 'voice.saveBeforeTry' : 'voice.sampleHint')}</small></div></section>
    <p className="voice-caption">{t('voice.privacy')}</p>
    <Dialog open={help !== null} onOpenChange={open => !open && setHelp(null)}><DialogContent className="parity-dialog"><DialogHeader><DialogTitle>{t(help === 'install' ? 'voice.installGuide' : 'voice.permissionGuide')}</DialogTitle></DialogHeader><DialogContentArea><p className="voice-caption">{t(help === 'install' ? 'voice.installGuideText' : 'voice.permissionGuideText')}</p><p className="voice-caption">{t('voice.guideReturn')}</p></DialogContentArea><DialogFooter><button type="button" className="button secondary" onClick={() => setHelp(null)}>{t('voice.close')}</button><button type="button" className="button primary" onClick={() => { if (help) void rpc.voice.openSetupGuide(help).catch(() => setError(t('voice.openFailed'))); }}>{t(help === 'install' ? 'voice.openWebsite' : 'voice.openSystemSettings')}</button></DialogFooter></DialogContent></Dialog>
  </div>;
});
