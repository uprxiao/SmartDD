// P09 identity guards only; synthetic terminal state is never a host permission.
export function capturePreviewTerminal(tasks, projectId, currentTaskId) {
  const eligible=tasks.filter(t=>t.project===projectId&&t.status==='running'&&!t.archived);
  const task=currentTaskId?eligible.find(t=>t.id===currentTaskId):eligible.length===1?eligible[0]:null;
  return task?{taskId:task.id,ptyId:task.ptyId??task.id,projectId}:null;
}
export function previewTerminalCurrent(target,tasks,projectId,currentTaskId) {
  if(!target||target.projectId!==projectId||currentTaskId&&currentTaskId!==target.taskId)return false;
  const task=tasks.find(t=>t.id===target.taskId);
  return !!task&&task.project===projectId&&task.status==='running'&&!task.archived&&(task.ptyId??task.id)===target.ptyId;
}
export function previewReferenceCurrent(binding,tasks,projectId,currentTaskId,connections) {
  return !!binding&&previewTerminalCurrent(binding.target,tasks,projectId,currentTaskId)
    &&connections.some(c=>c.id===binding.connectionId&&c.revision===binding.connectionRevision);
}
