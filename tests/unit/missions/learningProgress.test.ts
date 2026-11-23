import { describe, expect, it } from 'vitest';
import { HACK_QUESTIONS } from '../../../src/config/hackQuestions';
import {
  CLAUDE_CARD_KEYS,
  CLAUDE_CARD_LESSONS,
  LESSONS,
  TIP_LESSONS,
  lessonLinks,
} from '../../../src/missions/learningCatalog';
import {
  HACK_ANSWER_SECONDS,
  HACK_COOLDOWN_SECONDS,
  LEARNING_STORAGE_KEY,
  LearningProgress,
  REWIND_CHARGES_PER_MISSION,
} from '../../../src/missions/learningProgress';

class MemoryStorage {
  public readonly data = new Map<string, string>();
  public getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  public setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

const CORNERED = { wantedStars: 3, bustProgress: 0.5 } as const;

describe('learningCatalog', () => {
  it('builds devhack.co links for every lesson', () => {
    for (const key of Object.keys(LESSONS) as (keyof typeof LESSONS)[]) {
      const links = lessonLinks(key);
      expect(links.courseUrl).toMatch(/^https:\/\/devhack\.co\/academy-ai\/claude-(code-desde-cero|para-todos)\/$/);
      expect(links.signupUrl).toMatch(/^https:\/\/devhack\.co\/acadevhack-virtual\/registro\/\?curso=claude-/);
      expect(links.lessonUrl).toContain(`session=${LESSONS[key].sessionId}`);
    }
    expect(lessonLinks('cc_skills').lessonUrl).toContain('session=s11');
  });

  it('maps ten cards and all tips to real lessons', () => {
    expect(CLAUDE_CARD_KEYS).toHaveLength(10);
    for (const lesson of [...Object.values(CLAUDE_CARD_LESSONS), ...Object.values(TIP_LESSONS)]) {
      expect(LESSONS[lesson]).toBeDefined();
    }
  });
});

describe('hackQuestions', () => {
  it('has a sizeable bank with valid answers, spread over correct positions', () => {
    expect(HACK_QUESTIONS.length).toBeGreaterThanOrEqual(20);
    const positions = new Set(HACK_QUESTIONS.map((q) => q.correctIndex));
    expect(positions).toEqual(new Set([0, 1, 2]));
    for (const q of HACK_QUESTIONS) {
      expect(q.options).toHaveLength(3);
      expect(new Set(q.options).size).toBe(3);
      expect(LESSONS[q.lesson]).toBeDefined();
      expect(q.prompt.length).toBeLessThanOrEqual(90);
    }
  });
});

describe('LearningProgress', () => {
  it('grants one /rewind per mission and refunds unused attempts', () => {
    const progress = new LearningProgress(null, HACK_QUESTIONS.length);
    expect(progress.getRewindCharges()).toBe(REWIND_CHARGES_PER_MISSION);
    expect(progress.tryConsumeRewind()).toBe(true);
    expect(progress.tryConsumeRewind()).toBe(false);
    progress.refundRewind();
    expect(progress.getRewindCharges()).toBe(1);
    progress.tryConsumeRewind();
    progress.resetForMission();
    expect(progress.getRewindCharges()).toBe(1);
  });

  it('opens a hack only when the police corner a wanted player, after the cooldown', () => {
    const progress = new LearningProgress(null, HACK_QUESTIONS.length);
    progress.resetForMission();
    progress.tick(1, { wantedStars: 1, bustProgress: 0.9 }, () => 0);
    expect(progress.getActiveHack()).toBeNull(); // 1 star is not enough
    progress.tick(0.1, { wantedStars: 2, bustProgress: 0.1 }, () => 0);
    expect(progress.getActiveHack()).toBeNull(); // not cornered yet
    progress.tick(0.1, CORNERED, () => 0.5);
    expect(progress.getActiveHack()?.remainingSeconds).toBe(HACK_ANSWER_SECONDS);
  });

  it('right answers remove a star, wrong ones add one, and the timeout closes the hack', () => {
    const progress = new LearningProgress(null, HACK_QUESTIONS.length);
    progress.tick(HACK_COOLDOWN_SECONDS, CORNERED, () => 0);
    const index = progress.getActiveHack()!.questionIndex;
    const right = HACK_QUESTIONS[index]!.correctIndex;
    expect(progress.answerHack(right, HACK_QUESTIONS)).toEqual({ outcome: 'correct', starDelta: -1 });
    expect(progress.getActiveHack()).toBeNull();
    expect(progress.answerHack(0, HACK_QUESTIONS)).toBeNull();

    progress.tick(HACK_COOLDOWN_SECONDS - 1, CORNERED, () => 0);
    expect(progress.getActiveHack()).toBeNull(); // cooldown after an answer
    progress.tick(1, CORNERED, () => 0);
    const next = progress.getActiveHack()!.questionIndex;
    expect(next).not.toBe(index); // answered-right questions are not repeated
    const wrong = (HACK_QUESTIONS[next]!.correctIndex + 1) % 3;
    expect(progress.answerHack(wrong, HACK_QUESTIONS)?.starDelta).toBe(1);

    progress.tick(HACK_COOLDOWN_SECONDS, CORNERED, () => 0);
    expect(progress.tick(HACK_ANSWER_SECONDS + 0.01, CORNERED, () => 0)).toBe('timeout');
    expect(progress.getActiveHack()).toBeNull();
  });

  it('persists cards and one-shot tips, ignoring corrupt storage', () => {
    const storage = new MemoryStorage();
    const first = new LearningProgress(storage, HACK_QUESTIONS.length);
    expect(first.collectCard('card_plan_mode')).toBe(true);
    expect(first.collectCard('card_plan_mode')).toBe(false);
    expect(first.markTipSeen('tip_rewind')).toBe(true);
    expect(first.markTipSeen('tip_rewind')).toBe(false);

    const reloaded = new LearningProgress(storage, HACK_QUESTIONS.length);
    expect(reloaded.getCards()).toEqual(['card_plan_mode']);
    expect(reloaded.markTipSeen('tip_rewind')).toBe(false);
    for (const card of CLAUDE_CARD_KEYS) reloaded.collectCard(card);
    expect(reloaded.hasAllCards()).toBe(true);

    storage.setItem(LEARNING_STORAGE_KEY, JSON.stringify({ cards: ['card_fake', 7], answeredHacks: [999, -1, 2] }));
    const sanitized = new LearningProgress(storage, HACK_QUESTIONS.length);
    expect(sanitized.getCards()).toEqual([]);
    expect(sanitized.getState().answeredHacks).toEqual([2]);
    storage.setItem(LEARNING_STORAGE_KEY, '{not json');
    expect(new LearningProgress(storage, HACK_QUESTIONS.length).getCards()).toEqual([]);
  });
});
