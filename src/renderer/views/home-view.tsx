// Composer layout follows Yoda (Apache-2.0) src/renderer/features/tasks/home-composer.
import { ArrowUp, CircleAlert, ClipboardCheck, Compass, Folder, FolderTree, Hammer, Info, Loader2, Monitor, Plus, Settings, ShieldCheck, Wrench, Zap } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { rpcErrorMessage } from '@shared/ipc/rpc';
import { navigation } from '@renderer/core/navigation';
import { tasksStore } from '@renderer/core/tasks-store';
import { useAiProfiles } from '@renderer/lib/hooks/useAiProfiles';
import { ProfileHealthMark } from '@renderer/lib/profile-health';
import { useAppSettingsKey } from '@renderer/lib/hooks/useAppSettingsKey';
import { useProject, useProjectList } from '@renderer/lib/hooks/useProjects';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@renderer/lib/ui/select';
import { Button } from '@renderer/lib/ui/button';
import { Dialog, DialogContent, DialogContentArea, DialogFooter, DialogHeader, DialogTitle } from '@renderer/lib/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@renderer/lib/ui/menu';
import { Field } from './projects/form-parts';
import { ProjectDialog } from './projects/project-dialogs';
import { cn } from '@renderer/utils/utils';
import { CapabilityLaunchPreview } from './capabilities';
import appIcon from '../../assets/branding/app-icon.png';

const CHIP = 'm6-composer-select';

