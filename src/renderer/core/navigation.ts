import type {ApplicationId} from '@shared/application-connections';
import type {ApplicationActivityQuery} from '@shared/application-activity';
import { makeAutoObservable } from 'mobx';
import { normalizedFilePanelWidth, readFilePanelWidthPreference } from '@shared/file-panel-layout.mjs';

/** The view registry: every top-level view the main area can show. */
export const VIEW_IDS = ['home', 'agentTask', 'settings', 'project', 'scheduled', 'apps'] as const;
export type ViewId = (typeof VIEW_IDS)[number];

export type ApplicationPage = 'catalog' | 'skills' | 'projects' | 'activity' | ApplicationId | `plugin:${string}`;
export type ProjectSectionId = 'overview' | 'dirs' | 'databases' | 'servers' | 'capabilities' | 'applications' | 'tasks';

export type SettingsSectionId = 'general' | 'appearance' | 'terminal' | 'aiProfiles' | 'capabilities' | 'shortcuts' | 'voice' | 'about' | 'applications' | 'archivedAgentTasks';

interface HomeLaunchAttempt { key: string; taskId: string; inputId: string }

class NavigationStore {
  currentViewId: ViewId = 'home';
  applicationPage: ApplicationPage = 'catalog';
  activityFilter:ApplicationActivityQuery={};
  projectSection: ProjectSectionId = 'overview';
  /** The project the 'project' view shows. */
  currentProjectId: string | null = null;
  /** M14 新任务区显示的任务。 */
  currentAgentTaskId: string | null = null;
  agentTaskReadOnly = false;
  applicationAgentTaskId:string|null=null;
  /** "New task" under a project preselects it on the home page; bumped so the same project re-applies. */
  homePreset: { projectId: string; seq: number; applicationPrompt?:string } | null = null;
  /** Unsubmitted composer text, kept in memory across views and scoped to its project. */
  homeInputDrafts = new Map<string | null, { text: string; revision: number; goalMode?: boolean }>();
  private homeInputSequence = 0;
  homeLaunchAttempts = new Map<string, HomeLaunchAttempt>();
  pluginPromptRequest:{seq:number;prompt:string}|null=null;
  private pluginPromptSequence=0;
  settingsSection: SettingsSectionId = 'general';
  agentProviderRequest:{id:string;seq:number}|null=null;
  private agentProviderSequence=0;
  /** ⌘K task search. */
  searchOpen = false;
  private savedFilePanelOpen = typeof localStorage !== 'undefined' && localStorage.getItem('willyou-file-panel-open') === 'true';
  private homeFilePanelOpen = false;
  get filePanelOpen(): boolean {
    return this.currentViewId === 'home' ? this.homeFilePanelOpen : this.savedFilePanelOpen;
  }
  filePanelWidthPreference = readFilePanelWidthPreference(typeof localStorage === 'undefined' ? null : localStorage.getItem('willyou-file-panel-width'));
  directoryPanelWidthPreference = readFilePanelWidthPreference(typeof localStorage === 'undefined' ? null : localStorage.getItem('willyou-directory-panel-width'), true);
  sidebarWidth = typeof localStorage === 'undefined' ? 240 : Math.max(240, Math.min(420, Number(localStorage.getItem('smartdd-sidebar-width')) || 240));
  collapsedSidebarProjects = new Set<string>();

  constructor() {
    makeAutoObservable(this);
  }

  setSidebarWidth(width: number): void {
    this.sidebarWidth = Math.max(240, Math.min(420, width));
    if (typeof localStorage !== 'undefined') localStorage.setItem('smartdd-sidebar-width', String(this.sidebarWidth));
  }

  toggleSidebarProject(projectId: string): void {
    if (this.collapsedSidebarProjects.has(projectId)) this.collapsedSidebarProjects.delete(projectId);
    else this.collapsedSidebarProjects.add(projectId);
  }

  navigate(viewId: ViewId): void {
    if (viewId === 'home') this.homeFilePanelOpen = false;
    this.currentViewId = viewId;
  }

  newTask(projectId?: string): void {
    if (projectId) this.homePreset = { projectId, seq: (this.homePreset?.seq ?? 0) + 1 };
    this.applicationAgentTaskId=null;this.navigate('home');
  }

