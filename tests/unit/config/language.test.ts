import { describe, expect, it } from 'vitest';
import {
  ACTIVE_LANGUAGE,
  LANGUAGE_STORAGE_KEY,
  isLanguage,
  resolveLanguage,
} from '../../../src/config/language';

const storageWith = (value: string | null) => ({ getItem: (key: string) => (key === LANGUAGE_STORAGE_KEY ? value : null) });

describe('language selection', () => {
  it('defaults to Spanish in headless environments', () => {
    expect(ACTIVE_LANGUAGE).toBe('es');
    expect(resolveLanguage(null)).toBe('es');
  });

  it('uses the saved choice over the browser language', () => {
    expect(resolveLanguage(storageWith('en'), ['es-CO'])).toBe('en');
    expect(resolveLanguage(storageWith('es'), ['en-US'])).toBe('es');
  });

  it('auto-detects English only when the first browser language is English', () => {
    expect(resolveLanguage(storageWith(null), ['en-US', 'es'])).toBe('en');
    expect(resolveLanguage(storageWith(null), ['en'])).toBe('en');
    expect(resolveLanguage(storageWith(null), ['es-CO', 'en-US'])).toBe('es');
    expect(resolveLanguage(storageWith(null), ['pt-BR'])).toBe('es');
    expect(resolveLanguage(storageWith(null), [])).toBe('es');
  });

  it('ignores corrupt saved values and blocked storage', () => {
    expect(resolveLanguage(storageWith('fr'), ['en-GB'])).toBe('en');
    const blocked = {
      getItem: () => {
        throw new Error('SecurityError');
      },
    };
    expect(resolveLanguage(blocked, ['es-MX'])).toBe('es');
    expect(isLanguage('en')).toBe(true);
    expect(isLanguage('EN')).toBe(false);
  });
});
