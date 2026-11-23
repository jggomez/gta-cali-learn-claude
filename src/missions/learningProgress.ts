/**
 * Pure state for "aprender jugando": per-mission powers (/rewind charges), the police-hack
 * mini-game (cooldown, question rotation, answer effects), collected Claude cards and one-shot
 * tips. Persistence is delegated to a StorageLike so it stays DOM-free and testable.
 */

import type { StorageLike } from './missionDirector';
import { CLAUDE_CARD_KEYS, type ClaudeCardKey, type LearningTipId } from './learningCatalog';

export const LEARNING_STORAGE_KEY = 'gta_cali_learning_v1';

export const REWIND_SECONDS = 5;
export const REWIND_CHARGES_PER_MISSION = 1;

export const HACK_MIN_WANTED = 2;
export const HACK_TRIGGER_BUST_PROGRESS = 0.35;
export const HACK_COOLDOWN_SECONDS = 45;
export const HACK_ANSWER_SECONDS = 8;

export interface HackQuestionLike {
  readonly options: readonly string[];
  readonly correctIndex: number;
}

export interface LearningState {
  readonly seenTips: readonly LearningTipId[];
  readonly cards: readonly ClaudeCardKey[];
  readonly answeredHacks: readonly number[];
}

function emptyState(): LearningState {
  return { seenTips: [], cards: [], answeredHacks: [] };
}

function sanitize(raw: unknown, questionCount: number): LearningState {
  if (typeof raw !== 'object' || raw === null) return emptyState();
  const value = raw as Record<string, unknown>;
  const asStrings = (input: unknown): string[] =>
    Array.isArray(input) ? input.filter((item): item is string => typeof item === 'string') : [];
  const cards = [...new Set(asStrings(value['cards']))].filter((id): id is ClaudeCardKey =>
    (CLAUDE_CARD_KEYS as readonly string[]).includes(id),
  );
  const seenTips = [...new Set(asStrings(value['seenTips']))] as LearningTipId[];
  const answeredHacks = Array.isArray(value['answeredHacks'])
    ? [...new Set(value['answeredHacks'])].filter(
        (n): n is number => Number.isInteger(n) && (n as number) >= 0 && (n as number) < questionCount,
      )
    : [];
  return { seenTips, cards, answeredHacks };
}

export type HackOutcome = 'correct' | 'wrong' | 'timeout';

export interface ActiveHack {
  readonly questionIndex: number;
  readonly remainingSeconds: number;
}

export class LearningProgress {
  private state: LearningState;
  private readonly storage: StorageLike | null;
  private readonly questionCount: number;
  private rewindCharges = REWIND_CHARGES_PER_MISSION;
  private hackCooldown = 0;
  private activeHack: ActiveHack | null = null;

  public constructor(storage: StorageLike | null, questionCount: number) {
    this.storage = storage;
    this.questionCount = Math.max(1, Math.floor(questionCount));
    this.state = this.load();
  }

  // ---- Powers ---------------------------------------------------------------------------------

  public resetForMission(): void {
    this.rewindCharges = REWIND_CHARGES_PER_MISSION;
    // Available from the first chase: a fresh mission must not leave the player without a lifeline.
    this.hackCooldown = 0;
    this.activeHack = null;
  }

  public getRewindCharges(): number {
    return this.rewindCharges;
  }

  /** Consumes a /rewind charge; the caller performs the world rewind only when this is true. */
  public tryConsumeRewind(): boolean {
    if (this.rewindCharges <= 0) return false;
    this.rewindCharges -= 1;
    return true;
  }

  /** Gives back a charge when the world had no history to rewind to. */
  public refundRewind(): void {
    this.rewindCharges = Math.min(REWIND_CHARGES_PER_MISSION, this.rewindCharges + 1);
  }

  // ---- Police hack mini-game -----------------------------------------------------------------

  public getActiveHack(): ActiveHack | null {
    return this.activeHack;
  }

