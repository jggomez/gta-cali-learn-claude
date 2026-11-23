/**
 * UI language selection (Español / English). Pure helpers plus the boot-time resolution used by
 * `localeCali.ts`. City/advertising copy and every spoken voice line stay in Español Caleño.
 */

export type Language = 'es' | 'en';

export const LANGUAGE_STORAGE_KEY = 'gta_cali_lang_v1';

export interface LanguageStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function isLanguage(value: unknown): value is Language {
  return value === 'es' || value === 'en';
}

/**
 * Saved choice first; otherwise English only when the browser's preferred language is English;
 * Spanish for everyone else (and for headless/no-window environments).
 */
export function resolveLanguage(
  storage: Pick<LanguageStorage, 'getItem'> | null,
  navigatorLanguages: readonly string[] = [],
): Language {
  try {
    const saved = storage?.getItem(LANGUAGE_STORAGE_KEY);
    if (isLanguage(saved)) {
      return saved;
    }
  } catch {
    // Storage blocked (private mode): fall through to the browser language.
  }
  const first = navigatorLanguages[0]?.toLowerCase() ?? '';
  return first === 'en' || first.startsWith('en-') ? 'en' : 'es';
}

function browserStorage(): LanguageStorage | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

function browserLanguages(): readonly string[] {
  if (typeof navigator === 'undefined') {
    return [];
  }
  if (Array.isArray(navigator.languages) && navigator.languages.length > 0) {
    return navigator.languages;
  }
  return typeof navigator.language === 'string' ? [navigator.language] : [];
}

/** Language for this page load (headless/Vitest: always 'es'). */
export const ACTIVE_LANGUAGE: Language =
  typeof window === 'undefined' ? 'es' : resolveLanguage(browserStorage(), browserLanguages());

/** Saves the choice and reloads into the title screen so every label is rebuilt in that language. */
export function switchLanguage(language: Language): void {
  if (language === ACTIVE_LANGUAGE) {
    return;
  }
  try {
    browserStorage()?.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // Without storage the choice cannot persist; still reload with the browser default.
  }
  if (typeof window !== 'undefined' && typeof window.location?.reload === 'function') {
    window.location.reload();
  }
}
