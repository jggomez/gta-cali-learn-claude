/**
 * Reto AcaDevHack DOM layer: title card + free-course promo, nickname modal, stage/failed/winner
 * modals, the live ranking modal, and the in-run HUD chip. All copy comes from LOCALE_DEVHACK;
 * every action is routed through ChallengeUiCallbacks so the controller stays logic-free.
 */

import { LOCALE_DEVHACK } from '../config/localeCali';
import {
  CHALLENGE_ORDER,
  buildWhatsappClaimUrl,
  validateNickname,
  type ChallengeSnapshot,
} from '../missions/devhackChallenge';
import type { LeaderboardEntry, LeaderboardErrorCode, Result } from '../services/leaderboardPort';
import type { MissionId } from '../types/game';

export interface ChallengeUiCallbacks {
  claimNickname(nickname: string): Promise<Result<string>>;
  /** `online` is false when the player chose to play without the ranking. */
  startRun(nickname: string, online: boolean): void;
  fetchTop(missionId: MissionId): Promise<Result<readonly LeaderboardEntry[]>>;
  nextStage(): void;
  retryRun(): void;
  quit(): void;
  currentUid(): string | null;
}

export type StageSyncState =
  | { readonly kind: 'saving' }
  | { readonly kind: 'saved'; readonly improved: boolean; readonly bestTimeSeconds: number }
  | { readonly kind: 'offline' };

export interface WinnerView {
  readonly nickname: string;
  readonly code: string;
  readonly totalSeconds: number;
  readonly times: Readonly<Record<MissionId, number>>;
}

export function formatChallengeTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--.--';
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  return `${String(minutes).padStart(2, '0')}:${rest.toFixed(2).padStart(5, '0')}`;
}

const RANKING_LIMIT = 10;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  testId?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (testId) node.dataset.testid = testId;
  if (text !== undefined) node.textContent = text;
  return node;
}

function externalLink(text: string, href: string, className: string, testId?: string): HTMLAnchorElement {
  const link = el('a', className, testId, text);
  link.href = href;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  return link;
}

interface ModalParts {
  readonly overlay: HTMLElement;
  readonly modal: HTMLElement;
}

export class ChallengeController {
  private readonly root: HTMLElement;
  private readonly callbacks: ChallengeUiCallbacks;
  private readonly cleanups: Array<() => void> = [];

  private readonly hudChip: HTMLElement;

  private readonly nicknameParts: ModalParts;
  private readonly nicknameInput: HTMLInputElement;
  private readonly nicknameError: HTMLElement;
  private readonly nicknameStartBtn: HTMLButtonElement;
  private readonly nicknameOfflineBtn: HTMLButtonElement;

  private readonly stageParts: ModalParts;
  private readonly stageTitle: HTMLElement;
  private readonly stageProgress: HTMLElement;
  private readonly stageTime: HTMLElement;
  private readonly stageSync: HTMLElement;
  private readonly stageNextBtn: HTMLButtonElement;

  private readonly failedParts: ModalParts;
  private readonly failedSubtitle: HTMLElement;

  private readonly winnerParts: ModalParts;
  private readonly winnerCode: HTMLElement;
  private readonly winnerTotal: HTMLElement;
  private readonly winnerTimes: HTMLElement;
  private readonly winnerStatus: HTMLElement;
  private readonly winnerClaim: HTMLAnchorElement;

  private readonly rankingParts: ModalParts;
  private readonly rankingTabs = new Map<MissionId, HTMLButtonElement>();
  private readonly rankingBody: HTMLElement;
  private rankingMission: MissionId = 'mission_1_bulevar';
  private rankingRequest = 0;

  private nicknameBusy = false;