  prepareApplicationTask(projectId:string,prompt:string):void{this.newTask(projectId);this.homePreset={...this.homePreset!,applicationPrompt:prompt};}
  preparePluginTask(prompt:string):void{this.pluginPromptRequest={seq:++this.pluginPromptSequence,prompt};this.navigate('home');}
  consumePluginPrompt(seq:number):string|undefined{if(this.pluginPromptRequest?.seq!==seq)return;const prompt=this.pluginPromptRequest.prompt;this.pluginPromptRequest=null;return prompt;}
  consumeApplicationPrompt(seq:number):string|undefined{if(this.homePreset?.seq!==seq)return;const value=this.homePreset.applicationPrompt;if(value)this.homePreset={projectId:this.homePreset.projectId,seq};return value;}
  homeInput(projectId: string | null): string { return this.homeInputDrafts.get(projectId)?.text ?? ''; }
  homeInputRevision(projectId: string | null): number { return this.homeInputDrafts.get(projectId)?.revision ?? 0; }
  homeGoalMode(projectId: string | null): boolean { return this.homeInputDrafts.get(projectId)?.goalMode === true; }
  setHomeInput(projectId: string | null, text: string, goalMode = this.homeGoalMode(projectId)): void {
    if (this.homeInput(projectId) !== text || this.homeGoalMode(projectId) !== goalMode) {
      this.homeInputDrafts.set(projectId, { text, revision: ++this.homeInputSequence, goalMode });
    }
  }

  openAgentTask(id: string, readOnly = false): void {
    this.agentTaskReadOnly = readOnly;
    this.currentAgentTaskId = id;
    this.currentViewId = 'agentTask';
  }

  setAgentTaskReadOnly(id: string, readOnly:boolean): void {
    if (this.currentAgentTaskId===id) this.agentTaskReadOnly=readOnly;
  }

  setSearchOpen(open: boolean): void {
    this.searchOpen = open;
  }
  toggleFilePanel(): void {
    if (this.currentViewId === 'home') {
      this.homeFilePanelOpen = !this.homeFilePanelOpen;
      return;
    }
    this.savedFilePanelOpen = !this.savedFilePanelOpen;
    if (typeof localStorage !== 'undefined') localStorage.setItem('willyou-file-panel-open', String(this.savedFilePanelOpen));
  }
  setFilePanelWidth(width: number, available: number, directoryOnly = false): void {
    const preference = normalizedFilePanelWidth(width, available, directoryOnly);
    if (!preference) return;
    if (directoryOnly) this.directoryPanelWidthPreference = preference;
    else this.filePanelWidthPreference = preference;
    if (typeof localStorage !== 'undefined') localStorage.setItem(directoryOnly ? 'willyou-directory-panel-width' : 'willyou-file-panel-width', String(preference.value));
  }
  migrateFilePanelWidth(available: number): void {
    if (this.filePanelWidthPreference.unit === 'pixels') this.setFilePanelWidth(this.filePanelWidthPreference.value, available);
  }

  openSettings(section?: SettingsSectionId): void {
    if (section) this.settingsSection = section;
    this.currentViewId = 'settings';
  }

  openAgentProvider(id:string):void{this.openSettings('aiProfiles');this.agentProviderRequest={id,seq:++this.agentProviderSequence};}
  consumeAgentProviderRequest(seq:number):void{if(this.agentProviderRequest?.seq===seq)this.agentProviderRequest=null;}

  openApplications(page:ApplicationPage='catalog',projectId?:string):void {
    if(this.currentViewId==='agentTask')this.applicationAgentTaskId=this.currentAgentTaskId;else if(!['apps','project'].includes(this.currentViewId))this.applicationAgentTaskId=null;
    if(projectId)this.currentProjectId=projectId;
    this.applicationPage=page;this.currentViewId='apps';
  }

  openApplicationActivity(filter:ApplicationActivityQuery={}):void{this.activityFilter=filter;this.applicationPage='activity';this.currentViewId='apps';}

  setProjectSection(section:ProjectSectionId):void{this.projectSection=section;}

  openProject(id: string,section:ProjectSectionId='overview'): void {
    if(this.currentViewId==='agentTask')this.applicationAgentTaskId=this.currentAgentTaskId;else if(!['apps','project'].includes(this.currentViewId))this.applicationAgentTaskId=null;
    this.projectSection=section;
    this.currentProjectId = id;
    this.currentViewId = 'project';
  }

  selectHomeProject(id: string | null): void {
    this.currentProjectId = id;
  }

  /** After a delete: leave the view instead of showing a project that no longer exists. */
  closeProject(id: string): void {
    this.homeInputDrafts.delete(id);
    this.homeLaunchAttempts.delete(id);
    this.collapsedSidebarProjects.delete(id);
    if (this.homePreset?.projectId === id) this.homePreset = null;
    if (this.currentProjectId !== id) return;
    this.currentProjectId = null;
    if (this.currentViewId === 'project') this.navigate('home');
  }

}

export const navigation = new NavigationStore();
