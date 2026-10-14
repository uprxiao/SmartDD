import { makeAutoObservable } from 'mobx';

/** The view registry: every top-level view the main area can show. */
export const VIEW_IDS = ['home', 'terminal', 'settings'] as const;
export type ViewId = (typeof VIEW_IDS)[number];

class NavigationStore {
  currentViewId: ViewId = 'home';

  constructor() {
    makeAutoObservable(this);
  }

  navigate(viewId: ViewId): void {
    this.currentViewId = viewId;
  }
}

export const navigation = new NavigationStore();