  public constructor(root: HTMLElement, callbacks: ChallengeUiCallbacks) {
    this.root = root;
    this.callbacks = callbacks;

    this.hudChip = el('div', 'cali-reto-chip', 'reto-hud-chip');
    this.hudChip.setAttribute('role', 'status');
    this.hudChip.hidden = true;

    const nick = this.buildNicknameModal();
    this.nicknameParts = nick.parts;
    this.nicknameInput = nick.input;
    this.nicknameError = nick.error;
    this.nicknameStartBtn = nick.startBtn;
    this.nicknameOfflineBtn = nick.offlineBtn;

    const stage = this.buildStageModal();
    this.stageParts = stage.parts;
    this.stageTitle = stage.title;
    this.stageProgress = stage.progress;
    this.stageTime = stage.time;
    this.stageSync = stage.sync;
    this.stageNextBtn = stage.nextBtn;

    const failed = this.buildFailedModal();
    this.failedParts = failed.parts;
    this.failedSubtitle = failed.subtitle;

    const winner = this.buildWinnerModal();
    this.winnerParts = winner.parts;
    this.winnerCode = winner.code;
    this.winnerTotal = winner.total;
    this.winnerTimes = winner.times;
    this.winnerStatus = winner.status;
    this.winnerClaim = winner.claim;

    const ranking = this.buildRankingModal();
    this.rankingParts = ranking.parts;
    this.rankingBody = ranking.body;

    this.root.append(
      this.hudChip,
      this.nicknameParts.overlay,
      this.stageParts.overlay,
      this.failedParts.overlay,
      this.winnerParts.overlay,
      this.rankingParts.overlay,
    );
  }

  /** Inserts the featured challenge card and free-course promo into the title screen. */
  public mountTitleCard(titleScreen: HTMLElement): void {
    const copy = LOCALE_DEVHACK.titleCard;
    const card = el('div', 'cali-panel cali-reto-card', 'reto-title-card');
    const badge = el('span', 'cali-badge cali-reto-badge', undefined, copy.badge);
    const heading = el('h2', 'cali-reto-card-title', undefined, copy.title);
    const subtitle = el('p', 'cali-reto-card-subtitle', undefined, copy.subtitle);
    const desc = el('p', 'cali-reto-card-desc', undefined, copy.description);

    const actions = el('div', 'cali-reto-card-actions');
    const startBtn = this.button(copy.cta, 'cali-btn cali-btn--primary', 'btn-reto-start', () =>
      this.openNickname(),
    );
    const rankingBtn = this.button(copy.rankingCta, 'cali-btn cali-btn--secondary', 'btn-reto-ranking', () =>
      this.openRanking('mission_1_bulevar'),
    );
    actions.append(startBtn, rankingBtn);

    const courses = el('div', 'cali-reto-courses', 'reto-free-courses');
    const coursesTitle = el('span', 'cali-reto-courses-title', undefined, LOCALE_DEVHACK.coursesTitle);
    courses.appendChild(coursesTitle);
    for (const course of LOCALE_DEVHACK.freeCourses) {
      const link = externalLink('', course.url, 'cali-reto-course');
      link.append(
        el('strong', undefined, undefined, course.title),
        el('span', undefined, undefined, course.detail),
      );
      courses.appendChild(link);
    }

    card.append(badge, heading, subtitle, desc, actions, courses);
    const grid =
      typeof titleScreen.querySelector === 'function'
        ? titleScreen.querySelector('.cali-mission-grid')
        : null;
    if (grid && typeof grid.before === 'function') {
      grid.before(card);
    } else {
      titleScreen.appendChild(card);
    }
  }

  public renderHudChip(snapshot: ChallengeSnapshot, elapsedSeconds: number, visible: boolean): void {
    const show = visible && snapshot.status === 'running';
    if (this.hudChip.hidden === show) this.hudChip.hidden = !show;
    if (!show) return;
    const text = LOCALE_DEVHACK.hudChip(
      snapshot.stageIndex + 1,
      snapshot.totalStages,
      formatChallengeTime(snapshot.totalSeconds + Math.max(0, elapsedSeconds)),
    );
    if (this.hudChip.textContent !== text) this.hudChip.textContent = text;
  }

  public openNickname(prefill = ''): void {
    this.hideAll();
    this.nicknameInput.value = prefill || this.nicknameInput.value;
    this.nicknameError.textContent = '';
    this.nicknameOfflineBtn.hidden = true;
    this.setNicknameBusy(false);
    this.nicknameParts.overlay.hidden = false;
    this.nicknameInput.focus();
  }

  public setStoredNickname(nickname: string): void {
    this.nicknameInput.value = nickname;
  }

