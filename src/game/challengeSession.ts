/**
 * Orchestrates one Reto AcaDevHack session: binds the pure DevhackChallenge run to mission
 * transitions, pushes best times / winners through the LeaderboardPort, and drives the
 * ChallengeController UI. GameApp only forwards mission snapshots and exposes stage starts.
 */

import { CHALLENGE_ORDER, DevhackChallenge, generateClaimCode } from '../missions/devhackChallenge';
import type { StorageLike } from '../missions/missionDirector';
import type { LeaderboardPort } from '../services/leaderboardPort';
import type { MissionId, MissionSnapshot } from '../types/game';
import { ChallengeController, type WinnerView } from '../ui/challengeController';

export const NICKNAME_STORAGE_KEY = 'gta_cali_reto_nickname_v1';

export interface ChallengeSessionHost {
  startChallengeStage(missionId: MissionId): void;
  returnToTitle(): void;
}

export class ChallengeSession {
  private readonly run = new DevhackChallenge();
  private readonly ui: ChallengeController;
  private readonly port: LeaderboardPort;
  private readonly host: ChallengeSessionHost;
  private readonly storage: StorageLike | null;
  private readonly rng: () => number;
  private online = true;
  private nextStage: MissionId | null = null;

  public constructor(options: {
    readonly root: HTMLElement;
    readonly port: LeaderboardPort;
    readonly host: ChallengeSessionHost;
    readonly storage: StorageLike | null;
    readonly rng?: () => number;
  }) {
    this.port = options.port;
    this.host = options.host;
    this.storage = options.storage;
    this.rng = options.rng ?? cryptoRandom;
    this.ui = new ChallengeController(options.root, {
      claimNickname: (nickname) => this.port.claimNickname(nickname),
      startRun: (nickname, online) => this.startRun(nickname, online),
      fetchTop: (missionId) => this.port.fetchTop(missionId, 10),
      nextStage: () => this.startNextStage(),
      retryRun: () => this.retry(),
      quit: () => this.quit(),
      currentUid: () => this.port.currentUid(),
    });
    const stored = this.readStoredNickname();
    if (stored) this.ui.setStoredNickname(stored);
  }

  public mountTitleCard(titleScreen: HTMLElement): void {
    this.ui.mountTitleCard(titleScreen);
  }

  public isRunning(): boolean {
    return this.run.isRunning();
  }

  /** Whether a challenge text field/modal currently owns keyboard focus over gameplay. */
  public isBlockingGameplay(): boolean {
    return this.ui.isBlockingGameplay();
  }

  /** Called by GameApp after each mission update with the previous and next snapshots. */
  public onMissionTransition(prev: Readonly<MissionSnapshot>, next: Readonly<MissionSnapshot>): void {
    if (!this.run.isRunning() || !next.isChallengeRun || prev.mode !== 'playing') {
      return;
    }
    if (next.mode === 'mission_passed' || next.mode === 'victory') {
      this.handleCompletion(next.activeMission, next.lastCompletedTimeSeconds ?? Number.NaN);
    } else if (next.mode === 'busted') {
      this.run.recordFailure();
      this.ui.showFailed('failed');
    }
  }

  public render(mission: Readonly<MissionSnapshot>): void {
    const inRun = mission.isChallengeRun === true && mission.mode !== 'title';
    const elapsed = mission.mode === 'playing' || mission.mode === 'paused' ? mission.elapsedSeconds : 0;
    this.ui.renderHudChip(this.run.getSnapshot(), elapsed, inRun);
  }

  /** Pause-menu restart during a run restarts the whole challenge from Mission 1. */
  public retry(): void {
    const nickname = this.run.getSnapshot().nickname;
    if (!nickname) {
      this.quit();
      return;
    }
    this.startRun(nickname, this.online);
  }

