import { describe, expect, it } from 'vitest';
import {
  CHALLENGE_ORDER,
  CLAIM_CODE_PATTERN,
  DevhackChallenge,
  MIN_PLAUSIBLE_SECONDS,
  buildWhatsappClaimUrl,
  generateClaimCode,
  isPlausibleTime,
  nicknameKey,
  validateNickname,
} from '../../../src/missions/devhackChallenge';

describe('devhackChallenge nickname rules', () => {
  it('accepts 3-16 letters, digits, underscore and ñ', () => {
    expect(validateNickname('Parce_23')).toBe('ok');
    expect(validateNickname('  Ñapa  ')).toBe('ok');
    expect(validateNickname('ab')).toBe('too_short');
    expect(validateNickname('a'.repeat(17))).toBe('too_long');
    expect(validateNickname('no spaces')).toBe('invalid_chars');
    expect(validateNickname('<script>')).toBe('invalid_chars');
  });

  it('derives a case-insensitive uniqueness key', () => {
    expect(nicknameKey(' Parce ')).toBe(nicknameKey('PARCE'));
  });
});

describe('devhackChallenge claim codes', () => {
  it('formats CALI-XXXX-XXXX without look-alike glyphs', () => {
    let seed = 0.13;
    const rng = () => {
      seed = (seed * 9301 + 0.49297) % 1;
      return seed;
    };
    for (let i = 0; i < 50; i += 1) {
      const code = generateClaimCode(rng);
      expect(code).toMatch(CLAIM_CODE_PATTERN);
      expect(code.slice(5)).not.toMatch(/[01ILO]/);
    }
    expect(generateClaimCode(() => 0.9999999)).toMatch(CLAIM_CODE_PATTERN);
    expect(generateClaimCode(() => Number.NaN)).toBe('CALI-AAAA-AAAA');
  });

  it('builds an encoded WhatsApp deep link', () => {
    const url = buildWhatsappClaimUrl('+57 317 449 8336', 'Gané: CALI-ABCD-EFGH & más');
    expect(url).toBe(
      `https://wa.me/573174498336?text=${encodeURIComponent('Gané: CALI-ABCD-EFGH & más')}`,
    );
  });
});

describe('DevhackChallenge run', () => {
  const okTime = (id: (typeof CHALLENGE_ORDER)[number]) => MIN_PLAUSIBLE_SECONDS[id] + 40;

  it('chains the 4 missions in order and produces a winner summary', () => {
    const run = new DevhackChallenge();
    run.startRun('Valeria');
    expect(run.currentMission()).toBe('mission_1_bulevar');

    expect(run.recordCompletion('mission_1_bulevar', 61.2345)).toEqual({
      kind: 'advanced',
      next: 'mission_2_cristo_rey',
    });
    expect(run.recordCompletion('mission_2_cristo_rey', okTime('mission_2_cristo_rey')).kind).toBe(
      'advanced',
    );
    expect(run.recordCompletion('mission_3_pique_bulevar', okTime('mission_3_pique_bulevar')).kind).toBe(
      'advanced',
    );
    const outcome = run.recordCompletion('free_roam', 200);
    expect(outcome.kind).toBe('completed');
    if (outcome.kind !== 'completed') return;
    expect(outcome.summary.nickname).toBe('Valeria');
    expect(outcome.summary.times.mission_1_bulevar).toBe(61.235);
    expect(outcome.summary.totalSeconds).toBeCloseTo(
      61.235 + okTime('mission_2_cristo_rey') + okTime('mission_3_pique_bulevar') + 200,
      3,
    );
    expect(run.getSnapshot().status).toBe('completed');
    expect(run.currentMission()).toBeNull();
  });

  it('ignores out-of-order completions and completions outside a run', () => {
    const run = new DevhackChallenge();
    expect(run.recordCompletion('mission_1_bulevar', 60).kind).toBe('ignored');
    run.startRun('Mateo');
    expect(run.recordCompletion('mission_2_cristo_rey', 60).kind).toBe('ignored');
    expect(run.getSnapshot().stageIndex).toBe(0);
  });

  it('ends the run on failure so the player restarts from Mission 1', () => {
    const run = new DevhackChallenge();
    run.startRun('Mateo');
    run.recordCompletion('mission_1_bulevar', 60);
    expect(run.recordFailure().status).toBe('failed');
    expect(run.recordCompletion('mission_2_cristo_rey', 60).kind).toBe('ignored');

    const restarted = run.startRun('Mateo');
    expect(restarted.stageIndex).toBe(0);
    expect(restarted.times).toEqual({});
    expect(restarted.currentMission).toBe('mission_1_bulevar');
  });

  it('rejects implausible times and fails the run', () => {
    const run = new DevhackChallenge();
    run.startRun('Speedy');
    expect(run.recordCompletion('mission_1_bulevar', 1).kind).toBe('rejected_implausible');
    expect(run.getSnapshot().status).toBe('failed');
    expect(isPlausibleTime('free_roam', 3601)).toBe(false);
    expect(isPlausibleTime('mission_2_cristo_rey', 7.9)).toBe(false);
    expect(isPlausibleTime('mission_1_bulevar', 9.9)).toBe(false);
  });

  it('accepts the fastest real completions driven through the simulation (autopilot evidence)', () => {
    // Expert headless autopilot runs (tests/integration/missionAutopilot.test.ts), no teleports.
    expect(isPlausibleTime('mission_1_bulevar', 12.77)).toBe(true);
    expect(isPlausibleTime('mission_2_cristo_rey', 9.6)).toBe(true);
    expect(isPlausibleTime('mission_3_pique_bulevar', 22.18)).toBe(true);
    expect(isPlausibleTime('free_roam', 35.78)).toBe(true);
    expect(isPlausibleTime('free_roam', Number.NaN)).toBe(false);
  });

  it('refuses to start with an invalid nickname and resets on abandon', () => {
    const run = new DevhackChallenge();
    expect(() => run.startRun('x')).toThrow();
    run.startRun('Valeria');
    run.recordCompletion('mission_1_bulevar', 60);
    const snap = run.abandon();
    expect(snap.status).toBe('idle');
    expect(snap.totalSeconds).toBe(0);
  });
});
