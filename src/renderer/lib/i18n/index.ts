import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { SUPPORTED_LANGUAGES, type Language } from '@shared/app-settings';
import { en, zhCN } from './locales';

/** localStorage mirror of `general.language` so the first render already has the right language. */
const LANGUAGE_CACHE_KEY = 'smartdd-language';

function cachedLanguage(): Language {
  const raw = localStorage.getItem(LANGUAGE_CACHE_KEY);
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(raw ?? '') ? (raw as Language) : 'zh-CN';
}

void i18n.use(initReactI18next).init({
  resources: { 'zh-CN': { translation: zhCN }, en: { translation: en } },
  lng: cachedLanguage(),
  fallbackLng: 'zh-CN',
  interpolation: { escapeValue: false },
});

export function applyLanguage(language: Language): void {
  localStorage.setItem(LANGUAGE_CACHE_KEY, language);
  document.documentElement.lang = language;
  if (i18n.language !== language) void i18n.changeLanguage(language);
}

export default i18n;