  /** Leaving to the title (pause menu or modal) abandons the run. */
  public abandon(): void {
    if (this.run.getSnapshot().status !== 'idle') {
      this.run.abandon();
    }
    this.nextStage = null;
    this.ui.hideAll();
  }

  public dispose(): void {
    this.ui.dispose();
  }

  private startRun(nickname: string, online: boolean): void {
    this.online = online;
    this.writeStoredNickname(nickname);
    this.run.startRun(nickname);
    this.nextStage = null;
    this.ui.hideAll();
    this.host.startChallengeStage(CHALLENGE_ORDER[0] ?? 'mission_1_bulevar');
  }

  private startNextStage(): void {
    const next = this.nextStage;
    this.nextStage = null;
    if (next && this.run.isRunning()) {
      this.host.startChallengeStage(next);
    }
  }

  private quit(): void {
    this.abandon();
    this.host.returnToTitle();
  }

  private handleCompletion(missionId: MissionId, seconds: number): void {
    const nickname = this.run.getSnapshot().nickname ?? '';
    const outcome = this.run.recordCompletion(missionId, seconds);
    if (outcome.kind === 'ignored') return;
    if (outcome.kind === 'rejected_implausible') {
      this.ui.showFailed('implausible');
      return;
    }

    if (outcome.kind === 'advanced') {
      this.nextStage = outcome.next;
      const done = this.run.getSnapshot().stageIndex;
      this.ui.showStagePassed(missionId, seconds, done, CHALLENGE_ORDER.length);
    }
    void this.submitTime(missionId, nickname, seconds, outcome.kind === 'advanced');

    if (outcome.kind === 'completed') {
      const view: WinnerView = {
        nickname: outcome.summary.nickname,
        code: generateClaimCode(this.rng),
        totalSeconds: outcome.summary.totalSeconds,
        times: outcome.summary.times,
      };
      this.ui.showWinner(view);
      void this.registerWinner(view);
    }
  }

  private async submitTime(
    missionId: MissionId,
    nickname: string,
    seconds: number,
    reportToStage: boolean,
  ): Promise<void> {
    if (!this.online) {
      if (reportToStage) this.ui.setStageSync({ kind: 'offline' });
      return;
    }
    if (reportToStage) this.ui.setStageSync({ kind: 'saving' });
    const rounded = Math.round(seconds * 1000) / 1000;
    const result = await this.port.submitBestTime(missionId, nickname, rounded);
    if (!reportToStage) return;
    this.ui.setStageSync(
      result.ok
        ? { kind: 'saved', improved: result.value.improved, bestTimeSeconds: result.value.bestTimeSeconds }
        : { kind: 'offline' },
    );
  }

  private async registerWinner(view: WinnerView): Promise<void> {
    if (!this.online) {
      this.ui.setWinnerCode(view, 'offline');
      return;
    }
    const result = await this.port.registerWinner({
      nickname: view.nickname,
      code: view.code,
      times: view.times,
      totalSeconds: view.totalSeconds,
    });
    // A returning winner keeps the code that was registered first.
    this.ui.setWinnerCode(
      result.ok ? { ...view, code: result.value } : view,
      result.ok ? 'registered' : 'offline',
    );
  }

  private readStoredNickname(): string | null {
    try {
      return this.storage?.getItem(NICKNAME_STORAGE_KEY) ?? null;
    } catch {
      return null;
    }
  }

  private writeStoredNickname(nickname: string): void {
    try {
      this.storage?.setItem(NICKNAME_STORAGE_KEY, nickname);
    } catch {
      // Storage may be unavailable (private mode); the nickname just won't be remembered.
    }
  }
}

function cryptoRandom(): number {
  const cryptoApi = (globalThis as { crypto?: Crypto }).crypto;
  if (cryptoApi?.getRandomValues) {
    const buffer = new Uint32Array(1);
    cryptoApi.getRandomValues(buffer);
    return (buffer[0] ?? 0) / 4294967296;
  }
  return Math.random();
}