  /**
   * Advances cooldowns/timers. Opens a hack when the police are about to bust a wanted player;
   * returns 'timeout' once when an open hack runs out of time.
   */
  public tick(
    dt: number,
    world: { readonly wantedStars: number; readonly bustProgress: number },
    rng: () => number,
  ): HackOutcome | null {
    const safeDt = Number.isFinite(dt) && dt > 0 ? dt : 0;
    if (this.activeHack) {
      const remaining = this.activeHack.remainingSeconds - safeDt;
      if (remaining <= 0) {
        this.closeHack();
        return 'timeout';
      }
      this.activeHack = { ...this.activeHack, remainingSeconds: remaining };
      return null;
    }
    this.hackCooldown = Math.max(0, this.hackCooldown - safeDt);
    if (
      this.hackCooldown <= 0 &&
      world.wantedStars >= HACK_MIN_WANTED &&
      world.bustProgress >= HACK_TRIGGER_BUST_PROGRESS
    ) {
      this.activeHack = { questionIndex: this.pickQuestion(rng), remainingSeconds: HACK_ANSWER_SECONDS };
    }
    return null;
  }

  /** Resolves the open hack. Returns the wanted-star delta to apply (-1 right, +1 wrong). */
  public answerHack(optionIndex: number, questions: readonly HackQuestionLike[]): {
    readonly outcome: HackOutcome;
    readonly starDelta: number;
  } | null {
    const hack = this.activeHack;
    if (!hack) return null;
    const question = questions[hack.questionIndex];
    const correct = question !== undefined && optionIndex === question.correctIndex;
    if (correct) {
      this.state = {
        ...this.state,
        answeredHacks: [...new Set([...this.state.answeredHacks, hack.questionIndex])],
      };
      this.save();
    }
    this.closeHack();
    return correct ? { outcome: 'correct', starDelta: -1 } : { outcome: 'wrong', starDelta: 1 };
  }

  private closeHack(): void {
    this.activeHack = null;
    this.hackCooldown = HACK_COOLDOWN_SECONDS;
  }

  /** Prefers questions the player has not answered right yet. */
  private pickQuestion(rng: () => number): number {
    const all = Array.from({ length: this.questionCount }, (_, index) => index);
    const fresh = all.filter((index) => !this.state.answeredHacks.includes(index));
    const pool = fresh.length > 0 ? fresh : all;
    const raw = rng();
    const unit = Number.isFinite(raw) ? Math.min(Math.max(raw, 0), 0.999999) : 0;
    return pool[Math.floor(unit * pool.length)] ?? 0;
  }

  // ---- Cards & tips --------------------------------------------------------------------------

  public getCards(): readonly ClaudeCardKey[] {
    return this.state.cards;
  }

  /** Returns true when the card is newly collected. */
  public collectCard(card: ClaudeCardKey): boolean {
    if (this.state.cards.includes(card)) return false;
    this.state = { ...this.state, cards: [...this.state.cards, card] };
    this.save();
    return true;
  }

  public hasAllCards(): boolean {
    return CLAUDE_CARD_KEYS.every((card) => this.state.cards.includes(card));
  }

  /** Returns true only the first time a tip is requested (one-shot toasts). */
  public markTipSeen(tip: LearningTipId): boolean {
    if (this.state.seenTips.includes(tip)) return false;
    this.state = { ...this.state, seenTips: [...this.state.seenTips, tip] };
    this.save();
    return true;
  }

  public getState(): LearningState {
    return this.state;
  }

  private load(): LearningState {
    try {
      const raw = this.storage?.getItem(LEARNING_STORAGE_KEY);
      return raw ? sanitize(JSON.parse(raw), this.questionCount) : emptyState();
    } catch {
      return emptyState();
    }
  }

  private save(): void {
    try {
      this.storage?.setItem(LEARNING_STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      // Storage unavailable (private mode): progress lasts for this session only.
    }
  }
}
