/**
 * "Reto AcaDevHack": pure, DOM/Three-free state machine for the back-to-back challenge run.
 * A run chains Mission 1 → Mission 2 → Mission 3 → Free Roam tour. Any failure ends the run
 * (the player must start over from Mission 1). Completing all four yields a winner summary
 * with a claim code for the AcaDevHack subscription prize.
 */

import type { MissionId } from '../types/game';

export const CHALLENGE_ORDER: readonly MissionId[] = [
  'mission_1_bulevar',
  'mission_2_cristo_rey',
  'mission_3_pique_bulevar',
  'free_roam',
];

/**
 * Fastest believable completion per mission (seconds); anything quicker is rejected.
 * Calibrated below the fastest real (no-teleport) autopilot completions: M1 12.8 s, M2 9.6 s,
 * M3 22.2 s, Free Roam tour 35.8 s. Keep firestore.rules `minSeconds()` in sync.
 */
export const MIN_PLAUSIBLE_SECONDS: Readonly<Record<MissionId, number>> = {
  mission_1_bulevar: 10,
  mission_2_cristo_rey: 8,
  mission_3_pique_bulevar: 15,
  free_roam: 30,
};

export const MAX_PLAUSIBLE_SECONDS = 3600;

export const NICKNAME_PATTERN = /^[A-Za-z0-9_ñÑ]{3,16}$/;

/** Claim-code alphabet without look-alike glyphs (0/O, 1/I/L). */
export const CLAIM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CLAIM_CODE_PATTERN = /^CALI-[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/;

export type NicknameValidation = 'ok' | 'too_short' | 'too_long' | 'invalid_chars';

export function normalizeNickname(raw: string): string {
  return raw.trim();
}

export function validateNickname(raw: string): NicknameValidation {
  const nickname = normalizeNickname(raw);
  if (nickname.length < 3) return 'too_short';
  if (nickname.length > 16) return 'too_long';
  return NICKNAME_PATTERN.test(nickname) ? 'ok' : 'invalid_chars';
}

/** Case-insensitive key that keeps nicknames unique ("Parce" and "parce" collide). */
export function nicknameKey(nickname: string): string {
  return normalizeNickname(nickname).toLowerCase();
}

export function isPlausibleTime(missionId: MissionId, seconds: number): boolean {
  return (
    Number.isFinite(seconds) &&
    seconds >= MIN_PLAUSIBLE_SECONDS[missionId] &&
    seconds <= MAX_PLAUSIBLE_SECONDS
  );
}

/** Builds `CALI-XXXX-XXXX` from an injected uniform RNG in [0, 1). */
export function generateClaimCode(rng: () => number): string {
  const pick = (): string => {
    const raw = rng();
    const unit = Number.isFinite(raw) ? Math.min(Math.max(raw, 0), 0.999999) : 0;
    return CLAIM_CODE_ALPHABET[Math.floor(unit * CLAIM_CODE_ALPHABET.length)] ?? 'A';
  };
  const block = (): string => pick() + pick() + pick() + pick();
  return `CALI-${block()}-${block()}`;
}

export type ChallengeStatus = 'idle' | 'running' | 'failed' | 'completed';

export type ChallengeTimes = Readonly<Partial<Record<MissionId, number>>>;

export interface ChallengeSnapshot {
  readonly status: ChallengeStatus;
  readonly nickname: string | null;
  /** Zero-based index into CHALLENGE_ORDER of the mission being (or next to be) played. */
  readonly stageIndex: number;
  readonly totalStages: number;
  readonly currentMission: MissionId | null;
  readonly times: ChallengeTimes;
  readonly totalSeconds: number;
}

export interface WinnerSummary {
  readonly nickname: string;
  readonly times: Readonly<Record<MissionId, number>>;
  readonly totalSeconds: number;
}

export type CompletionOutcome =
  | { readonly kind: 'ignored' }
  | { readonly kind: 'rejected_implausible' }
  | { readonly kind: 'advanced'; readonly next: MissionId }
  | { readonly kind: 'completed'; readonly summary: WinnerSummary };

function roundSeconds(seconds: number): number {
  return Math.round(seconds * 1000) / 1000;
}

export class DevhackChallenge {
  private status: ChallengeStatus = 'idle';
  private nickname: string | null = null;
  private stageIndex = 0;
  private times: Partial<Record<MissionId, number>> = {};

  public startRun(nickname: string): ChallengeSnapshot {
    if (validateNickname(nickname) !== 'ok') {
      throw new Error(`Invalid challenge nickname: ${nickname}`);
    }
    this.nickname = normalizeNickname(nickname);
    this.status = 'running';
    this.stageIndex = 0;
    this.times = {};
    return this.getSnapshot();
  }

  public isRunning(): boolean {
    return this.status === 'running';
  }

  public currentMission(): MissionId | null {
    return this.status === 'running' ? (CHALLENGE_ORDER[this.stageIndex] ?? null) : null;
  }

  /** Records a finished mission; out-of-order or non-running completions are ignored. */
  public recordCompletion(missionId: MissionId, seconds: number): CompletionOutcome {
    if (this.status !== 'running' || CHALLENGE_ORDER[this.stageIndex] !== missionId) {
      return { kind: 'ignored' };
    }
    if (!isPlausibleTime(missionId, seconds)) {
      this.status = 'failed';
      return { kind: 'rejected_implausible' };
    }
    this.times = { ...this.times, [missionId]: roundSeconds(seconds) };
    this.stageIndex += 1;
    const next = CHALLENGE_ORDER[this.stageIndex];
    if (next) {
      return { kind: 'advanced', next };
    }
    this.status = 'completed';
    return { kind: 'completed', summary: this.buildWinnerSummary() };
  }

  /** A bust, time-up, or abandon ends the run: the player restarts from Mission 1. */
  public recordFailure(): ChallengeSnapshot {
    if (this.status === 'running') {
      this.status = 'failed';
    }
    return this.getSnapshot();
  }

  public abandon(): ChallengeSnapshot {
    this.status = 'idle';
    this.stageIndex = 0;
    this.times = {};
    return this.getSnapshot();
  }

  public getSnapshot(): ChallengeSnapshot {
    return {
      status: this.status,
      nickname: this.nickname,
      stageIndex: this.stageIndex,
      totalStages: CHALLENGE_ORDER.length,
      currentMission: this.currentMission(),
      times: { ...this.times },
      totalSeconds: this.totalSeconds(),
    };
  }

  private totalSeconds(): number {
    return roundSeconds(Object.values(this.times).reduce((sum, value) => sum + (value ?? 0), 0));
  }

  private buildWinnerSummary(): WinnerSummary {
    const times = {} as Record<MissionId, number>;
    for (const missionId of CHALLENGE_ORDER) {
      times[missionId] = this.times[missionId] ?? 0;
    }
    return { nickname: this.nickname ?? '', times, totalSeconds: this.totalSeconds() };
  }
}

/** Pre-filled WhatsApp deep link the winner uses to claim the prize. */
export function buildWhatsappClaimUrl(phone: string, message: string): string {
  return `https://wa.me/${phone.replace(/\D/g, '')}?text=${encodeURIComponent(message)}`;
}
