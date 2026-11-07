import { createContext, useContext, useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import { THEMES, type Theme } from '@shared/app-settings';
import { useAppSettingsKey } from '@renderer/lib/hooks/useAppSettingsKey';

/** Read by public/theme-init.js before first paint; keep the key in sync. */
const THEME_CACHE_KEY = 'smartdd-theme';

const darkQuery = () => window.matchMedia('(prefers-color-scheme: dark)');

function useSystemTheme(): Theme {
  const [theme, setTheme] = useState<Theme>(() => (darkQuery().matches ? 'ydark' : 'ylight'));
  useEffect(() => {
    const mq = darkQuery();
    const onChange = () => setTheme(mq.matches ? 'ydark' : 'ylight');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return theme;
}

interface ThemeContextValue {
  /** `null` = follow the system. `undefined` while the setting is loading. */
  theme: Theme | null | undefined;
  effectiveTheme: Theme;
  setTheme: (theme: Theme | null) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function cachedTheme(): Theme | null {
  try {
    const raw = localStorage.getItem(THEME_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return (THEMES as readonly string[]).includes(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { value, update } = useAppSettingsKey('theme');
  const systemTheme = useSystemTheme();
  // Until the DB answers, keep whatever theme-init.js painted.
  const preference = value === undefined ? cachedTheme() : value;
  const effectiveTheme = preference ?? systemTheme;

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.classList.remove(...THEMES);
    root.classList.add(effectiveTheme);
  }, [effectiveTheme]);

  useEffect(() => {
    if (value !== undefined) localStorage.setItem(THEME_CACHE_KEY, JSON.stringify(value));
  }, [value]);

  return (
    <ThemeContext.Provider value={{ theme: value, effectiveTheme, setTheme: (t) => update(t) }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
