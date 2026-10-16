import { VoiceSettingsSection, readableVoiceKey } from './settings/voice';
import { voiceStore } from '@renderer/core/voice-store';
import { ChevronDown, Info, Keyboard, Mic, Search, Settings, ShieldCheck, SquareTerminal, Sun, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { rpcErrorMessage } from '@shared/ipc/rpc';
import { useAiProfiles, useRefreshAiProfiles } from '@renderer/lib/hooks/useAiProfiles';
import { useQuery } from '@tanstack/react-query';
import { observer } from 'mobx-react-lite';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TERMINAL_FONT_SIZE, type Language, type Theme } from '@shared/app-settings';
import type { ProbeResult } from '@shared/types';
import { navigation, type SettingsSectionId } from '@renderer/core/navigation';
import { useAppSettingsKey } from '@renderer/lib/hooks/useAppSettingsKey';
import { rpc } from '@renderer/lib/ipc';
import { useTheme } from '@renderer/lib/theme';
import { Button } from '@renderer/lib/ui/button';
import { Input } from '@renderer/lib/ui/input';
import { SettingRow } from '@renderer/lib/ui/section-page';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@renderer/lib/ui/select';
import { AiProfilesSection } from './settings/ai-profiles';
import { CapabilitiesSection } from './capabilities';

const SECTIONS = [
  { id: 'general', Icon: Settings, group: 'personal' },
  { id: 'appearance', Icon: Sun, group: 'personal' },
  { id: 'aiProfiles', Icon: ShieldCheck, group: 'personal' },
  { id: 'terminal', Icon: SquareTerminal, group: 'personal' },
  { id: 'voice', Icon: Mic, group: 'personal' },
  { id: 'shortcuts', Icon: Keyboard, group: 'personal' },
  { id: 'capabilities', Icon: Zap, group: 'integrations' },
  { id: 'about', Icon: Info, group: 'application' },
] as const;

export const SettingsView = observer(function SettingsView() {
  const { t } = useTranslation();
  const section = navigation.settingsSection;
  const [search, setSearch] = useState('');
  const label = (id: SettingsSectionId) => t(id === 'about' || id === 'shortcuts' ? `m6.${id}` : `settings.sections.${id}`);
  return <div className="settings-shell">
    <nav className="settings-nav" aria-label={t('nav.settings')}>
      <h2>{t('nav.settings')}</h2>
      <label className="settings-search"><Search size={15} /><input aria-label={t('m6.searchSettings')} placeholder={t('m6.search')} value={search} onChange={(e) => setSearch(e.target.value)} /></label>
      {(['personal', 'integrations', 'application'] as const).map((group) => {
        const items = SECTIONS.filter((item) => item.group === group && label(item.id).toLowerCase().includes(search.toLowerCase()));
        return items.length > 0 && <div className="settings-nav-group" key={group}><h3>{t(`m6.${group}`)}</h3>{items.map(({ id, Icon }) => <button key={id} className={`nav-row ${section === id ? 'selected' : ''}`} aria-current={section === id ? 'page' : undefined} onClick={() => navigation.openSettings(id)}><Icon size={16} /><span>{label(id)}</span></button>)}</div>;
      })}
      {!SECTIONS.some((item) => label(item.id).toLowerCase().includes(search.toLowerCase())) && <p className="settings-search-empty">{t('m6.noSettings')}</p>}
    </nav>
    <div className="settings-content" key={section}><div className="settings-inner">{section !== 'aiProfiles' && <div className="page-heading"><h1>{label(section)}</h1></div>}
      {section === 'voice' && <VoiceSettingsSection />}
      {section === 'general' && <GeneralSection />}
      {section === 'aiProfiles' && <AiProfilesSection />}
      {section === 'capabilities' && <CapabilitiesSection />}
      {section === 'appearance' && <SettingsGroup title={label(section)}><AppearanceSection /></SettingsGroup>}
      {section === 'terminal' && <TerminalSection />}
      {section === 'shortcuts' && <ShortcutsSection />}
      {section === 'about' && <AboutSection />}
    </div></div>
  </div>;
});

function SettingsGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="settings-group"><h2>{title}</h2><div className="settings-card">{children}</div></section>;
}