  public showStagePassed(missionId: MissionId, seconds: number, done: number, total: number): void {
    this.hideAll();
    const copy = LOCALE_DEVHACK.stagePassed;
    this.stageTitle.textContent = `${copy.title} · ${LOCALE_DEVHACK.stageLabels[missionId]}`;
    this.stageProgress.textContent = copy.progress(done, total);
    this.stageTime.textContent = formatChallengeTime(seconds);
    const next = CHALLENGE_ORDER[done];
    this.stageNextBtn.textContent = next
      ? `${copy.next}: ${LOCALE_DEVHACK.stageLabels[next]}`
      : copy.next;
    this.rankingMission = missionId;
    this.stageParts.overlay.hidden = false;
  }

  public setStageSync(state: StageSyncState): void {
    const copy = LOCALE_DEVHACK.stagePassed;
    this.stageSync.dataset.state = state.kind;
    if (state.kind === 'saving') {
      this.stageSync.textContent = copy.saving;
    } else if (state.kind === 'offline') {
      this.stageSync.textContent = copy.offline;
    } else {
      this.stageSync.textContent = state.improved
        ? `${copy.personalBest} ${copy.bestLabel}: ${formatChallengeTime(state.bestTimeSeconds)}`
        : `${copy.saved} ${copy.bestLabel}: ${formatChallengeTime(state.bestTimeSeconds)}`;
    }
  }

  public showFailed(reason: 'failed' | 'implausible'): void {
    this.hideAll();
    this.failedSubtitle.textContent =
      reason === 'implausible' ? LOCALE_DEVHACK.failed.implausible : LOCALE_DEVHACK.failed.subtitle;
    this.failedParts.overlay.hidden = false;
  }

  public showWinner(view: WinnerView): void {
    this.hideAll();
    this.winnerTotal.textContent = formatChallengeTime(view.totalSeconds);
    this.winnerTimes.replaceChildren(
      ...CHALLENGE_ORDER.map((missionId) =>
        el(
          'li',
          undefined,
          undefined,
          `${LOCALE_DEVHACK.stageLabels[missionId]} · ${formatChallengeTime(view.times[missionId])}`,
        ),
      ),
    );
    this.setWinnerCode(view, 'registering');
    this.winnerParts.overlay.hidden = false;
  }

  public setWinnerCode(view: WinnerView, status: 'registering' | 'registered' | 'offline'): void {
    const copy = LOCALE_DEVHACK.winner;
    this.winnerCode.textContent = view.code;
    this.winnerStatus.dataset.state = status;
    this.winnerStatus.textContent =
      status === 'registering' ? copy.registering : status === 'offline' ? copy.offline : copy.note;
    this.winnerClaim.href = buildWhatsappClaimUrl(
      LOCALE_DEVHACK.whatsappPhone,
      copy.whatsappMessage(view.nickname, view.code, formatChallengeTime(view.totalSeconds)),
    );
  }

  public openRanking(missionId: MissionId = this.rankingMission): void {
    this.rankingParts.overlay.hidden = false;
    void this.loadRanking(missionId);
  }

  public hideAll(): void {
    for (const parts of [
      this.nicknameParts,
      this.stageParts,
      this.failedParts,
      this.winnerParts,
      this.rankingParts,
    ]) {
      parts.overlay.hidden = true;
    }
  }

  public isBlockingGameplay(): boolean {
    return [this.nicknameParts, this.rankingParts].some((parts) => !parts.overlay.hidden);
  }

  public dispose(): void {
    for (const cleanup of this.cleanups) cleanup();
    this.cleanups.length = 0;
    for (const node of [
      this.hudChip,
      this.nicknameParts.overlay,
      this.stageParts.overlay,
      this.failedParts.overlay,
      this.winnerParts.overlay,
      this.rankingParts.overlay,
    ]) {
      node.remove();
    }
  }

  // ------------------------------------------------------------------------------------------
  // Builders
  // ------------------------------------------------------------------------------------------

  private button(
    text: string,
    className: string,
    testId: string,
    handler: () => void,
  ): HTMLButtonElement {
    const btn = el('button', className, testId, text);
    btn.type = 'button';
    const listener = (): void => handler();
    btn.addEventListener('click', listener);
    this.cleanups.push(() => btn.removeEventListener('click', listener));
    return btn;
  }

