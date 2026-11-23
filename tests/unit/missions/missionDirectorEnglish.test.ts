import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/config/language', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/config/language')>();
  return { ...actual, ACTIVE_LANGUAGE: 'en' as const };
});

describe('MissionDirector in English', () => {
  it('shows English subtitles while characters keep speaking Caleño Spanish', async () => {
    const { CALI_MAP } = await import('../../../src/config/caliMap');
    const { LOCALE_CALI_EN } = await import('../../../src/config/localeEn');
    const { LOCALE_CALI_ES } = await import('../../../src/config/localeEs');
    const { MissionDirector, StorageAdapter } = await import('../../../src/missions/missionDirector');
    const memory = new Map<string, string>();
    const storage = new StorageAdapter({
      getItem: (key) => memory.get(key) ?? null,
      setItem: (key, value) => void memory.set(key, value),
    });
    const snap = new MissionDirector(CALI_MAP, storage).startMission('mission_1_bulevar');
    expect(snap.dialogue?.text).toBe(LOCALE_CALI_EN.dialogues.m1Intro.text);
    expect(snap.dialogue?.spokenText).toBe(LOCALE_CALI_ES.dialogues.m1Intro.text);
    expect(snap.activeObjective?.label).toBe(LOCALE_CALI_EN.objectives.mission1.heistOnFootLabel);
  });
});
