import { makeAutoObservable } from 'mobx';

/** The view registry: every top-level view the main area can show. */
export const VIEW_IDS = ['home', 'terminal', 'settings', 'project'] as const;
export type ViewId = (typeof VIEW_IDS)[number];

class NavigationStore {
  currentViewId: ViewId = 'home';
  /** The project the 'project' view shows. */
  currentProjectId: string | null = null;

  constructor() {
    makeAutoObservable(this);
  }

  navigate(viewId: ViewId): void {
    this.currentViewId = viewId;
  }

  openProject(id: string): void {
    this.currentProjectId = id;
    this.currentViewId = 'project';
  }

  /** After a delete: leave the view instead of showing a project that no longer exists. */
  closeProject(id: string): void {
    if (this.currentProjectId !== id) return;
    this.currentProjectId = null;
    if (this.currentViewId === 'project') this.currentViewId = 'home';
  }
}

export const navigation = new NavigationStore();
