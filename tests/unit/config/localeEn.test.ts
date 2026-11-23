import { describe, expect, it } from 'vitest';
import { HACK_QUESTIONS_EN, HACK_QUESTIONS_ES } from '../../../src/config/hackQuestions';
import { CITY_COPY } from '../../../src/config/localeCity';
import { LOCALE_CALI_EN, LOCALE_DEVHACK_EN } from '../../../src/config/localeEn';
import { LOCALE_CALI_ES, LOCALE_DEVHACK_ES } from '../../../src/config/localeEs';
import { LOCALE_CALI } from '../../../src/config/localeCali';

/** Collects "path → kind" for every leaf so both locales can be compared structurally. */
function shape(value: unknown, path = '', out = new Map<string, string>()): Map<string, string> {
  if (typeof value === 'function') {
    out.set(path, `function/${(value as (...args: unknown[]) => unknown).length}`);
  } else if (Array.isArray(value)) {
    out.set(path, `array/${value.length}`);
    value.forEach((item, index) => shape(item, `${path}[${index}]`, out));
  } else if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) shape(child, path ? `${path}.${key}` : key, out);
  } else {
    out.set(path, typeof value);
  }
  return out;
}

function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => strings(v, out));
  else if (value !== null && typeof value === 'object') Object.values(value).forEach((v) => strings(v, out));
  return out;
}

describe('English locale', () => {
  it('has exactly the same shape as the Spanish locale', () => {
    expect([...shape(LOCALE_CALI_EN).entries()]).toEqual([...shape(LOCALE_CALI_ES).entries()]);
    expect([...shape(LOCALE_DEVHACK_EN).entries()]).toEqual([...shape(LOCALE_DEVHACK_ES).entries()]);
  });

  it('has no empty strings and really is translated', () => {
    expect(strings(LOCALE_CALI_EN).every((s) => s.trim().length > 0)).toBe(true);
    expect(LOCALE_CALI_EN.overlays.pause.resume).toBe('Resume');
    expect(LOCALE_CALI_EN.dialogues.m1Intro.text).not.toBe(LOCALE_CALI_ES.dialogues.m1Intro.text);
    expect(LOCALE_CALI_EN.dialogues.m1Intro.speaker).toBe(LOCALE_CALI_ES.dialogues.m1Intro.speaker);
    expect(LOCALE_DEVHACK_EN.learning.showcase.title).toBe('Learn Claude while you play');
  });

  it('keeps city and advertising copy in Español Caleño (shared objects)', () => {
    for (const locale of [LOCALE_CALI_EN, LOCALE_CALI_ES]) {
      expect(locale.devhackAds).toBe(CITY_COPY.devhackAds);
      expect(locale.learningWorld).toBe(CITY_COPY.learningWorld);
      expect(locale.viralTicker).toBe(CITY_COPY.viralTicker);
      expect(locale.radio).toBe(CITY_COPY.radio);
      expect(locale.voiceLines).toBe(CITY_COPY.voiceLines);
    }
    expect(LOCALE_DEVHACK_EN.learning.radioAds).toBe(CITY_COPY.radioAds);
    expect(CITY_COPY.learningWorld.bankSign).toBe('BANCO SUCURSAL IA');
  });

  it('defaults the active locale to Spanish headlessly', () => {
    expect(LOCALE_CALI).toBe(LOCALE_CALI_ES);
  });

  it('translates every hack question while keeping answers and lessons aligned', () => {
    expect(HACK_QUESTIONS_EN).toHaveLength(HACK_QUESTIONS_ES.length);
    HACK_QUESTIONS_EN.forEach((question, index) => {
      const spanish = HACK_QUESTIONS_ES[index]!;
      expect(question.correctIndex).toBe(spanish.correctIndex);
      expect(question.lesson).toBe(spanish.lesson);
      expect(question.prompt).not.toBe(spanish.prompt);
      expect(question.options).toHaveLength(3);
    });
  });
});
