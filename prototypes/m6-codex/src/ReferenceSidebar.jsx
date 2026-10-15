import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Archive, ArchiveRestore, ChevronDown, Ellipsis, Folder, FolderOpen, History, MessageCircle, Pencil, Plus, Search, Settings, SquarePen, Trash2 } from 'lucide-react';

function Popup({ position, children, onClose, className = '' }) {
  const ref = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    ref.current?.focus();
    const close = () => onClose();
    window.addEventListener('resize', close);
    return () => { window.removeEventListener('resize', close); previous?.focus?.(); };
  }, []);
  return createPortal(<><button className="menu-scrim" aria-label="关闭菜单" onClick={onClose} onContextMenu={e => { e.preventDefault(); onClose(); }} />
    <div ref={ref} role="menu" tabIndex={-1} className={'reference-popup ' + className} style={{ left: position.x, top: position.y }} onKeyDown={e => {
      if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); onClose(); }
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
        e.preventDefault(); const buttons = [...ref.current.querySelectorAll('button:not(:disabled)')];
        const index = buttons.indexOf(document.activeElement);
        const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (index + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
      }
    }}>{children}</div></>, document.body);
}

export function ReferenceSidebar({ projects, tasks, activeProject, activeTaskId, route, collapsed, closedProjects, onToggleProject, onHome, onSearch, onSelectProject, onOpenTask, onCreateProject, onEditProject, onRenameTask, onArchiveTask, onDeleteTask, onSettings, onInfo }) {
  const [menu, setMenu] = useState(null);
  const [showArchived, setShowArchived] = useState(false), [showArchivedProjects, setShowArchivedProjects] = useState(false);
  const close = () => setMenu(null);
  useEffect(() => { close(); }, [route]);
  const open = (event, type, item, context = false) => {
    event.preventDefault(); event.stopPropagation();
    const row = event.currentTarget.closest('[data-sidebar-row]') || event.currentTarget;
    const trigger = event.currentTarget.matches('button') ? event.currentTarget : row.querySelector('button');
    trigger?.focus({ preventScroll: true });
    const rect = row.getBoundingClientRect();
    const width = type === 'project' ? 320 : 204;
    const height = type === 'project' ? 150 : 112;
    setMenu({ type, item, x: Math.max(8, Math.min(innerWidth - width - 8, context ? event.clientX : type === 'project' ? rect.right + 3 : rect.right - width + 4)), y: Math.max(8, Math.min(innerHeight - height - 8, context ? event.clientY : type === 'project' ? rect.top : rect.top + 24)) });
  };
  const taskRow = t => <div data-sidebar-row key={t.id} className={'reference-task-row ' + (activeTaskId === t.id || menu?.item.id === t.id ? 'selected' : '')} onContextMenu={e => open(e, 'task', t, true)}>
    <button className="reference-task-title" title={t.title} onClick={() => onOpenTask(t.id)}>{t.title}</button>
    <span className={'task-state-tail ' + (t.status === 'running' ? 'running' : '')} title={t.status === 'running' ? '运行中' : t.time}>{t.status === 'running' ? '' : t.time}</span>
    <button className="row-action task-more" title={'更多操作：' + t.title} aria-label={'更多操作：' + t.title} aria-haspopup="menu" aria-expanded={menu?.type === 'task' && menu.item.id === t.id} onClick={e => open(e, 'task', t)}><Ellipsis size={16} /></button>
  </div>;
  return <aside className={'sidebar reference-sidebar ' + (collapsed ? 'is-collapsed' : '')} aria-label="项目与任务">
    <div className="reference-sidebar-head"><button className="workspace-picker" onClick={onInfo}>SmartDD<ChevronDown size={13} /></button><button className="row-action" aria-label="任务历史" onClick={onSearch}><History size={16} /></button><button className="row-action" aria-label="搜索任务" onClick={onSearch}><Search size={16} /></button></div>
    <nav className="reference-primary"><button className="nav-row" onClick={() => onHome()}><SquarePen size={16} />新建任务</button><button className="nav-row" onClick={onSearch}><History size={16} />任务历史<span className="history-count">{tasks.filter(t => t.status === 'running').length}</span></button></nav>
    <div className="reference-projects"><div className="reference-project-heading"><span>项目<ChevronDown size={13} /></span><button className="row-action" aria-label="添加项目" onClick={onCreateProject}><Plus size={15} /></button></div>
      {projects.filter(p => !p.archived).map(p => <div className="reference-project-group" key={p.id}><div data-sidebar-row className={'reference-project-row ' + (activeProject === p.id || menu?.item.id === p.id ? 'selected' : '')} onContextMenu={e => open(e, 'project', p)}>
        <button className="reference-project-toggle" aria-label={(closedProjects.includes(p.id) ? '展开' : '折叠') + p.name} onClick={() => onToggleProject(p.id)}>{closedProjects.includes(p.id) ? <Folder size={16} /> : <FolderOpen size={16} />}</button>
        <button className="reference-project-name" title={p.name} onClick={() => onSelectProject(p.id)}>{p.name}</button>
        <div className="row-actions"><button className="row-action" aria-label={'项目菜单：' + p.name} title="项目详情" aria-haspopup="menu" aria-expanded={menu?.type === 'project' && menu.item.id === p.id} onClick={e => open(e, 'project', p)}><Ellipsis size={16} /></button><button className="row-action" aria-label={'在 ' + p.name + ' 新建任务'} title="新建任务" onClick={() => onHome(p.id)}><SquarePen size={15} /></button></div>
      </div>{!closedProjects.includes(p.id) && <div className="reference-project-tasks">{tasks.filter(t => t.project === p.id && !t.archived).map(taskRow)}{!tasks.some(t => t.project === p.id && !t.archived) && <p className="sidebar-empty">还没有任务</p>}</div>}</div>)}
      {projects.some(p => p.archived) && <div className="archived-tasks"><button className="nav-row" onClick={() => setShowArchivedProjects(!showArchivedProjects)}><Archive size={16} />已归档项目<ChevronDown size={13} /></button>{showArchivedProjects && projects.filter(p => p.archived).map(p => <button key={p.id} className="nav-row" onClick={() => onEditProject(p)}><Folder size={16} />{p.name}</button>)}</div>}
      {tasks.some(t => !projects.some(p => p.id === t.project) && !t.archived) && <div className="archived-tasks"><p className="sidebar-empty">未关联项目</p>{tasks.filter(t => !projects.some(p => p.id === t.project) && !t.archived).map(taskRow)}</div>}
      {tasks.some(t => t.archived) && <div className="archived-tasks"><button className="nav-row" onClick={() => setShowArchived(!showArchived)}><Archive size={16} />已归档<ChevronDown size={13} /></button>{showArchived && tasks.filter(t => t.archived).map(taskRow)}</div>}
    </div>
    <button className="reference-sidebar-settings" onClick={onSettings}><Settings size={16} />设置</button>
    {menu?.type === 'project' && <Popup className="project-detail-popup" position={menu} onClose={close}>
      <button role="menuitem" className="popup-project-title" onClick={() => { onEditProject(menu.item); close(); }}><Folder size={16} /><span>{menu.item.name}</span></button>
      <div className="popup-meta"><MessageCircle size={15} /><span>{tasks.filter(t => t.project === menu.item.id && !t.archived).length} 个任务</span></div>
      <div className="popup-divider" /><div className="popup-meta popup-project-path" title={menu.item.path}><Folder size={15} /><span>{menu.item.path}</span></div><div className="popup-divider" />
      <button role="menuitem" onClick={() => { onEditProject(menu.item); close(); }}><Settings size={16} />编辑项目</button>
    </Popup>}
    {menu?.type === 'task' && <Popup position={menu} onClose={close}>
      <button role="menuitem" onClick={() => { onRenameTask(menu.item); close(); }}><Pencil size={15} />重命名</button>
      <button role="menuitem" onClick={() => { onArchiveTask(menu.item); close(); }}>{menu.item.archived ? <ArchiveRestore size={15} /> : <Archive size={15} />}{menu.item.archived ? '取消归档' : '归档'}</button>
      <div className="popup-divider" />
      <button role="menuitem" onClick={() => { onDeleteTask(menu.item); close(); }}><Trash2 size={15} />删除任务</button>
    </Popup>}
  </aside>;
}