export const HomeView = observer(function HomeView() {
  const { t } = useTranslation();
  const { data: projects } = useProjectList(false);
  const { data: profiles } = useAiProfiles();
  const draft = useAppSettingsKey('homeDraft');
  const [message, setMessage] = useState('');
  const [launchSettings, setLaunchSettings] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [dirId, setDirId] = useState<string | null>(null);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [launching, setLaunching] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { data: project } = useProject(projectId);

  // Defaults: the last choice if it still exists, else the default profile (PRD F05).
  const initialized = useRef(false);
  useEffect(() => {
    if (initialized.current || !projects || !profiles || !draft.value) return;
    initialized.current = true;
    const d = draft.value;
    if (navigation.homePreset && projects.some((p) => p.id === navigation.homePreset?.projectId)) {
      setProjectId(navigation.homePreset.projectId);
    } else if (d.projectId && projects.some((p) => p.id === d.projectId)) {
      setProjectId(d.projectId);
      setDirId(d.dirId);
    } else if (projects.length === 1) setProjectId(projects[0].id);
    setProfileId(
      d.aiProfileId && profiles.some((p) => p.id === d.aiProfileId)
        ? d.aiProfileId
        : (profiles.find((p) => p.isDefault)?.id ?? null)
    );
  }, [projects, profiles, draft.value]);

  // "New task" under a project selects it.
  const preset = navigation.homePreset;
  const appliedPreset = useRef<number | null>(null);
  useEffect(() => {
    if (!preset || appliedPreset.current === preset.seq || !projects?.some((p) => p.id === preset.projectId)) return;
    appliedPreset.current = preset.seq;
    setProjectId(preset.projectId);
    setDirId(null);
    inputRef.current?.focus();
  }, [preset?.seq, projects]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (navigation.currentViewId === 'home') inputRef.current?.focus();
  }, [navigation.currentViewId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (initialized.current) navigation.selectHomeProject(projectId);
  }, [projectId]);

  // A stale or missing directory falls back to the project's default one.
  const dirs = project?.id === projectId ? (project?.dirs ?? []) : [];
  const dir = dirs.find((d) => d.id === dirId) ?? dirs.find((d) => d.isDefault) ?? dirs[0] ?? null;
  const profile = profiles?.find((p) => p.id === profileId) ?? null;
  const dirProblem = project && project.id === projectId && (!dir ? t('home.noDir') : !dir.status.available ? t('home.dirUnavailable', { path: dir.path }) : '');
  const ready = Boolean(projectId && profile && dir && dir.status.available) && !launching;

  const launch = async () => {
    if (!ready || !projectId || !profile || !dir) return;
    setError('');
    setLaunching(true);
    try {
      await tasksStore.create({ projectId, dirId: dir.id, aiProfileId: profile.id, firstMessage: message });
      draft.update({ projectId, dirId: dir.id, aiProfileId: profile.id });
      setMessage('');
    } catch (e) {
      setError(rpcErrorMessage(e));
    } finally {
      setLaunching(false);
    }
  };

  const suggestions = [
    { Icon: Compass, key: 'explore' },
    { Icon: Hammer, key: 'build' },
    { Icon: ClipboardCheck, key: 'review' },
    { Icon: Wrench, key: 'fix' },
  ] as const;

  const projectPicker = <Select value={projectId} onValueChange={(v) => { setProjectId(v as string | null); setDirId(null); if (v) navigation.newTask(String(v)); }}>
    <SelectTrigger className={CHIP} data-testid="home-project" aria-label={t('home.pickProject')}><Folder size={15} /><SelectValue placeholder={t('home.pickProject')} /></SelectTrigger>
    <SelectContent>{(projects ?? []).map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
  </Select>;
  const profilePicker = <Select value={profileId} onValueChange={(v) => setProfileId(v as string | null)}>
    <SelectTrigger className={CHIP} data-testid="home-profile" aria-label={t('home.pickProfile')}><Zap size={15} fill="currentColor" /><SelectValue placeholder={t('home.pickProfile')} /></SelectTrigger>
    <SelectContent>{(profiles ?? []).map((p) => <SelectItem key={p.id} value={p.id}>{p.name}<ProfileHealthMark profile={p} /></SelectItem>)}</SelectContent>
  </Select>;
  const directoryPicker = <Select value={dir?.id ?? null} onValueChange={(v) => setDirId(v as string | null)}>
    <SelectTrigger className={CHIP} data-testid="home-dir" aria-label={t('m6.directory')} title={dir?.path}><FolderTree size={15} /><SelectValue placeholder={t('home.noDir')} /></SelectTrigger>
    <SelectContent>{dirs.map((d) => <SelectItem key={d.id} value={d.id}>{d.label || d.path}</SelectItem>)}</SelectContent>
  </Select>;

  return <section className="reference-home" aria-label={t('nav.newTask')}>
    <div className="reference-welcome"><img src={appIcon} alt="SmartDD" draggable={false} /><h1>{t('m6.welcomePrefix')} <button onClick={() => setLaunchSettings(true)}>{project?.name || 'SmartDD'}</button> {t('m6.welcomeSuffix')}</h1></div>
    <div className="reference-composer-wrap">
      {(dirProblem || error || !projectId || !profile) && <div className="launch-hint" role="status"><span>{error || dirProblem || (!projectId ? t(projects?.length ? 'home.pickProject' : 'home.noProjects') : t('home.noProfiles'))}</span><button onClick={() => setLaunchSettings(true)}>{t('m6.taskSettings')}</button></div>}
      {error && <span data-testid="home-error" className="sr-only">{error}</span>}
      <div className="reference-composer-context"><div className="reference-home-picker">{projectPicker}</div>
        <button className="local-environment" data-testid="home-cwd" title={dir?.path} onClick={() => setLaunchSettings(true)}><Monitor size={16} /><span>{dirs.length > 1 ? dir?.label || t('m6.directory') : t('m6.thisComputer')}</span></button>
        <button data-testid="home-task-settings" className="composer-settings" title={t('m6.taskSettings')} aria-label={t('m6.taskSettings')} onClick={() => setLaunchSettings(true)}><Settings size={16} /></button>
      </div>
      <form className="reference-composer" onSubmit={(e) => { e.preventDefault(); void launch(); }}>
        <textarea ref={inputRef} data-testid="home-input" aria-label={t('m6.taskDescription')} value={message} placeholder={t('m6.promptPlaceholder')} onChange={(e) => setMessage(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void launch(); } }} />
        <div className="reference-composer-toolbar">
          <DropdownMenu><DropdownMenuTrigger className="row-action" aria-label={t('m6.addContext')}><Plus size={20} /></DropdownMenuTrigger><DropdownMenuContent side="top" align="start">
            <DropdownMenuItem onClick={() => setCreatingProject(true)}><Plus />{t('projects.new')}</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setLaunchSettings(true)}><Folder />{t('home.pickProject')}</DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigation.openSettings('aiProfiles')}><Settings />{t('settings.sections.aiProfiles')}</DropdownMenuItem><DropdownMenuSeparator />
            {suggestions.map(({ Icon, key }) => <DropdownMenuItem key={key} data-testid="home-suggestion" onClick={() => { setMessage(t(`home.suggestions.${key}.prompt`)); inputRef.current?.focus(); }}><Icon />{t(`home.suggestions.${key}.title`)}</DropdownMenuItem>)}
          </DropdownMenuContent></DropdownMenu>
          <button type="button" className="composer-permission" onClick={() => setLaunchSettings(true)}><ShieldCheck size={15} />{t('m6.projectContext')}</button>
          <div className="reference-home-picker composer-profile">{profilePicker}</div>
          <button type="submit" data-testid="home-launch" className="reference-send" disabled={!ready} aria-label={t('home.launchHint')} title={t('home.launchHint')}>{launching ? <Loader2 size={19} className="animate-spin" /> : <ArrowUp size={19} />}</button>
        </div>
      </form>
    </div>
    <Dialog open={launchSettings} onOpenChange={setLaunchSettings}><DialogContent className="m6-launch-dialog"><DialogHeader><DialogTitle>{t('m6.taskSettings')}</DialogTitle></DialogHeader><DialogContentArea>
      <Field label={t('home.pickProject')}><div className="flex items-center justify-between gap-3">{projectPicker}<Button variant="outline" size="sm" onClick={() => { setLaunchSettings(false); setCreatingProject(true); }}>{t('projects.new')}</Button></div></Field>
      <Field label={t('m6.directory')}>{directoryPicker}<span className="font-mono text-xs break-all text-foreground-muted">{dir?.path}</span></Field>
      <Field label={t('home.pickProfile')}>{profilePicker}</Field>
      {projectId && profileId && dir && <CapabilityLaunchPreview projectId={projectId} aiProfileId={profileId} cwd={dir.path} />}
      {dirProblem && <Hint tone="error" text={dirProblem} />}
      <div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" disabled={!projectId} onClick={() => projectId && navigation.openProject(projectId)}>{t('m6.projectResources')}</Button><Button variant="outline" size="sm" onClick={() => navigation.openSettings('aiProfiles')}>{t('settings.sections.aiProfiles')}</Button></div>
    </DialogContentArea><DialogFooter><Button data-testid="home-settings-done" onClick={() => setLaunchSettings(false)}>{t('m6.done')}</Button></DialogFooter></DialogContent></Dialog>
    {creatingProject && <ProjectDialog open onOpenChange={setCreatingProject} />}
  </section>;
});

function Hint({
  text,
  action,
  onClick,
  tone = 'info',
  testId,
}: {
  text: string;
  action?: string;
  onClick?: () => void;
  tone?: 'info' | 'error';
  testId?: string;
}) {
  const Icon = tone === 'error' ? CircleAlert : Info;
  return (
    <div
      data-testid={testId}
      className={cn(
        'flex items-start gap-2 rounded-lg border px-3 py-2 text-sm',
        tone === 'error'
          ? 'border-foreground-destructive/30 bg-foreground-destructive/5 text-foreground-destructive'
          : 'border-border bg-background-1 text-foreground-muted'
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" />
      <p className="min-w-0 flex-1 whitespace-pre-wrap select-text">{text}</p>
      {action && (
        <button type="button" onClick={onClick} className="shrink-0 font-medium text-foreground underline underline-offset-2">
          {action}
        </button>
      )}
    </div>
  );
}
