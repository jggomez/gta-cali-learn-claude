/**
 * Runtime glue for "aprender jugando": owns LearningProgress (pure rules) and LearningController
 * (DOM), reacts to world/mission snapshots and calls back into GameApp through LearningHost. Every
 * mechanic is optional and never stops the clock, so it cannot change Reto AcaDevHack times.
 */

import { HACK_QUESTIONS } from '../config/hackQuestions';
import { LOCALE_DEVHACK } from '../config/localeCali';
import {
  CLAUDE_CARD_KEYS,
  CLAUDE_CARD_LESSONS,
  TIP_LESSONS,
  type ClaudeCardKey,
  type LearningTipId,
} from '../missions/learningCatalog';
import { LearningProgress, REWIND_SECONDS } from '../missions/learningProgress';
import type { StorageLike } from '../missions/missionDirector';
import type {
  AudioState,
  GameLearningDebug,
  MissionId,
  MissionSnapshot,
  WorldSnapshot,
} from '../types/game';
import { LearningController, type PlanChoice } from '../ui/learningController';

const COPY = LOCALE_DEVHACK.learning;
const RADIO_AD_INTERVAL_SECONDS = 80;
const RADIO_AD_FIRST_DELAY_SECONDS = 35;

export interface CardSpot {
  readonly id: string;
  readonly x: number;
  readonly z: number;
}

export interface LearningHost {
  /** Rewinds the world ~`seconds`; false when there is no history yet. */
  rewindWorld(seconds: number): boolean;
  /** Adds (or removes, when negative) wanted stars, lowering the mission floor as needed. */
  applyWantedDelta(delta: number): void;
  applyPlanChoice(choice: PlanChoice): void;
  /** Freezes the arrest meter while a hack question is open. */
  setBustHold(held: boolean): void;
  /** Resets the arrest meter after a correct hack answer. */
  relieveBust(): void;
  onCardsChanged(collected: readonly ClaudeCardKey[], complete: boolean): void;
  speakRadioAd(text: string): void;
}

export interface LearningSessionOptions {
  readonly root: HTMLElement;
  readonly storage: StorageLike | null;
  readonly host: LearningHost;
  readonly cardSpots: readonly CardSpot[];
  readonly cardPickupRadius: number;
  readonly rng?: () => number;
}

export class LearningSession {
  private readonly progress: LearningProgress;
  private readonly ui: LearningController;
  private readonly host: LearningHost;
  private readonly cardSpots: readonly CardSpot[];
  private readonly pickupRadiusSq: number;
  private readonly rng: () => number;

  private readonly plannedMissions = new Set<MissionId>();
  private pendingStart: (() => void) | null = null;
  private lastPayNSprayAt = 0;
  private radioCountdown = RADIO_AD_FIRST_DELAY_SECONDS;
  private radioIndex = 0;
  private phoneIndex = 0;

  public constructor(options: LearningSessionOptions) {
    this.host = options.host;
    this.cardSpots = options.cardSpots;
    this.pickupRadiusSq = options.cardPickupRadius ** 2;
    this.rng = options.rng ?? Math.random;
    this.progress = new LearningProgress(options.storage, HACK_QUESTIONS.length);
    this.ui = new LearningController(options.root, {
      onHackAnswer: (index) => this.answerHack(index),
      onPlanChosen: (choice) => this.choosePlan(choice),
      onAlbumClosed: () => this.ui.closeAlbum(),
    });
  }

  public getCollectedCards(): readonly ClaudeCardKey[] {
    return this.progress.getCards();
  }

  public hasAllCards(): boolean {
    return this.progress.hasAllCards();
  }

  /**
   * Modo Plan: the first time each mission is launched in a session, the briefing modal opens and
   * the mission (and its clock) only starts once a plan is approved.
   */
  public beginMission(missionId: MissionId, start: () => void): void {
    this.pendingStart = null;
    this.ui.closePlan();
    if (this.plannedMissions.has(missionId) || missionId === 'free_roam') {
      start();
      return;
    }
    this.plannedMissions.add(missionId);
    this.pendingStart = start;
    this.ui.openPlan(missionId);
  }

  /** Called by GameApp after every world reset for a mission. */
  public onMissionStarted(world: Readonly<WorldSnapshot>): void {
    this.progress.resetForMission();
    this.lastPayNSprayAt = world.lastPayNSprayAt ?? 0;
  }

  public cancelPendingPlan(): void {
    this.pendingStart = null;
    this.ui.closePlan();
  }

  public requestRewind(isPlaying: boolean): void {
    if (!isPlaying || this.progress.getActiveHack()) return;
    if (!this.progress.tryConsumeRewind()) {
      this.ui.flash(COPY.rewindEmpty, 'wrong');
      return;
    }
    if (!this.host.rewindWorld(REWIND_SECONDS)) {
      this.progress.refundRewind();
      return;
    }
    this.ui.flash(COPY.rewindUsed, 'correct');
    this.showTipOnce('tip_rewind');
  }

  /** Number keys 1-3 answer an open hack; returns true when the key was consumed. */
  public handleNumberKey(index: number): boolean {
    if (!this.progress.getActiveHack()) return false;
    this.answerHack(index);
    return true;
  }

