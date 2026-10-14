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
import { SectionPage, SettingRow } from '@renderer/lib/ui/section-page';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@renderer/lib/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@renderer/lib/ui/toggle-group';
import { AiProfilesSection } from './settings/ai-profiles';

const SECTIONS: SettingsSectionId[] = ['general', 'aiProfiles', 'appearance', 'terminal'];

export const SettingsView = observer(function SettingsView() {
  const { t } = useTranslation();
  const section = navigation.settingsSection;
  const items = SECTIONS.map((id) => ({
    id,
    label: t(`settings.sections.${id}`),
  }));

  return (
    <SectionPage
      items={items}
      activeId={section}
      onSelect={(id) => navigation.openSettings(id)}
      title={t(`settings.sections.${section}`)}
      description={t(`settings.descriptions.${section}`)}
    >
      {section === 'general' && <GeneralSection />}
      {section === 'aiProfiles' && <AiProfilesSection />}
      {section === 'appearance' && <AppearanceSection />}
      {section === 'terminal' && <TerminalSection />}
    </SectionPage>
  );
});

function GeneralSection() {
  const { t } = useTranslation();
  const general = useAppSettingsKey('general');
  const info = useQuery({ queryKey: ['app', 'info'], queryFn: () => rpc.app.getInfo(), staleTime: Infinity });
  const [probes, setProbes] = useState<ProbeResult[] | null>(null);
  const [probing, setProbing] = useState(false);

  return (
    <>
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
      <SettingRow
        label={t('settings.dataDir')}
        hint={<span className="font-mono break-all select-text">{info.data?.userDataPath ?? '…'}</span>}
      >
        <Button variant="outline" size="sm" onClick={() => void rpc.app.revealDataDir()}>
          {t('settings.reveal')}
        </Button>
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
              .finally(() => setProbing(false));
          }}
        >
          {t('settings.runProbes')}
        </Button>
      </SettingRow>
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

const THEME_OPTIONS = ['system', 'ylight', 'ydark'] as const;

function AppearanceSection() {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();
  const current = theme === undefined ? undefined : (theme ?? 'system');
  const labels = { system: t('settings.themeSystem'), ylight: t('settings.themeLight'), ydark: t('settings.themeDark') };

  return (
    <SettingRow label={t('settings.theme')} hint={t('settings.themeHint')}>
      <ToggleGroup
        value={current ? [current] : []}
        onValueChange={(values) => {
          const next = values[0] as (typeof THEME_OPTIONS)[number] | undefined;
          if (next) setTheme(next === 'system' ? null : (next as Theme));
        }}
      >
        {THEME_OPTIONS.map((id) => (
          <ToggleGroupItem key={id} value={id}>
            {labels[id]}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </SettingRow>
  );
}

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
      <SettingRow label={t('settings.fontFamily')} hint={t('settings.fontFamilyHint')}>
        <Input
          className="w-64 font-mono"
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
    </>
  );
}
