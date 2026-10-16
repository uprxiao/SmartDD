import { useEffect, useRef, useState } from 'react';
import { ArrowDown, Archive, ArchiveRestore, ArrowRight, ArrowUp, Check, CheckCheck, ChevronDown, ChevronRight, Code2, Database, Ellipsis, Folder, FolderOpen, Info, Keyboard, LoaderCircle, Monitor, Moon, PanelLeft, Plus, Search, Server, Settings2, ShieldCheck, SlidersHorizontal, Sparkles, Square, SquarePlus, SquarePen, SquareTerminal, Sun, X, Zap } from 'lucide-react';
import { Terminal } from '@xterm/xterm';
import { ReferenceSidebar } from './ReferenceSidebar';
import { RailIcon } from './RailIcon';
import { ReferenceHome } from './ReferenceHome';
import { ProjectWorkspace, ProjectEditor } from './ProjectWorkspace';
import { ProjectTransfer } from './ProjectTransfer';
import { ProfileEditor, ImportProfilesDialog } from './ProfileEditor';
import { CapabilitiesPanel } from './CapabilitiesPanel';
import { ConfirmDialog } from './PreviewUI';
import { makeProject } from './preview-model.mjs';
import { useVoicePreview, textareaTarget, VoiceFeedback, VoiceSettings, VoiceDemoDialog } from './VoicePreview';
import { Mic } from 'lucide-react';
import './parity.css';
import { ArrowLeft, Bot, Clock3, Download, GitBranch, History, House, LayoutGrid, Settings } from 'lucide-react';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

const PROJECTS = [{ id: 'ais', name: 'AIS', path: '/workspace/AIS', description: 'AI 应用平台' }, { id: 'smartdd', name: 'WillYou', path: '/workspace/SmartDD', description: '你的 AI 开发工作台' }];
const PROFILES = [{ id: 'cc-work', name: 'CC-work', runner: 'claude', command: '/usr/local/bin/claude', source: '本机配置', isDefault: true }, { id: 'cc-deepseek', name: 'CC-deepseek', runner: 'claude', command: '/usr/local/bin/claude', source: '自定义配置', isDefault: false }];
const TASKS = [
  { id: 'research', project: 'ais', title: '调研开发环境中的 Skill 与 Agent', time: '刚刚', status: 'running', profile: 'cc-work' },
  { id: 'structure', project: 'ais', title: '梳理项目结构和关键模块', time: '2 小时前', status: 'stopped', profile: 'cc-work' },
  { id: 'build', project: 'smartdd', title: '检查多平台安装包', time: '昨天', status: 'stopped', profile: 'cc-work' },
];
const SETTINGS = [['general', Settings, '常规', '个人'], ['appearance', Sun, '外观', '个人'], ['ai', ShieldCheck, 'AI 配置', '个人'], ['terminal', SquareTerminal, '终端', '个人'], ['voice', Mic, '语音输入', '个人'], ['shortcuts', Keyboard, '键盘快捷键', '个人'], ['skills', Zap, 'Skill 与 MCP', '集成'], ['about', Info, '关于 WillYou', '应用']];
const CLI = { claude: 'Claude Code', codex: 'Codex' };
const id = () => 'preview-' + Math.random().toString(36).slice(2, 9);
const terminalTheme = dark => ({ background: dark ? '#181818' : '#ffffff', foreground: dark ? '#e3e3e3' : '#242424', cursor: dark ? '#eee' : '#292929', selectionBackground: dark ? '#494949' : '#dce5ef', black: '#202020', red: '#db6464', green: dark ? '#81c995' : '#298448', yellow: dark ? '#e4bb74' : '#9a6a17', blue: dark ? '#91b8f0' : '#3669a3', magenta: dark ? '#ca9ee6' : '#9863b7', cyan: dark ? '#7bc4cb' : '#318a94', white: '#e4e4e4', brightBlack: '#858585' });

