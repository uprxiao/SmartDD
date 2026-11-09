import { fileCloseEvent } from '@shared/events';
import { rpcErrorMessage } from '@shared/ipc/rpc';
import { events, rpc } from '@renderer/lib/ipc';
import { openFileBuffers } from './workspace-store';

/** The renderer stays alive and stops accepting new edits while main awaits
 * durable save receipts. beforeunload is only a veto, never an async flush. */
export function installFileCloseHost(): () => void {
  let allowed = false, active: string | null = null;
  const root = document.getElementById('root');
  const overlay = document.createElement('div'); overlay.className = 'fw-closing-overlay'; overlay.setAttribute('role', 'status'); overlay.setAttribute('aria-live', 'polite');
  const unlock = () => { active = null; allowed = false; if (root) root.inert = false; overlay.remove(); };
  const unload = (event: BeforeUnloadEvent) => { if (!allowed && openFileBuffers().some((buffer) => buffer.dirty || buffer.saving || buffer.recoveryBlocked)) { event.preventDefault(); event.returnValue = ''; } };
  window.addEventListener('beforeunload', unload);
  const off = events.on(fileCloseEvent, (request) => {
    if (request.action === 'resume') { unlock(); return; }
    if (request.action === 'commit') {
      allowed = true;
      void rpc.files.answerClose({ id: request.id, ready: true, failures: [] }).catch(unlock);
      return;
    }
    active = request.id; allowed = false;
    if (root) root.inert = true;
    overlay.textContent = request.action === 'save' ? '正在保存文件…' : '正在处理未保存修改…'; document.body.append(overlay);
    const action = request.action;
    void (async () => {
      const failures: { name: string; message: string }[] = [];
      for (const buffer of openFileBuffers()) {
        if (active !== request.id) return;
        try { if (!await buffer.prepareClose(action)) failures.push({ name: buffer.file.absolutePath, message: buffer.saveError || buffer.draftError || '文件有未解决的保存或版本冲突' }); }
        catch (error) { failures.push({ name: buffer.file.absolutePath, message: rpcErrorMessage(error).slice(0, 4096) }); }
      }
      if (active !== request.id) return;
      try { await rpc.files.answerClose({ id: request.id, ready: failures.length === 0, failures: failures.slice(0, 200) }); }
      catch { if (active === request.id) unlock(); }
    })();
  });
  return () => { off(); window.removeEventListener('beforeunload', unload); unlock(); };
}