  private modal(testId: string, extraClass: string, labelText: string): ModalParts {
    const overlay = el('div', 'cali-overlay cali-overlay--reto', testId);
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', labelText);
    overlay.hidden = true;
    const modal = el('div', `cali-panel cali-modal cali-modal--reto ${extraClass}`);
    overlay.appendChild(modal);
    return { overlay, modal };
  }

  private buildNicknameModal(): {
    parts: ModalParts;
    input: HTMLInputElement;
    error: HTMLElement;
    startBtn: HTMLButtonElement;
    offlineBtn: HTMLButtonElement;
  } {
    const copy = LOCALE_DEVHACK.nickname;
    const parts = this.modal('reto-nickname-modal', '', copy.title);
    const title = el('h2', 'cali-modal-title', undefined, copy.title);
    const help = el('p', 'cali-modal-subtitle', undefined, copy.help);

    const form = el('form', 'cali-reto-form');
    const label = el('label', 'cali-reto-label', undefined, copy.label);
    const input = el('input', 'cali-reto-input', 'reto-nickname-input');
    input.type = 'text';
    input.name = 'nickname';
    input.autocomplete = 'off';
    input.maxLength = 16;
    input.placeholder = copy.placeholder;
    input.spellcheck = false;
    input.id = 'reto-nickname-input';
    label.htmlFor = input.id;
    const error = el('p', 'cali-reto-error', 'reto-nickname-error');
    error.setAttribute('role', 'alert');
    const rules = el('p', 'cali-reto-rules', undefined, copy.rules);

    const actions = el('div', 'cali-modal-actions');
    const startBtn = el('button', 'cali-btn cali-btn--primary', 'btn-reto-nickname-start', copy.start);
    startBtn.type = 'submit';
    const offlineBtn = this.button(copy.playOffline, 'cali-btn cali-btn--secondary', 'btn-reto-offline', () => {
      const nickname = input.value.trim();
      if (validateNickname(nickname) === 'ok') {
        this.hideAll();
        this.callbacks.startRun(nickname, false);
      }
    });
    offlineBtn.hidden = true;
    const cancelBtn = this.button(copy.cancel, 'cali-btn cali-btn--ghost', 'btn-reto-nickname-cancel', () =>
      this.hideAll(),
    );
    actions.append(startBtn, offlineBtn, cancelBtn);

    const onSubmit = (event: Event): void => {
      event.preventDefault();
      void this.submitNickname();
    };
    form.addEventListener('submit', onSubmit);
    this.cleanups.push(() => form.removeEventListener('submit', onSubmit));
    // Keep gameplay hotkeys (G, Q, P...) from firing while typing.
    const stopKeys = (event: Event): void => event.stopPropagation();
    input.addEventListener('keydown', stopKeys);
    input.addEventListener('keyup', stopKeys);
    this.cleanups.push(() => {
      input.removeEventListener('keydown', stopKeys);
      input.removeEventListener('keyup', stopKeys);
    });

    form.append(label, input, error, rules, actions);
    parts.modal.append(title, help, form);
    return { parts, input, error, startBtn, offlineBtn };
  }

  private async submitNickname(): Promise<void> {
    if (this.nicknameBusy) return;
    const copy = LOCALE_DEVHACK.nickname;
    const nickname = this.nicknameInput.value.trim();
    const validation = validateNickname(nickname);
    if (validation !== 'ok') {
      this.nicknameError.textContent = copy.errors[validation];
      return;
    }
    this.setNicknameBusy(true);
    this.nicknameError.textContent = copy.checking;
    const result = await this.callbacks.claimNickname(nickname);
    this.setNicknameBusy(false);
    if (result.ok) {
      this.hideAll();
      this.callbacks.startRun(result.value, true);
      return;
    }
    this.nicknameError.textContent = copy.errors[result.error];
    // Network/auth problems still let the player race; ranking writes are skipped.
    this.nicknameOfflineBtn.hidden = !isConnectivityError(result.error);
  }

  private setNicknameBusy(busy: boolean): void {
    this.nicknameBusy = busy;
    this.nicknameStartBtn.disabled = busy;
    this.nicknameInput.disabled = busy;
  }

