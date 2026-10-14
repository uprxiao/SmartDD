import type { SmartddApi } from '../shared/types';

declare global {
  interface Window {
    smartdd: SmartddApi;
  }
}

export {};