const ShortcutsSection = observer(function ShortcutsSection() {
  const { t } = useTranslation();
  const key = voiceStore.inspection?.effectiveGlobalShortcut;
  return <SettingsGroup title={t('m6.shortcuts')}>{[['nav.newTask', '⌘ N'], ['nav.search', '⌘ K'], ['nav.toggleSidebar', '⌘ B'], ['nav.settings', '⌘ ,'], ['home.launchHint', '⌘ Enter']].map(([key, shortcut]) => <SettingRow key={key} label={t(key)}><kbd>{shortcut}</kbd></SettingRow>)}<SettingRow label={t('voice.global')} hint={t('voice.globalHint')}><button className="text-button" onClick={() => navigation.openSettings('voice')}>{key ? readableVoiceKey(key) : t('voice.notEffective')}<ChevronDown size={14} /></button></SettingRow></SettingsGroup>;
});

function AboutSection() {
  const { t } = useTranslation();
  const info = useQuery({ queryKey: ['app', 'info'], queryFn: () => rpc.app.getInfo(), staleTime: Infinity });
  return <SettingsGroup title="WillYou"><SettingRow label={t('m6.version')}><span data-testid="app-version">{info.data?.version ?? '…'}</span></SettingRow><SettingRow label={t('settings.dataDir')} hint={<span className="font-mono break-all select-text">{info.data?.userDataPath}</span>}><Button variant="outline" size="sm" onClick={() => void rpc.app.revealDataDir()}>{t('settings.reveal')}</Button></SettingRow></SettingsGroup>;
}