  private buildStageModal(): {
    parts: ModalParts;
    title: HTMLElement;
    progress: HTMLElement;
    time: HTMLElement;
    sync: HTMLElement;
    nextBtn: HTMLButtonElement;
  } {
    const copy = LOCALE_DEVHACK.stagePassed;
    const parts = this.modal('reto-stage-modal', 'cali-modal--success', copy.title);
    const title = el('h2', 'cali-banner-title cali-banner-title--success', undefined, copy.title);
    const progress = el('p', 'cali-modal-subtitle', 'reto-stage-progress');
    const stats = el('dl', 'cali-stats-grid');
    const time = el('dd', 'cali-mono', 'reto-stage-time');
    stats.append(el('dt', undefined, undefined, copy.timeLabel), time);
    const sync = el('p', 'cali-reto-sync', 'reto-stage-sync');
    sync.setAttribute('role', 'status');

    const actions = el('div', 'cali-modal-actions');
    const nextBtn = this.button(copy.next, 'cali-btn cali-btn--primary', 'btn-reto-next', () => {
      this.hideAll();
      this.callbacks.nextStage();
    });
    const rankingBtn = this.button(copy.ranking, 'cali-btn cali-btn--secondary', 'btn-reto-stage-ranking', () =>
      this.openRanking(),
    );
    const quitBtn = this.button(copy.quit, 'cali-btn cali-btn--ghost', 'btn-reto-quit', () => {
      this.hideAll();
      this.callbacks.quit();
    });
    actions.append(nextBtn, rankingBtn, quitBtn);
    parts.modal.append(title, progress, stats, sync, actions);
    return { parts, title, progress, time, sync, nextBtn };
  }

  private buildFailedModal(): { parts: ModalParts; subtitle: HTMLElement } {
    const copy = LOCALE_DEVHACK.failed;
    const parts = this.modal('reto-failed-modal', 'cali-modal--busted', copy.title);
    const title = el('h2', 'cali-banner-title cali-banner-title--busted', undefined, copy.title);
    const subtitle = el('p', 'cali-modal-subtitle', 'reto-failed-subtitle', copy.subtitle);
    const actions = el('div', 'cali-modal-actions');
    actions.append(
      this.button(copy.retry, 'cali-btn cali-btn--primary', 'btn-reto-retry', () => {
        this.hideAll();
        this.callbacks.retryRun();
      }),
      this.button(copy.quit, 'cali-btn cali-btn--ghost', 'btn-reto-failed-title', () => {
        this.hideAll();
        this.callbacks.quit();
      }),
    );
    parts.modal.append(title, subtitle, actions);
    return { parts, subtitle };
  }

  private buildWinnerModal(): {
    parts: ModalParts;
    code: HTMLElement;
    total: HTMLElement;
    times: HTMLElement;
    status: HTMLElement;
    claim: HTMLAnchorElement;
  } {
    const copy = LOCALE_DEVHACK.winner;
    const parts = this.modal('reto-winner-modal', 'cali-modal--victory cali-modal--reto-winner', copy.title);
    const title = el('h2', 'cali-display-title cali-reto-winner-title', undefined, copy.title);
    const subtitle = el('p', 'cali-modal-subtitle', undefined, copy.subtitle);
    const codeLabel = el('span', 'cali-reto-code-label', undefined, copy.codeLabel);
    const code = el('output', 'cali-reto-code cali-mono', 'reto-winner-code');
    const stats = el('dl', 'cali-stats-grid');
    const total = el('dd', 'cali-mono', 'reto-winner-total');
    stats.append(el('dt', undefined, undefined, copy.totalLabel), total);
    const times = el('ul', 'cali-reto-times cali-mono', 'reto-winner-times');
    const status = el('p', 'cali-reto-sync', 'reto-winner-status');
    status.setAttribute('role', 'status');

    const actions = el('div', 'cali-modal-actions');
    const claim = externalLink(copy.claim, 'https://wa.me/', 'cali-btn cali-btn--primary cali-reto-claim', 'btn-reto-claim');
    const subscription = externalLink(
      copy.subscription,
      LOCALE_DEVHACK.links.subscription,
      'cali-btn cali-btn--secondary',
      'btn-reto-subscription',
    );
    const titleBtn = this.button(copy.backToTitle, 'cali-btn cali-btn--ghost', 'btn-reto-winner-title', () => {
      this.hideAll();
      this.callbacks.quit();
    });
    actions.append(claim, subscription, titleBtn);
    parts.modal.append(title, subtitle, codeLabel, code, stats, times, status, actions);
    return { parts, code, total, times, status, claim };
  }