function IconButton({ icon: Icon, label, onClick, className = '', ...props }) {
  return <button type="button" className={'icon-button ' + className} aria-label={label} title={label} onClick={onClick} {...props}><Icon size={17} strokeWidth={1.65} /></button>;
}
function Status({ children, tone = 'muted', dot = true }) {
  return <span className={'status ' + tone}>{dot && <span className="status-dot" />}{children}</span>;
}
function Dialog({ title, subtitle, children, onClose, className = '' }) {
  const ref = useRef(null);
  useEffect(() => { const d = ref.current; d.showModal(); return () => d.close(); }, []);
  return <dialog ref={ref} className={'dialog ' + className} onCancel={onClose} onClick={e => { if (e.target === e.currentTarget) onClose(); }} aria-label={title}>
    <div className="dialog-head"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><IconButton icon={X} label="关闭弹窗" onClick={onClose} /></div>{children}
  </dialog>;
}
function Toggle({ checked, onChange, label }) {
  return <button type="button" className={'toggle ' + (checked ? 'checked' : '')} role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)}><span /></button>;
}
function SettingRow({ title, description, children }) {
  return <div className="setting-row"><div><h3>{title}</h3>{description && <p>{description}</p>}</div><div className="setting-control">{children}</div></div>;
}
function SettingsGroup({ title, children }) {
  return <section className="settings-group"><h2>{title}</h2><div className="settings-card">{children}</div></section>;
}
const terminalSessions = new Map();
function TerminalPreview({ task, profile, project, dark, fontSize, fontFamily, voiceTarget }) {
  const container = useRef(null), terminal = useRef(null), fitRef = useRef(null), running = useRef(task.status === 'running');
  useEffect(() => { running.current = task.status === 'running'; }, [task.status]);
  useEffect(() => {
    let disposed = false;
    const t = new Terminal({ fontFamily: fontFamily || 'Menlo, monospace', fontSize, lineHeight: 1.45, cursorBlink: true, theme: terminalTheme(dark), convertEol: true, scrollback: 600 });
    const fit = new FitAddon(); t.loadAddon(fit); t.open(container.current); terminal.current = t; fitRef.current = fit;
    const fitNow = () => { if (!disposed && container.current?.clientWidth && container.current?.clientHeight) { fit.fit(); t.refresh(0, t.rows - 1); } };
    fitNow();
    const observer = new ResizeObserver(fitNow); observer.observe(container.current); const timer = setTimeout(fitNow, 60);
    const session = terminalSessions.get(task.id) || { output: '', input: '' };
    terminalSessions.set(task.id, session);
    const refreshOutput = () => { if (!disposed) { t.scrollToBottom(); t.refresh(0, t.rows - 1); } };
    const write = text => { session.output = (session.output + text).slice(-200000); t.write(text, refreshOutput); };
    const writeln = text => write(text + '\r\n');
    if (session.output) t.write(session.output, refreshOutput);
    else {
    writeln('\x1b[1m' + CLI[profile?.runner ?? 'claude'] + '\x1b[0m  \x1b[90m· ' + (profile?.name ?? 'CC-work') + '\x1b[0m');
    writeln('\x1b[90m' + project.path + '\x1b[0m\r\n');
    writeln('\x1b[90mM6 界面预览 · 本地演示终端，未连接模型、数据库或服务器\x1b[0m\r\n');
    writeln('\x1b[1m❯ ' + task.title + '\x1b[0m\r\n');
    writeln('\x1b[32m●\x1b[0m 我会先核对项目目录，再梳理相关配置。');
    writeln('  本页展示终端的排版、颜色和输入体验。\r\n');
    writeln('\x1b[90m  项目       \x1b[0m' + project.name);
    writeln('\x1b[90m  AI 配置    \x1b[0m' + (profile?.name ?? 'CC-work'));
    writeln('\x1b[90m  能力       \x1b[0m数据库诊断 · SSH');
    writeln('\x1b[90m  工作模式   \x1b[0m只读调研\r\n');
    writeln('\x1b[32m✓\x1b[0m 演示界面已准备好。');
    writeln('\x1b[90m  可输入 help、pwd、status 或 clear，试试终端交互。\x1b[0m\r\n');
    write('\x1b[1m❯\x1b[0m ');
    }
    let input = session.input;
    voiceTarget.current = {
      available: () => !!container.current?.isConnected && running.current,
      focus: () => t.focus(),
      insert: text => { input += text; session.input = input; write(text); },
    };
    const onData = t.onData(data => {
      if (!running.current) return;
      if (data.startsWith('\x1b')) return;
      for (const ch of data) {
        if (ch === '\r') {
          writeln(''); const command = input.trim(); input = '';
          if (command === 'clear') { t.reset(); session.output = ''; }
          else if (command === 'pwd') writeln(project.path);
          else if (command === 'status') writeln('\x1b[32m预览就绪\x1b[0m · 没有启动真实 CLI 或外部连接。');
          else if (command === 'help') writeln('help  帮助    pwd  项目路径    status  预览状态    clear  清屏');
          else if (command) writeln('\x1b[90m已收到演示输入。真实任务将在界面确认后接入。\x1b[0m');
          write('\r\n\x1b[1m❯\x1b[0m ');
        } else if (ch === '\u007f') { if (input.length) { input = input.slice(0, -1); write('\b \b'); } }
        else if (ch === '\u0003') { input = ''; write('^C\r\n❯ '); }
        else if (ch >= ' ') { input += ch; write(ch); }
      }
    });
    return () => { disposed = true; session.input = input; clearTimeout(timer); observer.disconnect(); onData.dispose(); t.dispose(); voiceTarget.current = null; terminal.current = null; fitRef.current = null; };
  }, [task.id]);
  useEffect(() => { if (terminal.current) terminal.current.options.theme = terminalTheme(dark); }, [dark]);
  useEffect(() => { if (terminal.current) { if (terminal.current.options.fontSize !== fontSize) terminal.current.options.fontSize = fontSize; const family = fontFamily || 'Menlo, monospace'; if (terminal.current.options.fontFamily !== family) terminal.current.options.fontFamily = family; fitRef.current?.fit(); } }, [fontSize, fontFamily]);
  return <div className="terminal-stage"><div ref={container} className="terminal-mount" aria-label="演示终端，可输入 help、pwd、status、clear" />
    {!task.archived && task.status !== 'running' && <div className="terminal-paused"><Square size={13} />任务已停止，在右上角更多菜单中选择“恢复”继续预览</div>}</div>;
}

