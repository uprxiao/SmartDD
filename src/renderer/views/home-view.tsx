import { homeWorkspace } from '@renderer/features/agent-tasks/workspace-panels-store';
import {browserViewRevision,enterBrowserPresentationTask,rememberBrowserPresentation} from '@renderer/features/browser/open-presentation';
import {showBrowserPresentation} from '@renderer/features/browser/store';
import { VoiceButton } from './voice-controls';
import { voiceStore, textareaVoiceTarget } from '@renderer/core/voice-store';
// Composer layout follows Yoda (Apache-2.0) src/renderer/features/tasks/home-composer.
import { ArrowUp, CircleAlert, ClipboardCheck, Compass, Folder, FolderTree, Hammer, Info, Loader2, Monitor, Paperclip, Plus, Settings, Wrench } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { rpcErrorMessage } from '@shared/ipc/rpc';
import { navigation } from '@renderer/core/navigation';
import { agentTasksStore } from '@renderer/core/agent-tasks-store';
import { newClientInputId } from '@renderer/features/agent-tasks/agent-ids';
import { AgentModelPicker, modelCatalogQuery } from '@renderer/features/agent-tasks/agent-model-picker';
import { readHomeSelection, type HomeSelection } from '@renderer/features/agent-tasks/home-selection';
import { AttachmentChips, prepareChip, type Chip } from '@renderer/features/agent-tasks/attachment-chips';
import { applyItem, findTrigger, skillItems, type MenuItem, type MenuTrigger } from '@renderer/features/agent-tasks/composer-menu';
import { ComposerMenu, useManagedSkillLookup } from '@renderer/features/agent-tasks/composer-menu-view';
import { rpc } from '@renderer/lib/ipc';
import { toast } from 'sonner';
import { useAgents } from '@renderer/lib/hooks/useAgents';
import { homeAgents, homeAgentId, HomePermissionPicker } from '@renderer/features/agents/home-agent-controls';
import {
  CLAUDE_LOGIN_EFFORT, CLAUDE_LOGIN_FALLBACK, CLAUDE_LOGIN_UNAVAILABLE, CODEX_LOGIN_EFFORT, CODEX_LOGIN_FALLBACK, CODEX_LOGIN_MODEL,
  claudeSubscriptionDefault, isClaudeSubscription, modelEffortKey, offersCodexLoginDefault, providerModelOptions,
} from '@shared/agent-model-choice';
import { agentPermission } from '@shared/agent-permissions';
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
  const { data: agents } = useAgents();
  const profiles = agents ? homeAgents(agents.configs) : undefined;
  const permissions = useAppSettingsKey('agentPermissions');
  const draft = useAppSettingsKey('homeDraft');
  const [launchSettings, setLaunchSettings] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(null);
  const message = navigation.homeInput(projectId);
  const setMessage = (value: string) => navigation.setHomeInput(projectId, value);
  const [dirId, setDirId] = useState<string | null>(null);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [homeSelection, setHomeSelection] = useState<HomeSelection>(() => readHomeSelection(localStorage));
  useEffect(() => { try { localStorage.setItem('willyou-m14-home-selection', JSON.stringify(homeSelection)); } catch { /* 偏好缓存不可写不阻塞当前任务 */ } }, [homeSelection]);
  const [error, setError] = useState('');
  const [launching, setLaunching] = useState(false);
  const launchToken = useRef<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const attachmentInput = useRef<HTMLInputElement>(null);
  const { data: project } = useProject(projectId);
  useLayoutEffect(()=>{
    const el=inputRef.current;if(!el)return;
    el.style.height='0px';const full=el.scrollHeight;
    el.style.height=Math.max(42,Math.min(full,220))+'px';el.style.overflowY=full>220?'auto':'hidden';
  },[message]);


  // Project defaults to the last choice if it still exists (PRD F05).
  const initialized = useRef(false);
  useEffect(() => {
    if (initialized.current || !projects || !profiles || !draft.value) return;
    initialized.current = true;
    const d = draft.value;
    const initialProjectId=navigation.homePreset&&projects.some(p=>p.id===navigation.homePreset?.projectId)?navigation.homePreset.projectId:d.projectId&&projects.some(p=>p.id===d.projectId)?d.projectId:projects.length===1?projects[0].id:null;
    const request=navigation.pluginPromptRequest;
    if(request){const prompt=navigation.consumePluginPrompt(request.seq);if(prompt){const existing=navigation.homeInput(initialProjectId);navigation.setHomeInput(initialProjectId,existing?existing+'\n'+prompt:prompt);}}
    if (navigation.homePreset && projects.some((p) => p.id === navigation.homePreset?.projectId)) {
      setProjectId(navigation.homePreset.projectId);
    } else if (d.projectId && projects.some((p) => p.id === d.projectId)) {
      setProjectId(d.projectId);
      setDirId(d.dirId);
    } else if (projects.length === 1) setProjectId(projects[0].id);
  }, [projects, profiles, draft.value]);

  const pluginPrompt=navigation.pluginPromptRequest;
  useEffect(()=>{if(!initialized.current||!pluginPrompt)return;const prompt=navigation.consumePluginPrompt(pluginPrompt.seq);if(prompt){const existing=navigation.homeInput(projectId);navigation.setHomeInput(projectId,existing?existing+'\n'+prompt:prompt);inputRef.current?.focus();}},[pluginPrompt?.seq,projectId,projects,profiles,draft.value]);

  // The list is the same service-ordered projection as Settings. Hidden/logout/missing tools cannot stay selected.
  const profileChosen = useRef(false);
  useEffect(() => {
    if (!agents || !draft.value) return;
    const visible = homeAgents(agents.configs);
    if (profileChosen.current && visible.some(p => p.id === profileId)) return;
    setProfileId(homeAgentId(visible, draft.value.aiProfileId));
  }, [agents, draft.value, profileId]);

  // "New task" under a project selects it.
  const preset = navigation.homePreset;
  const appliedPreset = useRef<number | null>(null);
  useEffect(() => {
    if (!preset || appliedPreset.current === preset.seq || !projects?.some((p) => p.id === preset.projectId)) return;
    appliedPreset.current = preset.seq;
    const applicationPrompt=navigation.consumeApplicationPrompt(preset.seq);
    if(applicationPrompt){const existing=navigation.homeInput(preset.projectId);navigation.setHomeInput(preset.projectId,existing?existing+'\n'+applicationPrompt:applicationPrompt);}
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
  useEffect(()=>homeWorkspace.set(projectId,dir?.id??null,dir?.path??null),[projectId,dir?.id,dir?.path]);
  const profile = profiles?.find((p) => p.id === profileId) ?? null;
  const catalogProject = projectId ?? '';
  const catalogDir = dir?.id ?? '';
  const isCodexLogin = profile?.kind === 'codex' && profile.source === 'login';
  const isCodexSubscription = (candidate: NonNullable<typeof profile>) => candidate.kind === 'codex' && candidate.source === 'login'
    && agents?.tools.some(tool => tool.id === candidate.toolId && tool.login === 'subscription') === true;
  const claudeSubscription = isClaudeSubscription(profile, agents?.tools.find(tool => tool.id === profile?.toolId)?.login);
  const catalogScope = catalogProject && catalogDir ? {kind:'project' as const,projectId:catalogProject,dirId:catalogDir} : undefined;
  const catalog = useQuery({...modelCatalogQuery(catalogScope, profileId ?? ''), enabled:!!(catalogScope && (isCodexLogin || claudeSubscription) && profile?.available)});
  const hasModelChoice = !!profileId && Object.hasOwn(homeSelection.models, profileId);
  const implicitCodexChoice = !!profile && isCodexSubscription(profile) && !hasModelChoice;
  const implicitClaudeChoice = claudeSubscription && !hasModelChoice;
  const offeredDefault = implicitCodexChoice && offersCodexLoginDefault(catalog.data?.models);
  const claudeDefault = implicitClaudeChoice && !catalog.isError && catalog.data?.status !== 'unavailable'
    ? claudeSubscriptionDefault(catalog.data?.models) : undefined;
  const defaultNotice = implicitCodexChoice && catalog.data?.status === 'ready' && !offeredDefault ? CODEX_LOGIN_FALLBACK
    : implicitClaudeChoice && !claudeDefault && catalog.data?.status === 'ready' ? CLAUDE_LOGIN_FALLBACK
    : implicitClaudeChoice && (catalog.isError || catalog.data?.status === 'unavailable') ? CLAUDE_LOGIN_UNAVAILABLE
    : undefined;
  const implicitSelection = offeredDefault ? { id: CODEX_LOGIN_MODEL, defaultEffort: CODEX_LOGIN_EFFORT }
    : claudeDefault ? { id: claudeDefault.id, defaultEffort: CLAUDE_LOGIN_EFFORT } : undefined;
  const selectedModel = hasModelChoice && profileId ? homeSelection.models[profileId] : implicitSelection?.id;
  const profileDefaultModel = (id: string) => profiles?.find(p => p.id === id)?.defaultModel ??
    (id === profileId ? catalog.data?.models.find(item => item.isDefault)?.id : undefined);
  const selectedEffort = hasModelChoice && profileId
    ? homeSelection.modelEfforts
      ? homeSelection.modelEfforts[modelEffortKey(profileId, selectedModel || profileDefaultModel(profileId))]
      : homeSelection.efforts[profileId]
    : implicitSelection?.defaultEffort;

  const selectedProvider=agents?.providers.find(p=>p.id===profile?.providerId);
  const missingProviderKey=profile?.source==='provider'&&selectedProvider&&!selectedProvider.hasKey;
  const dirProblem = project && project.id === projectId && (!dir ? t('home.noDir') : !dir.status.available ? t('home.dirUnavailable', { path: dir.path }) : '');
  const ready = Boolean(projectId && profile && dir && dir.status.available && permissions.value) && !launching;
  const [skillTrigger, setSkillTrigger] = useState<MenuTrigger | null>(null);
  const [skillIndex, setSkillIndex] = useState(0);
  const selectingSkill = navigation.currentViewId === 'home' && skillTrigger !== null;
  const managedSkills = useManagedSkillLookup(selectingSkill,
    projectId && dir?.status.available ? { projectId, dirId: dir.id } : null);
  const skills = selectingSkill ? skillItems({ commands: [], skills: [] }, skillTrigger.query, managedSkills.items) : [];
  const activeSkill = Math.min(skillIndex, Math.max(0, skills.length - 1));
  const updateSkillTrigger = (input: HTMLTextAreaElement) => {
    const trigger = findTrigger(input.value, input.selectionStart);
    setSkillTrigger(trigger?.kind === '$' ? trigger : null);
    setSkillIndex(0);
  };
  const pickSkill = (item: MenuItem) => {
    if (!skillTrigger) return;
    const { text, caret } = applyItem(message, skillTrigger, item);
    setMessage(text);
    setSkillTrigger(null);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(caret, caret);
    });
  };

  // M14 首页附件：随新任务第一条消息发送；准备中或失败时“启动任务”与 ⌘Enter 都不创建任务、不清空（用例 A75）。
  const [chips, setChips] = useState<Chip[]>([]);
  const activeComposer = useRef({ projectId, dirId: dir?.id, chips });
  activeComposer.current = { projectId, dirId: dir?.id, chips };
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const preparing = useRef(new Set<string>());
  const discardChip = (chip: Chip) => {
    preparing.current.delete(chip.localId);
    if (chip.preview) URL.revokeObjectURL(chip.preview);
    if (chip.data?.storedPath) void rpc.agentTasks.discardAttachment(null,chip.data).catch(e=>setError(rpcErrorMessage(e)));
  };
  const removeChip = (id: string) => {
    const chip = chips.find(item=>item.localId===id);
    if (chip) discardChip(chip);
    setChips(all=>all.filter(item=>item.localId!==id));
  };
  // 首页附件绑定准备时的目录：切换项目或目录时清掉，避免按新目录重新解释同名文件（复核 NR12）。
  useEffect(() => {
    if (chips.length) { setError('切换了项目或目录，已移除之前添加的附件'); chips.forEach(discardChip); setChips([]); }
  }, [projectId, dir?.id]);
  useEffect(()=>()=>preparing.current.clear(),[]); // eslint-disable-line react-hooks/exhaustive-deps
  const addFiles = (files: File[]) => {
    if (!dir) return;
    for (const file of files) {
      const localId = crypto.randomUUID(), preview = file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined;
      preparing.current.add(localId);
      setChips(cs => [...cs, { localId, name: file.name || '粘贴的图片', status: 'preparing', preview, file }]);
      void prepareChip(file, f => rpc.agentTasks.prepareAttachment(null, dir.path, f))
        .then(data => {
          if (!preparing.current.delete(localId)) {
            if (data.storedPath) void rpc.agentTasks.discardAttachment(null,data).catch(()=>{});
            return;
          }
          setChips(cs=>cs.map(c=>c.localId===localId?{...c,status:'ready',data,name:data.name}:c));
        })
        .catch(e => setChips(cs => cs.map(c => c.localId === localId ? { ...c, status: 'failed', error: rpcErrorMessage(e) } : c)));
    }
  };
  const launch = async () => {
    if (!ready || launchToken.current || !projectId || !profile || !dir) return;
    if (chips.some(c => c.status === 'preparing')) { setError('附件还在准备中，准备好后再开始任务'); return; }
    if (chips.some(c => c.status === 'failed')) { setError('有附件准备失败，请重试或移除后再开始任务'); return; }
    setError('');
    const token=crypto.randomUUID();launchToken.current=token;
    setLaunching(true);
    try {
      const permission=agentPermission(profile.kind==='codex'?'codex':'claude',permissions.value?.selected??'ask').id;
      const revision = navigation.homeInputRevision(projectId);
      const presetAtLaunch = navigation.homePreset;
      const originalBrowserRevision=browserViewRevision();
      // A cold directory is resolved by the active executor after the first message is saved.
      const initialCodexDefault = implicitCodexChoice && (catalog.data?.status !== 'ready' || offeredDefault);
      let model = initialCodexDefault ? CODEX_LOGIN_MODEL : selectedModel || undefined;
      let effort = initialCodexDefault ? CODEX_LOGIN_EFFORT : selectedEffort;
      if (implicitCodexChoice && !initialCodexDefault) toast.message(CODEX_LOGIN_FALLBACK);
      if (implicitClaudeChoice && !claudeDefault) {
        const result = catalogScope && !catalog.isError && (!catalog.data || catalog.data.status === 'loading' || catalog.data.status === 'refreshing')
          ? await rpc.agentTasks.modelCatalog(catalogScope, profile.id, 'wait').catch(() => undefined)
          : catalog.data;
        const preferred = result && result.status !== 'unavailable' ? claudeSubscriptionDefault(result.models) : undefined;
        model = preferred?.id;
        effort = preferred ? CLAUDE_LOGIN_EFFORT : undefined;
        if (!preferred) toast.message(result?.status === 'ready' ? CLAUDE_LOGIN_FALLBACK : CLAUDE_LOGIN_UNAVAILABLE);
      }
      const carryExtensions = homeSelection.extensions[profile.id] !== false;
      const chipIds = new Set(chips.map(chip => chip.localId));
      const modelChoice = implicitCodexChoice || implicitClaudeChoice ? 'subscription-default' : [model, effort];
      const key = JSON.stringify([revision, dir.id, dir.path, profile.id, permission, modelChoice, Object.entries(homeSelection.extensions).sort(), [...chipIds]]);
      const previous = navigation.homeLaunchAttempts.get(projectId);
      const attempt = previous?.key === key ? previous : { key, taskId: token, inputId: newClientInputId() };
      navigation.homeLaunchAttempts.set(projectId, attempt);
      const created = await rpc.agentTasks.create({ clientTaskId: attempt.taskId, projectId, dirId: dir.id, cwd: dir.path, title: message.split('\n')[0].slice(0, 60), profileId: profile.id, tier: permission, model, effort, initialCodexDefault, carryExtensions, extensionPreferences: homeSelection.extensions });
      if (created.tierNotice) toast.message(created.tierNotice);
      const attachments = chips.flatMap(chip => chip.data ? [chip.data] : []);
      rememberBrowserPresentation(created.taskId,attempt.inputId,originalBrowserRevision,true);
      if (message.trim() || attachments.length) await rpc.agentTasks.submit(created.taskId, { clientInputId: attempt.inputId, text: message, expectedSelectionRevision: 1, attachments });
      if (navigation.homeLaunchAttempts.get(projectId)?.taskId === attempt.taskId) navigation.homeLaunchAttempts.delete(projectId);
      void agentTasksStore.refresh();

      const current = activeComposer.current;
      const sameScope = mounted.current && current.projectId === projectId && current.dirId === dir.id;
      const sameAttachments = current.chips.length === chipIds.size && current.chips.every(chip => chipIds.has(chip.localId));
      const sameDraft = navigation.homeInputRevision(projectId) === revision && sameAttachments;
      if (sameScope) {
        for (const chip of chips) if (chip.preview) URL.revokeObjectURL(chip.preview);
        setChips(currentChips => currentChips.filter(chip => !chipIds.has(chip.localId)));
      }
      if (sameDraft) navigation.setHomeInput(projectId, '');
      if (sameScope && sameDraft && navigation.currentViewId === 'home' && navigation.homePreset === presetAtLaunch) {
        draft.update({ projectId, dirId: dir.id, aiProfileId: profile.id });
        const pending=enterBrowserPresentationTask(created.taskId,attempt.inputId,()=>navigation.openAgentTask(created.taskId));
        if(pending)void showBrowserPresentation(pending).catch(()=>{});
      }
    } catch (e) {
      setError(rpcErrorMessage(e));
    } finally {
      launchToken.current=null;setLaunching(false);
    }
  };

  const suggestions = [
    { Icon: Compass, key: 'explore' },
    { Icon: Hammer, key: 'build' },
    { Icon: ClipboardCheck, key: 'review' },
    { Icon: Wrench, key: 'fix' },
  ] as const;

  const projectPicker = <Select value={projectId} onValueChange={(v) => { if(!projectId&&v&&message){const existing=navigation.homeInput(String(v));navigation.setHomeInput(String(v),existing?existing+'\n'+message:message);navigation.setHomeInput(null,'');}setProjectId(v as string | null); setDirId(null); if (v) navigation.newTask(String(v)); }}>
    <SelectTrigger className={CHIP} data-testid="home-project" aria-label={t('home.pickProject')}><Folder size={15} /><SelectValue placeholder={t('home.pickProject')} /></SelectTrigger>
    <SelectContent>{(projects ?? []).map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
  </Select>;
  const profilePicker = profileId ? <AgentModelPicker profiles={(profiles ?? []).map(p => {
    const provider = agents?.providers.find(item => item.id === p.providerId);
    const tool = agents?.tools.find(item => item.id === p.toolId);
    return { profileId: p.id, name: p.name, kind: p.kind, source: p.source, models: p.models, defaultModel: p.defaultModel, available: p.available, codexSubscription: isCodexSubscription(p), extensionSupport: p.kind === 'codex' ? 'partial' : 'full',
      claudeSubscription: isClaudeSubscription(p, tool?.login),
      provider: provider ? { name: provider.name, catalog: provider.preset } : undefined, modelOptions: providerModelOptions(provider, p) };
  })} profileId={profileId} model={selectedModel} effort={selectedEffort} extensions={homeSelection.extensions}
    modelEfforts={!hasModelChoice && implicitSelection
      ? { ...homeSelection.modelEfforts, [modelEffortKey(profileId, implicitSelection.id)]: implicitSelection.defaultEffort }
      : homeSelection.modelEfforts}
    profileChoices={Object.fromEntries(Object.entries(homeSelection.models).map(([id, model]) => [id, { model, effort: homeSelection.modelEfforts ? undefined : homeSelection.efforts[id] }]))}
    nativeModels={catalog.data?.models} scope={catalogScope} defaultNotice={defaultNotice}
    defaultPending={(implicitCodexChoice || implicitClaudeChoice) && !!catalogScope && !implicitSelection && !catalog.isError
      && (catalog.isPending || catalog.data?.status === 'loading' || catalog.data?.status === 'refreshing')}
    onPick={(id, model, effort) => {
      profileChosen.current = true;
      setProfileId(id);
      setHomeSelection(v => {
        const choices = { ...v.modelEfforts };
        if (!v.modelEfforts) {
          for (const [otherId, value] of Object.entries(v.efforts)) {
            choices[modelEffortKey(otherId, v.models[otherId] || profileDefaultModel(otherId))] = value;
          }
        }
        const key = modelEffortKey(id, model || profileDefaultModel(id));
        if (effort === null) delete choices[key];
        else if (effort !== undefined) choices[key] = effort;
        return { ...v, models: { ...v.models, [id]: model ?? '' }, efforts: {}, modelEfforts: choices };
      });
    }}
    onExtensions={(id, enabled) => setHomeSelection(v => ({ ...v, extensions: { ...v.extensions, [id]: enabled } }))} />
    : <button type="button" className="m13-home-agent-trigger" data-testid="home-profile" onClick={()=>navigation.openSettings('aiProfiles')}>{t('home.pickProfile')}</button>;
  const directoryPicker = <Select value={dir?.id ?? null} onValueChange={(v) => setDirId(v as string | null)}>
    <SelectTrigger className={CHIP} data-testid="home-dir" aria-label={t('m6.directory')} title={dir?.path}><FolderTree size={15} /><SelectValue placeholder={t('home.noDir')} /></SelectTrigger>
    <SelectContent>{dirs.map((d) => <SelectItem key={d.id} value={d.id}>{d.label || d.path}</SelectItem>)}</SelectContent>
  </Select>;

  return <section className="reference-home m13-shell" aria-label={t('nav.newTask')}>
    <div className="reference-welcome"><img src={appIcon} alt="WillYou" draggable={false} /><h1>{t('m6.welcomePrefix')} <button onClick={() => setLaunchSettings(true)}>{project?.name || 'WillYou'}</button> {t('m6.welcomeSuffix')}</h1></div>
    <div className="reference-composer-wrap">
      {(dirProblem || error || !projectId || !profile) && <div className="launch-hint" role="status"><span>{error || dirProblem || (!projectId ? t(projects?.length ? 'home.pickProject' : 'home.noProjects') : t(profiles?.length ? 'home.pickProfile' : 'home.noProfiles'))}</span>{error&&missingProviderKey?<button onClick={()=>navigation.openAgentProvider(selectedProvider.id)}>去填写 Key</button>:<button onClick={() => setLaunchSettings(true)}>{t('m6.taskSettings')}</button>}</div>}
      {error && <span data-testid="home-error" className="sr-only">{error}</span>}
      <div className="reference-composer-context"><div className="reference-home-picker">{projectPicker}</div>
        <button className="local-environment" data-testid="home-cwd" title={dir?.path} onClick={() => setLaunchSettings(true)}><Monitor size={16} /><span>{dirs.length > 1 ? dir?.label || t('m6.directory') : t('m6.thisComputer')}</span></button>
        <button data-testid="home-task-settings" className="composer-settings" title={t('m6.taskSettings')} aria-label={t('m6.taskSettings')} onClick={() => setLaunchSettings(true)}><Settings size={16} /></button>
      </div>
      <form className="reference-composer" onSubmit={(e) => { e.preventDefault(); void launch(); }}>
        <AttachmentChips chips={chips} onRemove={removeChip} onRetry={id => { const c = chips.find(x => x.localId === id); removeChip(id); if (c?.file) addFiles([c.file]); }} />
        <input ref={attachmentInput} type="file" hidden multiple onChange={e => {
          const files = Array.from(e.currentTarget.files ?? []);
          e.currentTarget.value = '';
          if (files.length) addFiles(files);
        }} />
        <ComposerMenu items={skills} index={activeSkill} onPick={pickSkill} skills={selectingSkill} empty={managedSkills.empty} />
        <textarea ref={inputRef} data-testid="home-input" onPaste={e => { const files = [...e.clipboardData.files]; if (files.length) { e.preventDefault(); addFiles(files); } }} onDragOver={e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); }} onDrop={e => { const files = [...e.dataTransfer.files]; if (files.length) { e.preventDefault(); addFiles(files); } }} aria-label={t('m6.taskDescription')} value={message} placeholder={t('m6.promptPlaceholder')}
          onChange={e => { setMessage(e.currentTarget.value); updateSkillTrigger(e.currentTarget); }}
          onSelect={e => updateSkillTrigger(e.currentTarget)}
          onBlur={() => setSkillTrigger(null)}
          onKeyDown={e => {
            if (e.nativeEvent.isComposing || e.keyCode === 229) return;
            if (selectingSkill && e.key === 'Escape') { e.preventDefault(); setSkillTrigger(null); return; }
            if (managedSkills.loading && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); return; }
            if (skills.length) {
              if (e.key === 'ArrowDown') { e.preventDefault(); setSkillIndex((activeSkill + 1) % skills.length); return; }
              if (e.key === 'ArrowUp') { e.preventDefault(); setSkillIndex((activeSkill - 1 + skills.length) % skills.length); return; }
              if ((e.key === 'Tab' || e.key === 'Enter') && !e.shiftKey) { e.preventDefault(); pickSkill(skills[activeSkill]); return; }
            }
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void launch(); }
          }} />
        <div className="reference-composer-toolbar">
          <DropdownMenu><DropdownMenuTrigger className="row-action" aria-label={t('m6.addContext')}><Plus size={20} /></DropdownMenuTrigger><DropdownMenuContent side="top" align="start">
            <DropdownMenuItem disabled={!dir?.status.available || launching} onClick={() => attachmentInput.current?.click()}><Paperclip />{t('home.addAttachments')}</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setCreatingProject(true)}><Plus />{t('projects.new')}</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setLaunchSettings(true)}><Folder />{t('home.pickProject')}</DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigation.openSettings('aiProfiles')}><Settings />{t('settings.sections.aiProfiles')}</DropdownMenuItem><DropdownMenuSeparator />
            {suggestions.map(({ Icon, key }) => <DropdownMenuItem key={key} data-testid="home-suggestion" onClick={() => { setMessage(t(`home.suggestions.${key}.prompt`)); inputRef.current?.focus(); }}><Icon />{t(`home.suggestions.${key}.title`)}</DropdownMenuItem>)}
          </DropdownMenuContent></DropdownMenu>
          <HomePermissionPicker kind={profile?.kind??'claude'} disabled={!profile||launching} />
          <div className="reference-home-picker composer-profile">{profilePicker}</div>
          <VoiceButton compact disabled={launching} onClick={() => void voiceStore.trigger(textareaVoiceTarget(inputRef.current), 'home')} />
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