  public notifyHookRefill(): void {
    this.showTipOnce('tip_hook_nitro');
  }

  public step(
    dt: number,
    world: Readonly<WorldSnapshot>,
    prevMission: Readonly<MissionSnapshot>,
    mission: Readonly<MissionSnapshot>,
    audio: Readonly<AudioState>,
  ): void {
    if (prevMission.mode === 'playing' && mission.mode === 'mission_passed') {
      this.sendPhoneMessage();
    }
    if (mission.mode !== 'playing') return;

    const outcome = this.progress.tick(dt, world, this.rng);
    if (outcome === 'timeout') {
      this.ui.flash(COPY.hack.timeout, 'wrong');
    } else if (this.progress.getActiveHack()) {
      this.showTipOnce('tip_hack');
    }
    this.host.setBustHold(this.progress.getActiveHack() !== null);

    const sprayAt = world.lastPayNSprayAt ?? 0;
    if (sprayAt > this.lastPayNSprayAt) {
      this.lastPayNSprayAt = sprayAt;
      this.showTipOnce('tip_clear_spray');
    }

    this.collectNearbyCards(world.player.x, world.player.z);
    this.tickRadio(dt, audio);
  }

  public render(dt: number, mission: Readonly<MissionSnapshot>): void {
    const playing = mission.mode === 'playing';
    this.ui.renderPill(playing ? this.progress.getRewindCharges() : null);
    this.ui.renderHack(playing ? this.progress.getActiveHack() : null, HACK_QUESTIONS);
    this.ui.update(dt);
  }

  public openAlbum(): void {
    this.ui.openAlbum(this.progress.getCards());
  }

  public getDebug(): GameLearningDebug {
    return {
      rewindCharges: this.progress.getRewindCharges(),
      cards: [...this.progress.getCards()],
      hackQuestionIndex: this.progress.getActiveHack()?.questionIndex ?? null,
      blocking: this.isBlockingGameplay(),
    };
  }

  public isBlockingGameplay(): boolean {
    return this.ui.isPlanOpen() || this.ui.isAlbumOpen();
  }

  public dispose(): void {
    this.ui.dispose();
  }

  private choosePlan(choice: PlanChoice): void {
    const start = this.pendingStart;
    this.pendingStart = null;
    this.ui.closePlan();
    if (!start) return;
    start();
    this.host.applyPlanChoice(choice);
    this.showTipOnce('tip_plan_mode');
  }

  private answerHack(index: number): void {
    const result = this.progress.answerHack(index, HACK_QUESTIONS);
    if (!result) return;
    this.host.setBustHold(false);
    if (result.outcome === 'correct') {
      this.host.relieveBust();
    }
    this.host.applyWantedDelta(result.starDelta);
    this.ui.flash(COPY.hack[result.outcome], result.outcome === 'correct' ? 'correct' : 'wrong');
  }

  private collectNearbyCards(x: number, z: number): void {
    for (const spot of this.cardSpots) {
      const dx = spot.x - x;
      const dz = spot.z - z;
      if (dx * dx + dz * dz > this.pickupRadiusSq) continue;
      if (!(CLAUDE_CARD_KEYS as readonly string[]).includes(spot.id)) continue;
      const card = spot.id as ClaudeCardKey;
      if (!this.progress.collectCard(card)) continue;

      const collected = this.progress.getCards();
      const complete = this.progress.hasAllCards();
      this.host.onCardsChanged(collected, complete);
      this.ui.flash(COPY.cardToast(collected.length, CLAUDE_CARD_KEYS.length), 'correct');
      if (complete && this.showTipOnce('tip_all_cards')) continue;
      if (collected.length === 1 && this.showTipOnce('tip_first_card')) continue;
      const copy = COPY.cards[card];
      this.ui.showToast(copy.title, copy.body, CLAUDE_CARD_LESSONS[card]);
    }
  }

  private tickRadio(dt: number, audio: Readonly<AudioState>): void {
    if (audio.muted || audio.station === 'off') return;
    this.radioCountdown -= Number.isFinite(dt) && dt > 0 ? dt : 0;
    if (this.radioCountdown > 0) return;
    this.radioCountdown = RADIO_AD_INTERVAL_SECONDS;
    const ad = COPY.radioAds[this.radioIndex % COPY.radioAds.length] ?? '';
    this.radioIndex += 1;
    this.host.speakRadioAd(ad);
  }

  private sendPhoneMessage(): void {
    const body = COPY.phone.messages[this.phoneIndex % COPY.phone.messages.length] ?? '';
    const lessons = ['cc_permissions_hooks', 'cpt_prompt_4', 'cc_plan_mode', 'cpt_files', 'cc_claude_md'] as const;
    const lesson = lessons[this.phoneIndex % lessons.length] ?? 'cc_agentic_loop';
    this.phoneIndex += 1;
    this.ui.showToast(`📱 ${COPY.phone.from}`, body, lesson);
  }

  private showTipOnce(tip: LearningTipId): boolean {
    if (!this.progress.markTipSeen(tip)) return false;
    const copy = COPY.tips[tip];
    this.ui.showToast(copy.title, copy.body, TIP_LESSONS[tip]);
    return true;
  }
}