export function App() {
  const [route, setRoute] = useState(location.hash.slice(1) || 'home');
  const voice = useVoicePreview(route), terminalVoiceTarget = useRef(null);
  const [projects, setProjects] = useState(() => PROJECTS.map(p => makeProject(p, true))), [profiles, setProfiles] = useState(PROFILES), [tasks, setTasks] = useState(() => TASKS.map(t => ({ ...t, firstMessage: t.title })));
  const [projectId, setProjectId] = useState('smartdd'), [profileId, setProfileId] = useState('cc-work'), [prompt, setPrompt] = useState('');
  const [theme, setTheme] = useState('dark'), [fontSize, setFontSize] = useState(13), [collapsed, setCollapsed] = useState(false), [sidebarWidth, setSidebarWidth] = useState(240);
  const [settingsSearch, setSettingsSearch] = useState('');
  const [searchProject, setSearchProject] = useState('all'), [searchIndex, setSearchIndex] = useState(0);
  const [dirId, setDirId] = useState(null);
  const [fontFamily, setFontFamily] = useState('Menlo, Monaco, monospace');
  const [diagnostics, setDiagnostics] = useState(false), [launchError, setLaunchError] = useState('');
  const [closedProjects, setClosedProjects] = useState([]), [popover, setPopover] = useState(null), [modal, setModal] = useState(() => new URLSearchParams(location.search).get('preview') === 'm8' ? { type: 'project-transfer', mode: 'import' } : null), [search, setSearch] = useState('');
  const [lastProjectPackage, setLastProjectPackage] = useState(null);
  const [toastActions, setToastActions] = useState(null);
  const [toast, setToast] = useState(''), [detecting, setDetecting] = useState(false), [testing, setTesting] = useState(null), [tested, setTested] = useState([]);
  const [capabilities, setCapabilities] = useState({ db: true, ssh: true, mcp: true });
  const [systemDark, setSystemDark] = useState(matchMedia('(prefers-color-scheme: dark)').matches);
  const homeInput = useRef(null), toastTimer = useRef(null);
  const dark = theme === 'dark' || (theme === 'system' && systemDark);
  const project = projects.find(p => p.id === projectId && !p.archived) ?? projects.find(p => !p.archived) ?? { id: '', name: '选择项目', path: '', dirs: [], capabilities: {} };
  const profile = profiles.find(p => p.id === profileId) ?? profiles.find(p => p.isDefault) ?? profiles[0];
  const dir = project.dirs.find(d => d.id === dirId) ?? project.dirs.find(d => d.isDefault) ?? project.dirs[0];
  const taskId = route.startsWith('task/') ? route.split('/')[1] : null, task = tasks.find(t => t.id === taskId);
  const isSettings = route.startsWith('settings'), section = route.split('/')[1] || 'ai';
  const isProject = route.startsWith('project/'), projectTab = route.split('/')[2] || 'overview';
  const activeProject = projects.find(p => p.id === route.split('/')[1]) ?? project, taskProject = projects.find(p => p.id === task?.project) ?? { name: '未关联项目', path: task?.cwd || '/workspace', capabilities: {} };
  const nav = next => { location.hash = next; setRoute(next); setPopover(null); };
  const updateProject = value => setProjects(old => old.map(p => p.id === value.id ? value : p));
  const deleteProject = key => { setProjects(old => old.filter(p => p.id !== key)); setTasks(old => old.map(t => t.project === key ? { ...t, project: null } : t)); if (projectId === key) setProjectId(''); nav('home'); };
  const notify = (message, actions = null) => { setToastActions(actions); clearTimeout(toastTimer.current); setToast(message); toastTimer.current = setTimeout(() => setToast(''), 3500); };
  const archiveTask = (item, archived) => {
    setTasks(old => old.map(t => t.id === item.id ? { ...t, archived, status: 'stopped' } : t));
    if (archived && taskId === item.id) { if (item.project) setProjectId(item.project); nav('home'); }
    setModal(null);
    notify(archived ? '会话已归档' : '已取消归档', archived ? { undo: () => archiveTask(item, false), view: () => nav('task/' + item.id) } : null);
  };
  const requestArchive = item => {
    if (!item.archived && item.status === 'running') setModal({ type: 'archive-task', task: item });
    else archiveTask(item, !item.archived);
  };
  useEffect(() => {
    const changed = () => setRoute(location.hash.slice(1) || 'home');
    const key = e => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearch(''); setModal({ type: 'search' }); }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n') { e.preventDefault(); nav('home'); }
      if (e.key === 'Escape') setPopover(null);
    };
    window.addEventListener('hashchange', changed); window.addEventListener('keydown', key);
    const media = matchMedia('(prefers-color-scheme: dark)'), sync = e => setSystemDark(e.matches); media.addEventListener('change', sync);
    return () => { window.removeEventListener('hashchange', changed); window.removeEventListener('keydown', key); media.removeEventListener('change', sync); clearTimeout(toastTimer.current); };
  }, []);
  useEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : 'light'; }, [dark]);
  const createTask = () => {
    if (!project.id || !dir?.available || !profile) { setLaunchError(!project.id ? '请先添加并选择项目' : !dir?.available ? '请先添加可用的代码目录' : '请先添加 AI 配置'); return; }
    const t = { id: id(), title: prompt.trim() || '新任务', firstMessage: prompt.trim(), project: project.id, profile: profile.id, profileName: profile.name, runner: profile.runner, cwd: dir.path, configVersion: project.configVersion, time: '刚刚', status: 'running' };
    setLaunchError('');
    setTasks(old => [t, ...old]); setPrompt(''); nav('task/' + t.id);
  };
  const addDetected = runner => {
    const existing = profiles.find(p => p.runner === runner && p.source === '本机配置');
    if (existing) { setModal({ type: 'profile', profile: existing }); return; }
    const p = { id: id(), name: CLI[runner], runner, command: runner === 'codex' ? '/opt/homebrew/bin/codex' : '/usr/local/bin/claude', source: '本机配置', isDefault: false };
    setProfiles(old => [...old, p]); notify('已添加 ' + p.name + '，现在可以在新建任务中选择');
  };
  const testProfile = p => { setTesting(p.id); setTimeout(() => { setTesting(null); setTested(old => [...new Set([...old, p.id])]); notify(p.name + ' 的演示检查完成；未调用真实模型'); }, 850); };
  const resize = event => {
    event.preventDefault(); const startX = event.clientX, width = sidebarWidth;
    const move = e => setSidebarWidth(Math.max(240, Math.min(420, width + e.clientX - startX)));
    const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', stop);
  };
  const railSelection = route === 'home' || route.startsWith('task/') ? 'home' : route === 'scheduled' ? 'clock' : isProject ? 'branch' : route === 'settings/ai' ? 'bot' : route === 'settings/skills' ? 'grid' : null;
  const railButton = (name, label, onClick) => <button type="button" className={'rail-link ' + (name === 'home' ? 'rail-home' : '')} aria-label={label} title={label} aria-current={railSelection === name ? 'page' : undefined} onClick={onClick}><RailIcon name={name} selected={railSelection === name} /></button>;
  const suggestions = [['梳理项目结构', '帮我梳理这个项目的结构和关键模块', FolderOpen], ['只读调研环境', '帮我只读调研开发环境中的 Skill 与 Agent', Search], ['检查最近的修改', '帮我检查最近的代码修改并指出需要关注的地方', Code2]];
  const matchingTasks = tasks.filter(t => (searchProject === 'all' || (t.project || 'orphan') === searchProject) && (t.title + (t.firstMessage || '') + (projects.find(p => p.id === t.project)?.name || '未关联项目') + (profiles.find(p => p.id === t.profile)?.name || t.profileName || '')).toLowerCase().includes(search.toLowerCase()));
  const recentRow = (t, index) => <button key={t.id} className={"recent-row " + (index === searchIndex ? "search-selected" : "")} onClick={() => { nav('task/' + t.id); setModal(null); }}><SquareTerminal size={16} /><div><span>{t.title}{t.archived && <span className="tag">已归档</span>}</span><small>{projects.find(p => p.id === t.project)?.name || '未关联项目'} · {profiles.find(p => p.id === t.profile)?.name || t.profileName || '配置已删除'}</small></div><span>{t.time}</span><ChevronRight size={14} /></button>;

  return <div className={'app codex-frame ' + (isSettings ? 'settings-mode ' : route === 'scheduled' ? 'scheduled-mode ' : route === 'home' ? 'home-mode ' : '') + (collapsed ? 'sidebar-collapsed' : '')} style={{ '--sidebar-width': sidebarWidth + 'px' }}>
    <div className="window-navigation"><IconButton icon={ArrowLeft} label="返回工作台" onClick={() => nav('home')} /><IconButton icon={ArrowRight} label="前进" onClick={() => history.forward()} />{!isSettings && <IconButton icon={PanelLeft} label={collapsed ? '展开侧栏' : '收起侧栏'} onClick={() => setCollapsed(!collapsed)} />}{!task && <><button className="m7-preview-entry" onClick={() => setModal({ type: 'project-transfer', mode: 'import' })}><Folder size={13} />M8 · 项目迁移</button><button className="m7-preview-entry" onClick={() => { voice.clear(); setModal({ type: 'voice-demo' }); }}><Mic size={13} />M7 · 语音预览</button>{voice.notice?.kind === 'sent' && <button className="m7-preview-entry" onPointerDown={e => e.preventDefault()} onClick={voice.fillExample}>演示文字回填</button>}</>}</div>
    {task && <header className="task-window-header" aria-label="当前会话">
      <div className="task-window-title" title={taskProject.name + ' / ' + task.title}><Folder size={17} /><span>{task.title}</span></div>
      <div className="task-window-actions">
        <div className="picker-wrap"><IconButton icon={Ellipsis} label="更多" aria-expanded={popover === 'task-actions'} onClick={() => setPopover(popover === 'task-actions' ? null : 'task-actions')} />
          {popover === 'task-actions' && <div className="popover task-actions-menu">
            <button className="menu-item" disabled={task.archived} onClick={() => { setPopover(null); task.status === 'running' ? setTasks(old => old.map(t => t.id === task.id ? { ...t, status: 'stopped' } : t)) : setModal({ type: 'resume' }); }}>{task.status === 'running' ? <Square size={16} /> : <ArrowRight size={16} />}{task.status === 'running' ? '结束' : '恢复'}</button>
            <button className="menu-item" onClick={() => { setTheme(dark ? 'light' : 'dark'); setPopover(null); }}>{dark ? <Sun size={16} /> : <Moon size={16} />}主题</button>
            <div className="menu-divider" /><button className="menu-item" onClick={() => { setPopover(null); voice.clear(); setModal({ type: 'voice-demo' }); }}>M7 · 语音预览</button>
            <button className="menu-item" disabled={task.status !== 'running' || voice.busy || !voice.settings.globalEnabled} onPointerDown={e => e.preventDefault()} onClick={() => { setPopover(null); voice.trigger(terminalVoiceTarget.current); }}>演示终端快捷键（模拟）</button>
            {voice.notice?.kind === 'sent' && <button className="menu-item" onPointerDown={e => e.preventDefault()} onClick={() => { setPopover(null); voice.fillExample(); }}>演示文字回填</button>}
          </div>}
        </div>
        <IconButton icon={SlidersHorizontal} label="任务信息" onClick={() => setModal({ type: 'task-info' })} /><span className="task-window-divider" />
        <IconButton icon={SquarePlus} label="新建任务" onClick={() => { if (task.project) setProjectId(task.project); nav('home'); }} />
      </div>
    </header>}
    <nav className="app-rail" aria-label="应用导航">
      <div className="rail-links">{railButton('home', '工作台', () => nav('home'))}{railButton('clock', '定时任务', () => nav('scheduled'))}{railButton('bot', 'AI 工具', () => nav('settings/ai'))}{railButton('more', '预览说明', () => setModal({ type: 'preview' }))}<span className="rail-separator" />{railButton('branch', '项目资源', () => project.id ? nav('project/' + project.id) : setModal({ type: 'project' }))}{railButton('grid', 'Skill 与 MCP', () => nav('settings/skills'))}</div>
      <div className="rail-bottom"><IconButton icon={Download} label="版本信息" className="rail-download" onClick={() => nav('settings/about')} /><button className="rail-avatar" aria-label="设置" title="设置" onClick={() => nav('settings/general')}><img src="/assets/app-icon.png" alt="" /></button></div>
    </nav>
    <ReferenceSidebar projects={projects} tasks={tasks} route={route} collapsed={collapsed} closedProjects={closedProjects} activeProject={isProject ? activeProject.id : route === 'home' ? projectId : null} activeTaskId={taskId}
      onToggleProject={key => setClosedProjects(old => old.includes(key) ? old.filter(p => p !== key) : [...old, key])}
      onHome={key => { if (key) setProjectId(key); nav('home'); }} onSearch={() => { setSearch(''); setModal({ type: 'search' }); }} onSelectProject={key => { setProjectId(key); nav('home'); }} onOpenTask={key => nav('task/' + key)}
      onCreateProject={() => setModal({ type: 'project' })} onEditProject={p => { setProjectId(p.id); nav('project/' + p.id); }}
      onImportProject={() => setModal({ type: 'project-transfer', mode: 'import' })} onExportProject={p => setModal({ type: 'project-transfer', mode: 'export', project: p })}
      onRenameTask={t => setModal({ type: 'rename-task', task: t })} onArchiveTask={requestArchive}
      onSettings={() => nav('settings/general')} onInfo={() => setModal({ type: 'preview' })} />
    {route === 'scheduled' && <aside className="sidebar scheduled-sidebar"><h2>定时任务</h2><button className="nav-row" disabled title="后续开放"><Plus size={16} />新建任务</button><p>即将执行</p><span className="scheduled-empty">暂未开放</span></aside>}
    {!collapsed && <div className="sidebar-resizer" role="separator" aria-label="调整侧栏宽度" aria-orientation="vertical" tabIndex={0} aria-valuenow={sidebarWidth} aria-valuemin={240} aria-valuemax={420} onPointerDown={resize} onKeyDown={e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); setSidebarWidth(w => Math.max(240, Math.min(420, w + (e.key === 'ArrowRight' ? 10 : -10)))); } }} />}
    <main className="workspace">
      {!task && <header className="topbar"><div className="breadcrumbs">{isSettings ? <><span>设置</span><ChevronRight size={12} /><span>{SETTINGS.find(s => s[0] === section)?.[2] || 'AI 配置'}</span></> : isProject ? <><Folder size={15} /><span>{activeProject.name}</span></> : <span className="quiet">工作台</span>}</div>
        <div className="topbar-actions"><button className="preview-badge" onClick={() => setModal({ type: 'preview' })}>界面预览</button><IconButton icon={dark ? Sun : Moon} label={dark ? '切换浅色主题' : '切换深色主题'} onClick={() => setTheme(dark ? 'light' : 'dark')} /></div>
      </header>}
      {route === 'home' && <ReferenceHome dir={dir} onDir={setDirId} onLaunchSettings={() => setModal({ type: 'launch-settings' })} launchError={launchError}  project={project} projects={projects.filter(p => !p.archived)} profile={profile} profiles={profiles} prompt={prompt} setPrompt={setPrompt} inputRef={homeInput} onProject={setProjectId} onProfile={setProfileId} onSubmit={createTask} onSettings={() => nav('settings/ai')} onAddProject={() => setModal({ type: 'project' })} voiceBusy={voice.busy} onVoice={() => voice.trigger(textareaTarget(homeInput.current, setPrompt))} />}
      {route === 'scheduled' && <section className="scheduled-placeholder" aria-label="定时任务规划"><span className="scheduled-clock" aria-hidden="true">🕗</span><h1>安排任务</h1><p>定时执行项目任务，让重复的工作按计划完成。</p><span className="scheduled-planned">功能规划中</span><p className="scheduled-note">已列入后续需求，本轮保留入口。暂不创建或执行定时任务。</p><button className="text-button" onClick={() => nav('home')}>返回工作台<ArrowRight size={14} /></button></section>}
      {task && <section className="task-page">
        <TerminalPreview key={task.id + task.profile} task={task} profile={profiles.find(p => p.id === task.profile)} project={{ ...taskProject, path: task.cwd || taskProject.path }} dark={dark} fontSize={fontSize} fontFamily={fontFamily} voiceTarget={terminalVoiceTarget} />
        {task.archived && <div className="task-archive-notice"><Archive size={16} /><span>会话已归档</span><button className="text-button" onClick={() => archiveTask(task, false)}><ArchiveRestore size={15} />取消归档</button></div>}
        <footer className="task-statusbar"><Status tone={task.status === 'running' ? 'success' : 'muted'}>{task.status === 'running' ? '运行中' : '已停止'}</Status><span>{task.cwd || taskProject.path}</span><span className="push">{tasks.filter(t => t.status === 'running').length} 个运行中 · 演示终端</span><span>UTF-8</span></footer>
      </section>}
      {isSettings && <section className="settings-shell"><nav className="settings-nav" aria-label="设置分类"><h2>设置</h2><label className="settings-search"><Search size={16} /><input placeholder="搜索" aria-label="搜索设置" value={settingsSearch} onChange={e => setSettingsSearch(e.target.value)} /></label><div className="settings-nav-scroll">{['个人', '集成', '应用'].map(group => { const items = SETTINGS.filter(([, , name, category]) => category === group && name.toLowerCase().includes(settingsSearch.toLowerCase())); return items.length > 0 && <div className="settings-nav-group" key={group}><h3>{group}</h3>{items.map(([key, Icon, name]) => <button key={key} className={'nav-row ' + (section === key ? 'selected' : '')} onClick={() => nav('settings/' + key)}><Icon size={17} strokeWidth={1.65} /><span>{name}</span>{key === 'voice' && <span className="m7-chip">M7</span>}</button>)}</div>; })}{!SETTINGS.some(([, , name]) => name.toLowerCase().includes(settingsSearch.toLowerCase())) && <p className="settings-search-empty">没有找到设置</p>}</div></nav><div className="settings-content" key={section}>
        {section === 'voice' && <VoiceSettings voice={voice} notify={notify} />}
        {section === 'ai' && <div className="settings-inner"><div className="page-heading"><div><h1>AI 配置</h1><p>连接你熟悉的 AI 工具，在不同任务中随时切换。</p></div><button className="button secondary" onClick={() => setModal({ type: 'profile' })}><Plus size={15} />新建配置</button></div>
          <div className="group-heading"><h2>本机工具</h2><button className="text-button" disabled={detecting} onClick={() => { setDetecting(true); setTimeout(() => { setDetecting(false); notify('演示检测完成，发现 2 个工具'); }, 750); }}>{detecting ? <LoaderCircle size={14} className="spin" /> : <Search size={14} />}{detecting ? '检测中…' : '重新检测'}</button></div><p className="section-description">将已安装的工具添加为配置，即可在新建任务中使用。</p>
          <div className="detection-list">{['codex', 'claude'].map(runner => { const exists = profiles.some(p => p.runner === runner && p.source === '本机配置'); return <div className="detection-row" key={runner}><div className="tool-icon"><SquareTerminal size={22} strokeWidth={1.4} /></div><div className="detection-info"><div><strong>{CLI[runner]}</strong><Status tone="success">{detecting ? '检测中' : '已检测到'}</Status></div><code>{runner === 'codex' ? '/opt/homebrew/bin/codex' : '/usr/local/bin/claude'} · 版本待真实检测（示例）</code></div><button className={'button small ' + (exists ? 'quiet-button' : 'secondary')} disabled={detecting} onClick={() => addDetected(runner)}>{exists ? <><Check size={14} />已添加<ChevronRight size={13} /></> : <><Plus size={14} />添加配置</>}</button></div>; })}</div>
          <div className="group-heading profiles-heading"><h2>你的配置 <span className="count">{profiles.length}</span></h2><button className="text-button" onClick={() => setModal({ type: 'import' })}><ArrowDown size={14} />导入配置</button></div>
          <div className="profile-list">{profiles.map(p => <div className="profile-row" key={p.id}><div className="profile-symbol" style={{ color: p.color || 'var(--secondary)' }}><SquareTerminal size={18} /></div><button className="profile-main" onClick={() => setModal({ type: 'profile', profile: p })}><strong>{p.name}{p.isDefault && <span className="tag">默认</span>}</strong><small>{CLI[p.runner]}<span>·</span>{p.source}</small></button><Status tone={p.runner === 'codex' && !tested.includes(p.id) ? 'muted' : 'success'}>{testing === p.id ? '测试中' : p.runner === 'codex' && !tested.includes(p.id) ? '未测试' : '可用 · 示例'}</Status><button className="button small quiet-button" disabled={testing !== null} onClick={() => testProfile(p)}>{testing === p.id ? <LoaderCircle size={14} className="spin" /> : <Zap size={14} />}测试</button><IconButton icon={Ellipsis} label={'编辑 ' + p.name} onClick={() => setModal({ type: 'profile', profile: p })} /></div>)}</div>
          <div className="quiet-note"><ShieldCheck size={16} /><p>优先使用本机已有的登录和配置。密钥加密保存在本机。</p></div>
        </div>}
        {section === 'general' && <div className="settings-inner"><div className="page-heading"><h1>常规</h1></div>
          <SettingsGroup title="AI 配置"><SettingRow title="默认 AI 配置" description="开始新任务时，默认使用的 AI 工具与账号配置。已有任务继续使用原来的配置。"><select aria-label="默认 AI 配置" value={profiles.find(p => p.isDefault)?.id || profiles[0]?.id || ''} onChange={e => { setProfiles(old => old.map(p => ({ ...p, isDefault: p.id === e.target.value }))); setProfileId(e.target.value); }}>{profiles.map(p => <option value={p.id} key={p.id}>{p.name}</option>)}</select></SettingRow><SettingRow title="本机工具与登录" description="查看已检测到的 Codex、Claude Code，复用已有的本机登录与配置。可以为不同工作场景保存多套配置。"><button className="button small secondary" onClick={() => nav('settings/ai')}>管理配置</button></SettingRow></SettingsGroup>
          <SettingsGroup title="常规"><SettingRow title="数据目录" description="保存项目、配置和任务记录的位置。"><code className="setting-path" title="/workspace/SmartDD/user-data">/workspace/SmartDD/user-data</code><button className="button small secondary" onClick={() => notify('演示数据目录；不会打开或读取本机文件')}>显示</button></SettingRow><SettingRow title="语言" description="应用界面语言。"><select aria-label="界面语言" defaultValue="zh-CN" onChange={() => notify('当前原型展示简体中文；完整中英文页面在正式接入阶段验证')}><option value="zh-CN">简体中文</option><option value="en">English</option></select></SettingRow><SettingRow title="环境诊断" description="检查 SQLite、终端和本机工具运行环境。"><button className="button small secondary" onClick={() => setDiagnostics(true)}>运行检查</button></SettingRow><SettingRow title="外观" description="调整工作空间的浅色或深色主题。"><button className="button small secondary" onClick={() => nav('settings/appearance')}>{dark ? '深色' : '浅色'}<ChevronDown size={14} /></button></SettingRow><SettingRow title="终端字体" description="任务工作区保留原生终端展示。"><button className="button small secondary" onClick={() => nav('settings/terminal')}>{fontSize}px<ChevronDown size={14} /></button></SettingRow><SettingRow title="键盘快捷键" description="查看新建任务、搜索和启动的快捷方式。"><button className="button small secondary" onClick={() => nav('settings/shortcuts')}>查看</button></SettingRow></SettingsGroup>{diagnostics && <div className="notice" role="status">示例诊断结果<table className="capability-table"><tbody>{['SQLite', 'PTY', 'Codex', 'Claude Code', '安全存储'].map(n => <tr key={n}><td>{n}</td><td>待真实检查 · 原型不运行系统探针</td></tr>)}</tbody></table></div>}
        </div>}
        {section === 'appearance' && <div className="settings-inner"><div className="page-heading"><h1>外观</h1></div><SettingsGroup title="外观"><SettingRow title="主题" description="选择应用的外观，或跟随系统设置。"><select aria-label="外观主题" value={theme} onChange={e => setTheme(e.target.value)}><option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></SettingRow><SettingRow title="项目侧栏宽度" description="调整工作台中的项目和任务列表。"><input aria-label="侧栏宽度" type="range" min="240" max="420" value={sidebarWidth} onChange={e => setSidebarWidth(Number(e.target.value))} /><span className="value-label">{sidebarWidth}px</span></SettingRow></SettingsGroup></div>}
        {section === 'shortcuts' && <div className="settings-inner"><div className="page-heading"><h1>键盘快捷键</h1></div><SettingsGroup title="任务"><SettingRow title="新建任务"><kbd>⌘ N</kbd></SettingRow><SettingRow title="搜索任务"><kbd>⌘ K</kbd></SettingRow><SettingRow title="启动任务"><kbd>⌘ Enter</kbd></SettingRow><SettingRow title="关闭弹窗"><kbd>Esc</kbd></SettingRow></SettingsGroup><SettingsGroup title="语音输入 · M7"><SettingRow title="全局唤起 Typeless" description={voice.settings.globalEnabled && voice.settings.enabled ? voice.settings.globalShortcut : '尚未启用'}><button className="button secondary" onClick={() => nav('settings/voice')}>配置语音快捷键<ChevronRight size={14} /></button></SettingRow></SettingsGroup></div>}
        {section === 'terminal' && <div className="settings-inner"><div className="page-heading"><h1>终端</h1></div><SettingsGroup title="显示"><SettingRow title="字体名称" description="保留字体回退列表。"><input aria-label="终端字体名称" value={fontFamily} onChange={e => setFontFamily(e.target.value)} /></SettingRow><SettingRow title="字体大小" description="即时应用到任务终端。"><select aria-label="终端字体大小" value={fontSize} onChange={e => setFontSize(Number(e.target.value))}>{Array.from({ length: 15 }, (_, n) => n + 10).map(n => <option key={n} value={n}>{n}px</option>)}</select></SettingRow><SettingRow title="终端配色" description="自动跟随工作空间的浅色或深色主题。"><Status dot={false}>跟随外观</Status></SettingRow></SettingsGroup><button className="button secondary" onClick={() => { setFontSize(13); setFontFamily('Menlo, Monaco, monospace'); }}>恢复终端默认设置</button><div className="terminal-sample" style={{ fontSize, fontFamily }}><span className="term-green">✓</span> 项目目录已就绪<br /><span className="term-muted">/workspace/AIS</span><br /><br /><span className="term-blue">❯</span> 开始下一项任务</div></div>}
        {section === 'skills' && <div className="settings-inner"><div className="page-heading"><h1>Skill 与 MCP</h1></div><CapabilitiesPanel profiles={profiles} /></div>}
        {section === 'about' && <div className="settings-inner"><div className="about-brand"><img src="/assets/app-icon.png" alt="WillYou 蚂蚁 Logo" /><h1>WillYou</h1><p>把项目、工具和任务放在一起。</p><span className="tag">M6 界面基线 · M7 语音 · M8 项目迁移</span></div><SettingRow title="本地工作空间" description="项目、配置和会话由你掌握。"><Monitor size={19} /></SettingRow><SettingRow title="这份原型" description="用于确认页面与交互，所有数据均为演示。"><button className="text-button" onClick={() => setModal({ type: 'preview' })}>了解范围<ChevronRight size={14} /></button></SettingRow></div>}
      </div></section>}
      {isProject && <ProjectWorkspace key={activeProject.id} project={activeProject} tab={projectTab} profiles={profiles} tasks={tasks} onNavigate={tab => nav('project/' + activeProject.id + '/' + tab)} onUpdate={updateProject} onDelete={deleteProject} onNewTask={() => { setProjectId(activeProject.id); nav('home'); }} onOpenTask={key => nav('task/' + key)} onExport={() => setModal({ type: 'project-transfer', mode: 'export', project: activeProject })} />}
      {route !== 'home' && route !== 'scheduled' && !isSettings && !isProject && !task && <div className="empty-state"><h2>任务暂不可用</h2><button className="button secondary" onClick={() => nav('home')}>返回工作台</button></div>}
    </main>
    {modal?.type === 'voice-demo' && <VoiceDemoDialog voice={voice} onClose={() => { voice.clear(); setModal(null); }} onNavigate={path => { voice.clear(); setModal(null); nav(path); }} />}
    {!modal && <VoiceFeedback voice={voice} onSettings={() => { voice.clear(); nav('settings/voice'); }} />}
    {popover && <button className="popover-dismiss" aria-label="关闭选择菜单" onClick={() => setPopover(null)} tabIndex={-1} />}
    {toast && <div className="toast" role="status"><CheckCheck size={16} /><span>{toast}</span>{toastActions && <><button onClick={() => { toastActions.undo(); }}>撤销</button><button onClick={() => { toastActions.view(); setToast(''); }}>查看</button></>}<button aria-label="关闭提示" onClick={() => setToast('')}><X size={14} /></button></div>}
    {modal?.type === 'search' && <Dialog title="搜索任务" onClose={() => setModal(null)} className="search-dialog"><div className="search-input"><Search size={18} /><input aria-label="搜索任务关键词" autoFocus placeholder="搜索标题、首条消息、项目或 AI 配置…" value={search} onChange={e => { setSearch(e.target.value); setSearchIndex(0); }} onKeyDown={e => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setSearchIndex(i => Math.max(0, Math.min(matchingTasks.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))); } else if (e.key === 'Enter' && matchingTasks[searchIndex]) { e.preventDefault(); e.stopPropagation(); nav('task/' + matchingTasks[searchIndex].id); setModal(null); } }} /><kbd>Esc</kbd></div><label className="search-filter">项目<select aria-label="筛选任务项目" value={searchProject} onChange={e => { setSearchProject(e.target.value); setSearchIndex(0); }}><option value="all">全部项目</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}{p.archived ? '（已归档）' : ''}</option>)}<option value="orphan">未关联项目</option></select></label><div className="search-results">{matchingTasks.map(recentRow)}{!matchingTasks.length && <div className="empty-state small-empty"><p>没有找到匹配的任务</p><small>换个关键词试试。</small></div>}</div></Dialog>}
    {modal?.type === 'profile' && <ProfileEditor profile={modal.profile} onClose={() => setModal(null)} onDelete={() => setModal({ type: 'delete-profile', profile: modal.profile })} onSave={value => { setProfiles(old => { const key = modal.profile?.id || id(); const next = old.some(p => p.id === key) ? old.map(p => p.id === key ? { ...p, ...value } : p) : [...old, { ...value, id: key }]; return next.map(p => value.isDefault ? { ...p, isDefault: p.id === key } : p); }); setModal(null); notify('配置已保存在本次预览中'); }} />}
    {modal?.type === 'delete-profile' && <ConfirmDialog title={'删除配置 ' + modal.profile.name + '？'} description="已有任务保留配置名称和运行器信息；后续恢复需选用同一运行器的其他配置。" secrets onClose={() => setModal(null)} onConfirm={() => { const removed = modal.profile; setTasks(old => old.map(t => t.profile === removed.id ? { ...t, profileName: removed.name, runner: removed.runner } : t)); setProfiles(old => { const rest = old.filter(p => p.id !== removed.id); return removed.isDefault ? rest.map((p, i) => ({ ...p, isDefault: i === 0 })) : rest; }); setModal(null); }} />}
    {modal?.type === 'project' && <ProjectEditor onClose={() => setModal(null)} onSave={value => { const p = makeProject({ ...value, id: id() }); setProjects(old => [...old, p]); setProjectId(p.id); setModal(null); nav('project/' + p.id); }} />}
    {modal?.type === 'project-transfer' && <ProjectTransfer key={modal.mode} mode={modal.mode} project={modal.project} projects={projects} profiles={profiles} lastPackage={lastProjectPackage} onExport={setLastProjectPackage} onClose={() => setModal(null)} onImport={(p, importedProfiles) => {
      setProjects(old => [...old, p]);
      setProfiles(old => {
        const next = [...old];
        for (const source of importedProfiles) {
          let name = source.name, n = 1;
          while (next.some(x => x.name.toLowerCase() === name.toLowerCase())) {
            const suffix = '（导入 ' + n++ + '）';
            name = source.name.slice(0, 60 - suffix.length) + suffix;
          }
          next.push({ ...source, id: id(), name, isDefault: false });
        }
        return next;
      });
    }} onOpenProject={key => {
      if (key === 'import') { setModal({ type: 'project-transfer', mode: 'import' }); return; }
      setModal(null); setProjectId(key); nav('project/' + key);
    }} onStartTask={key => { setModal(null); setProjectId(key); nav('home'); }} />}
    {modal?.type === 'rename-task' && <Dialog title="重命名任务" onClose={() => setModal(null)}><form onSubmit={e => { e.preventDefault(); const title = String(new FormData(e.currentTarget).get('title')).trim(); if (!title) return; setTasks(old => old.map(t => t.id === modal.task.id ? { ...t, title } : t)); setModal(null); }}><label className="field">任务名称<input name="title" required autoFocus defaultValue={modal.task.title} onFocus={e => e.target.select()} /></label><div className="dialog-footer"><button type="button" className="button secondary" onClick={() => setModal(null)}>取消</button><button className="button primary">保存</button></div></form></Dialog>}
    {modal?.type === 'archive-task' && <Dialog title="结束并归档此会话？" onClose={() => setModal(null)}><p className="section-description">“{modal.task.title}”正在运行。归档将结束该会话的终端，保留任务记录与 CLI 会话文件。之后可在已归档列表中查看或取消归档。</p><div className="dialog-footer"><button className="button secondary" onClick={() => setModal(null)}>取消</button><button className="button primary" onClick={() => archiveTask(modal.task, true)}>结束并归档</button></div></Dialog>}
    {modal?.type === 'task-info' && task && <Dialog title="任务信息" subtitle={task.title} onClose={() => setModal(null)} className="parity-dialog"><div className="info-list"><div><span>项目</span><strong>{taskProject.name}</strong></div><div><span>AI 配置</span><strong>{profiles.find(p => p.id === task.profile)?.name || task.profileName || '配置已删除'}</strong></div><div><span>模型</span><span>使用 CLI 配置的模型</span></div><div><span>工作目录</span><code>{task.cwd || taskProject.path}</code></div><div><span>注入环境变量</span><code>SMARTDD_PROJECT_ID · SMARTDD_CONFIG_PATH（示例，不显示值）</code></div><div><span>项目配置版本</span><span>v{task.configVersion || 1} / 当前 v{taskProject.configVersion || 1}</span></div><div><span>配置注入自检</span><span>未核验 · 演示任务</span></div><div><span>Skill / MCP 加载</span><span>未核验</span></div><div><span>任务状态</span><span>{task.status === 'running' ? '运行中' : '已停止，可恢复'}</span></div></div><details className="notice"><summary>运行快照与审计路径</summary><code>demo-config-hash · /preview/runtime/audit.json</code><p>数据库诊断 v1.0.0 · SSH v1.0.0 · WillYou MCP</p></details><div className="dialog-footer"><button className="button secondary" disabled={task.archived} onClick={() => { setTasks(old => old.map(t => t.id === task.id ? { ...t, status: 'stopped' } : t)); setModal({ type: 'resume' }); }}>切换 AI 配置恢复</button></div></Dialog>}
    {modal?.type === 'resume' && task && !task.archived && <Dialog title="恢复任务" subtitle="保留同一运行器，可选择另一套 AI 配置。" onClose={() => setModal(null)}><form onSubmit={e => { e.preventDefault(); const key = new FormData(e.currentTarget).get('profile'); if (!key) return; setTasks(old => old.map(t => t.id === task.id ? { ...t, profile: key, status: 'running' } : t)); setModal(null); }}><label className="field">AI 配置<select name="profile" defaultValue={task.profile}>{profiles.filter(p => p.runner === (profiles.find(x => x.id === task.profile)?.runner || task.runner || 'claude')).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><p className="notice">跨配置恢复时，模型能力可能不同。本页仅演示恢复流程。</p><button className="text-button" onClick={() => { setModal(null); nav('settings/ai'); }} type="button">管理 AI 配置</button><div className="dialog-footer"><button className="button primary" disabled={!profiles.some(p => p.runner === (profiles.find(x => x.id === task.profile)?.runner || task.runner || 'claude'))}>恢复任务</button></div></form></Dialog>}
    {modal?.type === 'launch-settings' && <Dialog title="任务配置" subtitle={project.name} onClose={() => setModal(null)} className="parity-dialog"><label className="field">代码目录<select value={dir?.id || ''} onChange={e => setDirId(e.target.value)}>{project.dirs.map(d => <option key={d.id} value={d.id}>{d.label || d.path}{d.isDefault ? ' · 默认' : ''}</option>)}</select></label><code>{dir?.path || '尚未添加代码目录'}</code><label className="field">AI 配置<select value={profile?.id || ''} onChange={e => setProfileId(e.target.value)}>{profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><div className="notice"><h3>启动前能力预览</h3><p>{project.capabilities.db ? '数据库诊断 · ' : ''}{project.capabilities.ssh ? 'SSH · ' : ''}{project.capabilities.mcp ? '项目上下文 MCP' : ''}</p><p>配置版本 v{project.configVersion || 1} · 会话加载尚未核验</p></div><div className="dialog-footer"><button className="button secondary" onClick={() => { setModal(null); project.id ? nav('project/' + project.id) : setModal({ type: 'project' }); }}>项目设置</button><button className="button secondary" onClick={() => { setModal(null); nav('settings/ai'); }}>管理 AI 配置</button><button className="button primary" onClick={() => setModal(null)}>完成</button></div></Dialog>}
    {modal?.type === 'import' && <ImportProfilesDialog profiles={profiles} onClose={() => setModal(null)} onImport={items => setProfiles(old => [...old, ...items])} />}
    {modal?.type === 'shortcuts' && <Dialog title="快捷键" onClose={() => setModal(null)}><div className="info-list"><div><span>新建任务</span><kbd>⌘ N</kbd></div><div><span>搜索任务</span><kbd>⌘ K</kbd></div><div><span>启动任务</span><kbd>⌘ Enter</kbd></div><div><span>关闭弹窗</span><kbd>Esc</kbd></div></div></Dialog>}
    {modal?.type === 'preview' && <Dialog title="WillYou 界面预览" subtitle="先确认界面，再接入现有功能。" onClose={() => setModal(null)}><div className="preview-description"><p>本版演示以 Codex 的界面规则重新组织 WillYou 的侧栏、首页、任务页外层、项目页和设置页。</p><p>M8 新增加密导出、接收方解锁预览与路径调整的交互演示。入口在项目“＋”和项目菜单；没有读取真实文件或保存凭据。</p><p>M7 新增语音按钮、Typeless 设置与全局快捷键的交互演示。顶部“M7 · 语音预览”可切换异常场景；没有调用本机 Typeless 或录音。</p><p>中央工作区保留终端。你可以切换页面、添加 Codex 配置、创建示例任务、搜索任务、切换主题，并在演示终端输入命令。</p><p>所有项目、配置、检测和任务结果均为示例，只在本次页面中生效。不会启动模型、读取个人配置或连接数据库、服务器。</p></div><div className="dialog-footer"><button className="button primary" onClick={() => setModal(null)}>开始查看</button></div></Dialog>}
  </div>;
}
