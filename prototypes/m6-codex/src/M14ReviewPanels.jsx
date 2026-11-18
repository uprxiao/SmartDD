import { Archive, ArchiveRestore, Folder, GitBranch } from 'lucide-react';
import { Dialog } from './PreviewUI';

export function ArchivedTasksPanel({ projects, tasks, onOpen, onRestore }) {
  const groups = projects.map(project => ({ project, tasks: tasks.filter(task => task.project === project.id && task.archived && (!task.parentId || !tasks.some(parent => parent.id === task.parentId && parent.archived))) })).filter(group => group.tasks.length);
  return <div className="settings-inner m14-archive-settings">
    <h2>已归档任务</h2>
    {groups.length === 0 && <div className="m14-archive-empty"><Archive size={22} /><p>还没有已归档任务</p></div>}
    {groups.map(({ project, tasks: rows }) => <section key={project.id} className="m14-archive-group">
      <h3><Folder size={16} />{project.name}{project.archived && <small>已归档项目</small>}</h3>
      {rows.map(task => <div className="m14-archive-row" key={task.id}>
        <button type="button" className="m14-archive-open" onClick={() => onOpen(task.id)}><b>{task.title}</b><small>{task.runner === 'codex' ? 'Codex' : 'Claude Code'} · {task.archivedAt || '11 月 18 日 10:24'}</small></button>
        <button type="button" className="button secondary" onClick={() => onRestore(task)}><ArchiveRestore size={14} />恢复</button>
      </div>)}
    </section>)}
  </div>;
}

export function M14ProjectDeleteDialog({ project, tasks, onClose, onConfirm }) {
  const blocked = tasks.filter(task => task.status === 'running' || task.pending);
  const dirs = [...new Set([project.path, ...project.dirs.map(dir => dir.path)].filter(Boolean))];
  const worktrees = [...new Set(tasks.map(task => task.worktree).filter(Boolean))];
  return <Dialog title={blocked.length ? '项目暂时无法删除' : `删除项目“${project.name}”？`} onClose={onClose} className="m14-project-delete">
    {blocked.length ? <>
      <p>处理以下任务后可重试。项目和任务记录仍然保留。</p>
      <ul className="m14-delete-paths">{blocked.map(task => <li key={task.id}><b>{task.title}</b><small>{task.pending ? '等待批准 · 请处理待办请求' : '运行中 · 请等待任务完成或停止任务'}</small></li>)}</ul>
    </> : <>
      <p>将删除 <b>{tasks.length} 个 Agent 任务</b>，其中 {tasks.filter(task => task.archived).length} 个已归档。WillYou 中的对话、差异和附件副本会被清除，无法恢复。</p>
      <div className="m14-delete-retain">
        <b>保留的内容</b>
        <ul className="m14-delete-paths">
          {dirs.map(path => <li key={path}><Folder size={14} /><span><small>代码目录</small><code>{path}</code></span></li>)}
          {worktrees.map(path => <li key={path}><GitBranch size={14} /><span><small>子任务工作副本及分支</small><code>{path}</code></span></li>)}
          <li>Codex／Claude 原生会话文件和应用调用记录</li>
        </ul>
      </div>
      <p>想保留记录，请改用“归档项目”。</p>
      <label className="m14-delete-secret"><input name="deleteSecrets" type="checkbox" />同时删除已加密保存的密码</label>
    </>}
    <div className="dialog-footer"><button type="button" className="button secondary" onClick={onClose}>{blocked.length ? '关闭' : '取消'}</button>{blocked.length === 0 && <button type="button" className="button danger" onClick={onConfirm}>删除项目</button>}</div>
  </Dialog>;
}
