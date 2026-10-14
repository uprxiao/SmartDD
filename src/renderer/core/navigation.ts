import { makeAutoObservable } from 'mobx';

/** The view registry: every top-level view the main area can show. */
export const VIEW_IDS = ['home', 'task', 'settings', 'project'] as const;
export type ViewId = (typeof VIEW_IDS)[number];

export type SettingsSectionId = 'general' | 'appearance' | 'terminal' | 'aiProfiles';

class NavigationStore {
  currentViewId: ViewId = 'home';
  /** The project the 'project' view shows. */
  currentProjectId: string | null = null;
  /** The task the 'task' view shows. */
  currentTaskId: string | null = null;
  /** "New task" under a project preselects it on the home page; bumped so the same project re-applies. */
  homePreset: { projectId: string; seq: number } | null = null;
  settingsSection: SettingsSectionId = 'general';
  /** ⌘K task search. */
  searchOpen = false;

  constructor() {
    makeAutoObservable(this);
  }

  navigate(viewId: ViewId): void {
    this.currentViewId = viewId;
  }

  newTask(projectId?: string): void {
    if (projectId) this.homePreset = { projectId, seq: (this.homePreset?.seq ?? 0) + 1 };
    this.currentViewId = 'home';
  }

  openTask(id: string): void {
    this.currentTaskId = id;
    this.currentViewId = 'task';
  }

  setSearchOpen(open: boolean): void {
    this.searchOpen = open;
  }

  openSettings(section?: SettingsSectionId): void {
    if (section) this.settingsSection = section;
    this.currentViewId = 'settings';
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

  closeTask(id: string): void {
    if (this.currentTaskId !== id) return;
    this.currentTaskId = null;
    if (this.currentViewId === 'task') this.currentViewId = 'home';
  }
}

export const navigation = new NavigationStore();
