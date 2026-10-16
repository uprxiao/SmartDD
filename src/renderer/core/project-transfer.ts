import { makeAutoObservable } from 'mobx';

class ProjectTransferNavigation {
  current: { mode: 'import' | 'export'; projectId?: string; key: number; returnFocus?: HTMLElement | null } | null = null;
  private sequence = 0;
  constructor() { makeAutoObservable(this); }
  openImport(returnFocus?: HTMLElement | null) { this.current = { mode: 'import', key: ++this.sequence, returnFocus }; }
  openExport(projectId: string, returnFocus?: HTMLElement | null) { this.current = { mode: 'export', projectId, key: ++this.sequence, returnFocus }; }
  close() { this.current = null; }
}
export const projectTransferNavigation = new ProjectTransferNavigation();
