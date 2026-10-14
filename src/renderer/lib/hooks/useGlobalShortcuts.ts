import { useEffect } from 'react';
import { navigation } from '@renderer/core/navigation';

/**
 * ⌘N / ⌘K are registered in the renderer, as in Yoda (not menu accelerators). Capture phase so
 * they win over a focused terminal, which would otherwise send the keys to the CLI.
 */
export function useGlobalShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const key = e.key.toLowerCase();
      if (key === 'n') navigation.newTask();
      else if (key === 'k') navigation.setSearchOpen(!navigation.searchOpen);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
}
