import type {ApplicationActivityQuery} from '@shared/application-activity';
import { makeAutoObservable } from 'mobx';
import { normalizedFilePanelWidth, readFilePanelWidthPreference } from '@shared/file-panel-layout.mjs';

/** The view registry: every top-level view the main area can show. */
export const VIEW_IDS = ['home', 'task', 'settings', 'project', 'scheduled', 'apps'] as const;
export type ViewId = (typeof VIEW_IDS)[number];

export type ApplicationPage = 'catalog' | 'zentao' | 'mail' | 'projects' | 'activity';
export type ProjectSectionId = 'overview' | 'dirs' | 'databases' | 'servers' | 'capabilities' | 'applications' | 'tasks';

export type SettingsSectionId = 'general' | 'appearance' | 'terminal' | 'aiProfiles' | 'capabilities' | 'shortcuts' | 'voice' | 'about' | 'applications';

class NavigationStore {
  currentViewId: ViewId = 'home';
  applicationPage: ApplicationPage = 'catalog';
  activityFilter:ApplicationActivityQuery={};
  projectSection: ProjectSectionId = 'overview';
  /** The project the 'project' view shows. */
  currentProjectId: string | null = null;
  /** The task the 'task' view shows. */
  currentTaskId: string | null = null;
  /** "New task" under a project preselects it on the home page; bumped so the same project re-applies. */
  homePreset: { projectId: string; seq: number; applicationPrompt?:string } | null = null;
  settingsSection: SettingsSectionId = 'general';
  /** ⌘K task search. */
  searchOpen = false;
  filePanelOpen = typeof localStorage !== 'undefined' && localStorage.getItem('willyou-file-panel-open') === 'true';
  filePanelWidthPreference = readFilePanelWidthPreference(typeof localStorage === 'undefined' ? null : localStorage.getItem('willyou-file-panel-width'));
  sidebarWidth = typeof localStorage === 'undefined' ? 240 : Math.max(240, Math.min(420, Number(localStorage.getItem('smartdd-sidebar-width')) || 240));

  constructor() {
    makeAutoObservable(this);
  }

  setSidebarWidth(width: number): void {
    this.sidebarWidth = Math.max(240, Math.min(420, width));
    if (typeof localStorage !== 'undefined') localStorage.setItem('smartdd-sidebar-width', String(this.sidebarWidth));
  }

  navigate(viewId: ViewId): void {
    this.currentViewId = viewId;
  }

  newTask(projectId?: string): void {
    if (projectId) this.homePreset = { projectId, seq: (this.homePreset?.seq ?? 0) + 1 };
    this.currentViewId = 'home';
  }

  prepareApplicationTask(projectId:string,prompt:string):void{this.newTask(projectId);this.homePreset={...this.homePreset!,applicationPrompt:prompt};}
  consumeApplicationPrompt(seq:number):string|undefined{if(this.homePreset?.seq!==seq)return;const value=this.homePreset.applicationPrompt;if(value)this.homePreset={projectId:this.homePreset.projectId,seq};return value;}

  openTask(id: string): void {
    this.currentTaskId = id;
    this.currentViewId = 'task';
  }

  setSearchOpen(open: boolean): void {
    this.searchOpen = open;
  }
  toggleFilePanel(): void {
    this.filePanelOpen = !this.filePanelOpen;
    if (typeof localStorage !== 'undefined') localStorage.setItem('willyou-file-panel-open', String(this.filePanelOpen));
  }
  setFilePanelWidth(width: number, available: number): void {
    const preference = normalizedFilePanelWidth(width, available);
    if (!preference) return;
    this.filePanelWidthPreference = preference;
    if (typeof localStorage !== 'undefined') localStorage.setItem('willyou-file-panel-width', String(preference.value));
  }
  migrateFilePanelWidth(available: number): void {
    if (this.filePanelWidthPreference.unit === 'pixels') this.setFilePanelWidth(this.filePanelWidthPreference.value, available);
  }

  openSettings(section?: SettingsSectionId): void {
    if (section) this.settingsSection = section;
    this.currentViewId = 'settings';
  }

  openApplications(page:ApplicationPage='catalog',projectId?:string):void {
    if(projectId)this.currentProjectId=projectId;
    this.applicationPage=page;this.currentViewId='apps';
  }

  openApplicationActivity(filter:ApplicationActivityQuery={}):void{this.activityFilter=filter;this.applicationPage='activity';this.currentViewId='apps';}

  setProjectSection(section:ProjectSectionId):void{this.projectSection=section;}

  openProject(id: string,section:ProjectSectionId='overview'): void {
    this.projectSection=section;
    this.currentProjectId = id;
    this.currentViewId = 'project';
  }

  selectHomeProject(id: string | null): void {
    this.currentProjectId = id;
  }

  /** After a delete: leave the view instead of showing a project that no longer exists. */
  closeProject(id: string): void {
    if (this.homePreset?.projectId === id) this.homePreset = null;
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