function GeneralSection() {
  const { t } = useTranslation();
  const general = useAppSettingsKey('general');
  const terminal = useAppSettingsKey('terminal');
  const { effectiveTheme } = useTheme();
  const { data: profiles = [] } = useAiProfiles();
  const refresh = useRefreshAiProfiles();
  const info = useQuery({ queryKey: ['app', 'info'], queryFn: () => rpc.app.getInfo(), staleTime: Infinity });
  const [probes, setProbes] = useState<ProbeResult[] | null>(null);
  const [probing, setProbing] = useState(false);

  return (
    <>
      <SettingsGroup title={t('settings.sections.aiProfiles')}><SettingRow label={t('m6.defaultAI')} hint={t('m6.defaultAIHint')}>
        <Select value={profiles.find((p) => p.isDefault)?.id ?? null} onValueChange={(id) => id && void rpc.aiProfiles.setDefault(String(id)).then(refresh).catch((e) => toast.error(rpcErrorMessage(e)))}><SelectTrigger className="w-40"><SelectValue placeholder={t('home.pickProfile')} /></SelectTrigger><SelectContent>{profiles.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent></Select>
      </SettingRow><SettingRow label={t('m6.localLogin')} hint={t('m6.localLoginHint')}><Button variant="outline" size="sm" onClick={() => navigation.openSettings('aiProfiles')}>{t('m6.manageProfiles')}</Button></SettingRow></SettingsGroup>
      <SettingsGroup title={t('settings.sections.general')}>
      <SettingRow label={t('settings.dataDir')} hint={t('m6.dataDirHint')}>
        <code className="setting-path" title={info.data?.userDataPath}>{info.data?.userDataPath ?? '…'}</code>
        <Button variant="outline" size="sm" onClick={() => void rpc.app.revealDataDir()}>{t('settings.reveal')}</Button>
      </SettingRow>
      <SettingRow label={t('settings.language')} hint={t('settings.languageHint')}>
        <Select
          value={general.value?.language ?? null}
          onValueChange={(v) => v && general.update({ language: v as Language })}
        >
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="zh-CN">简体中文</SelectItem>
            <SelectItem value="en">English</SelectItem>
          </SelectContent>
        </Select>
      </SettingRow>
      <SettingRow label={t('settings.probes')} hint={t('settings.probesHint')}>
        <Button
          variant="outline"
          size="sm"
          disabled={probing}
          onClick={() => {
            setProbing(true);
            void rpc.probes
              .run()
              .then(setProbes)
              .catch((e) => toast.error(rpcErrorMessage(e)))
              .finally(() => setProbing(false));
          }}
        >
          {t('settings.runProbes')}
        </Button>
      </SettingRow>
      <SettingRow label={t('settings.sections.appearance')} hint={t('settings.themeHint')}><Button variant="outline" size="sm" onClick={() => navigation.openSettings('appearance')}>{t(effectiveTheme === 'ydark' ? 'settings.themeDark' : 'settings.themeLight')}<ChevronDown size={14} /></Button></SettingRow>
      <SettingRow label={t('m6.terminalFont')} hint={t('m6.terminalFontHint')}><Button variant="outline" size="sm" onClick={() => navigation.openSettings('terminal')}>{terminal.value?.fontSize ?? 13}px<ChevronDown size={14} /></Button></SettingRow>
      <SettingRow label={t('m6.shortcuts')} hint={t('m6.shortcutsHint')}><Button variant="outline" size="sm" onClick={() => navigation.openSettings('shortcuts')}>{t('m6.view')}</Button></SettingRow>
      </SettingsGroup>
      {probes && (
        <div data-testid="probe-results" className="flex flex-col gap-1 font-mono text-xs">
          {probes.map((p) => (
            <div key={p.name} className={p.ok ? 'text-foreground-muted' : 'text-foreground-destructive'}>
              {p.ok ? '✔' : '✘'} {p.name}：{p.detail}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

const AppearanceSection = observer(function AppearanceSection() {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();
  return <>
    <SettingRow label={t('settings.theme')} hint={t('settings.themeHint')}><Select value={theme ?? 'system'} onValueChange={(value) => setTheme(value === 'system' ? null : value as Theme)}><SelectTrigger aria-label={t('settings.theme')}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="system">{t('settings.themeSystem')}</SelectItem><SelectItem value="ylight">{t('settings.themeLight')}</SelectItem><SelectItem value="ydark">{t('settings.themeDark')}</SelectItem></SelectContent></Select></SettingRow>
    <SettingRow label={t('m6.sidebarWidth')} hint={t('m6.sidebarWidthHint')}><input aria-label={t('m6.sidebarWidth')} type="range" min="240" max="420" value={navigation.sidebarWidth} onChange={(e) => navigation.setSidebarWidth(Number(e.target.value))} /><span className="value-label">{navigation.sidebarWidth}px</span></SettingRow>
  </>;
});

const FONT_SIZES = Array.from(
  { length: TERMINAL_FONT_SIZE.max - TERMINAL_FONT_SIZE.min + 1 },
  (_, i) => TERMINAL_FONT_SIZE.min + i
);

function TerminalSection() {
  const { t } = useTranslation();
  const terminal = useAppSettingsKey('terminal');
  const [fontFamily, setFontFamily] = useState('');
  useEffect(() => {
    if (terminal.value) setFontFamily(terminal.value.fontFamily);
  }, [terminal.value]);

  // Commit on blur/Enter, not per keystroke: a half-typed (or empty) value is not a setting.
  const commitFontFamily = () => {
    if (terminal.value && fontFamily.trim() !== terminal.value.fontFamily) terminal.update({ fontFamily });
  };

  return (
    <>
      <SettingsGroup title={t('m6.display')}>
      <SettingRow label={t('settings.fontFamily')} hint={t('settings.fontFamilyHint')}>
        <Input
          className="w-64 font-mono"
          aria-label={t('settings.fontFamily')}
          value={fontFamily}
          onChange={(e) => setFontFamily(e.target.value)}
          onBlur={commitFontFamily}
          onKeyDown={(e) => e.key === 'Enter' && commitFontFamily()}
        />
      </SettingRow>
      <SettingRow label={t('settings.fontSize')}>
        <Select
          value={terminal.value?.fontSize ?? null}
          onValueChange={(v) => v && terminal.update({ fontSize: v as number })}
        >
          <SelectTrigger className="w-24">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FONT_SIZES.map((size) => (
              <SelectItem key={size} value={size}>
                {String(size)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingRow>
      <SettingRow label={t('m6.terminalTheme')} hint={t('m6.terminalThemeHint')}><span>{t('m6.followAppearance')}</span></SettingRow>
      </SettingsGroup>
      <div>
        <Button
          variant="outline"
          size="sm"
          disabled={!terminal.overrides || Object.keys(terminal.overrides).length === 0}
          onClick={() => terminal.reset()}
        >
          {t('settings.reset')}
        </Button>
      </div>
      <div className="terminal-sample" style={{ fontSize: terminal.value?.fontSize ?? 13, fontFamily: terminal.value?.fontFamily }}><span className="term-green">✓</span> {t('m6.terminalSampleReady')}<br /><span className="term-muted">~/workspace</span><br /><br /><span className="term-blue">❯</span> {t('m6.terminalSampleNext')}</div>
    </>
  );
}