  private buildRankingModal(): { parts: ModalParts; body: HTMLElement } {
    const copy = LOCALE_DEVHACK.ranking;
    const parts = this.modal('reto-ranking-modal', 'cali-modal--reto-ranking', copy.title);
    // The ranking can open above another challenge modal (e.g. stage passed).
    parts.overlay.className += ' cali-overlay--reto-top';
    const title = el('h2', 'cali-modal-title', undefined, copy.title);
    const subtitle = el('p', 'cali-modal-subtitle', undefined, copy.subtitle);
    const tabs = el('div', 'cali-reto-tabs');
    tabs.setAttribute('role', 'tablist');
    for (const missionId of CHALLENGE_ORDER) {
      const tab = this.button(
        LOCALE_DEVHACK.stageLabels[missionId],
        'cali-reto-tab',
        `reto-ranking-tab-${missionId}`,
        () => void this.loadRanking(missionId),
      );
      tab.setAttribute('role', 'tab');
      this.rankingTabs.set(missionId, tab);
      tabs.appendChild(tab);
    }
    const body = el('div', 'cali-reto-ranking-body', 'reto-ranking-body');
    body.setAttribute('role', 'tabpanel');
    body.setAttribute('aria-live', 'polite');
    const close = this.button(copy.close, 'cali-btn cali-btn--ghost', 'btn-reto-ranking-close', () => {
      parts.overlay.hidden = true;
    });
    parts.modal.append(title, subtitle, tabs, body, close);
    return { parts, body };
  }

  private async loadRanking(missionId: MissionId): Promise<void> {
    const copy = LOCALE_DEVHACK.ranking;
    this.rankingMission = missionId;
    for (const [id, tab] of this.rankingTabs) {
      const selected = id === missionId;
      tab.setAttribute('aria-selected', String(selected));
      tab.classList.toggle('is-active', selected);
    }
    const request = ++this.rankingRequest;
    this.rankingBody.replaceChildren(el('p', 'cali-reto-ranking-note', undefined, copy.loading));
    const result = await this.callbacks.fetchTop(missionId);
    if (request !== this.rankingRequest) return;
    if (!result.ok) {
      this.rankingBody.replaceChildren(
        el('p', 'cali-reto-ranking-note', 'reto-ranking-offline', copy.offline),
      );
      return;
    }
    if (result.value.length === 0) {
      this.rankingBody.replaceChildren(
        el('p', 'cali-reto-ranking-note', 'reto-ranking-empty', copy.empty),
      );
      return;
    }
    const uid = this.callbacks.currentUid();
    const table = el('table', 'cali-reto-table', 'reto-ranking-table');
    const head = el('thead');
    const headRow = el('tr');
    headRow.append(
      el('th', undefined, undefined, copy.position),
      el('th', undefined, undefined, copy.player),
      el('th', undefined, undefined, copy.time),
    );
    head.appendChild(headRow);
    const tbody = el('tbody');
    result.value.slice(0, RANKING_LIMIT).forEach((entry, index) => {
      const row = el('tr', entry.uid === uid ? 'is-you' : undefined);
      row.append(
        el('td', 'cali-mono', undefined, String(index + 1)),
        el('td', undefined, undefined, entry.uid === uid ? `${entry.nickname} ${copy.you}` : entry.nickname),
        el('td', 'cali-mono', undefined, formatChallengeTime(entry.bestTimeSeconds)),
      );
      tbody.appendChild(row);
    });
    table.append(head, tbody);
    this.rankingBody.replaceChildren(table);
  }
}

function isConnectivityError(code: LeaderboardErrorCode): boolean {
  return code === 'offline' || code === 'auth_unavailable' || code === 'unknown';
}
