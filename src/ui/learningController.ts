/**
 * "Aprender jugando" DOM layer: the /rewind pill, one-shot learning toasts with a link to the free
 * lesson, the police-hack terminal, the Modo Plan briefing and the Álbum Claude. Logic-free: all
 * state comes from LearningSession and all copy from LOCALE_DEVHACK.learning.
 */

import { LOCALE_DEVHACK } from '../config/localeCali';
import type { HackQuestion } from '../config/hackQuestions';
import {
  CLAUDE_CARD_KEYS,
  CLAUDE_CARD_LESSONS,
  LESSONS,
  lessonLinks,
  type ClaudeCardKey,
  type LessonKey,
} from '../missions/learningCatalog';
import type { MissionId } from '../types/game';

export type PlanChoice = 'turbo' | 'stealth';

const COPY = LOCALE_DEVHACK.learning;
const TOAST_SECONDS = 8;
const FEEDBACK_SECONDS = 2.2;

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

function lessonAnchor(lesson: LessonKey, text: string, testId?: string): HTMLAnchorElement {
  const link = el('a', 'cali-learn-link', testId, text);
  link.href = lessonLinks(lesson).courseUrl;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  return link;
}

function lessonCaption(lesson: LessonKey): string {
  const ref = LESSONS[lesson];
  return COPY.lessonLabel(COPY.courseNames[ref.courseId], ref.lessonNumber);
}

export interface LearningUiCallbacks {
  onPlayPromptMission(): void;
  onOpenAlbum(): void;
  onHackAnswer(index: number): void;
  onPlanChosen(choice: PlanChoice): void;
  onAlbumClosed(): void;
}

export class LearningController {
  private readonly root: HTMLElement;
  private readonly callbacks: LearningUiCallbacks;
  private readonly cleanups: Array<() => void> = [];

  private readonly pill: HTMLElement;
  private readonly toast: HTMLElement;
  private readonly toastTitle: HTMLElement;
  private readonly toastBody: HTMLElement;
  private readonly toastLinkSlot: HTMLElement;
  /** Wall-clock deadline: game dt is clamped per frame, so slow devices would stretch toasts. */
  private toastHideAtMs = 0;

  private readonly hack: HTMLElement;
  private readonly hackPrompt: HTMLElement;
  private readonly hackOptions: HTMLButtonElement[] = [];
  private readonly hackTimer: HTMLElement;
  private readonly hackFeedback: HTMLElement;
  private feedbackRemaining = 0;
  private shownHackIndex = -1;

  private readonly planOverlay: HTMLElement;
  private readonly planSteps: HTMLElement;
  private planOpen = false;

  private readonly albumOverlay: HTMLElement;
  private readonly albumSubtitle: HTMLElement;
  private readonly albumGrid: HTMLElement;
  private albumOpen = false;

  private titleAlbumProgress: HTMLElement | null = null;
  private readonly titleNodes: HTMLElement[] = [];

  public constructor(root: HTMLElement, callbacks: LearningUiCallbacks) {
    this.root = root;
    this.callbacks = callbacks;

    this.pill = el('div', 'cali-learn-pill', 'learn-rewind-pill');
    this.pill.hidden = true;

    this.toast = el('aside', 'cali-learn-toast', 'learn-toast');
    this.toast.setAttribute('role', 'status');
    this.toast.hidden = true;
    const toastHead = el('div', 'cali-learn-toast-head');
    this.toastTitle = el('strong', 'cali-learn-toast-title', 'learn-toast-title');
    const close = el('button', 'cali-learn-toast-close', 'btn-learn-toast-close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', COPY.dismiss);
    this.listen(close, 'click', () => this.hideToast());
    toastHead.append(this.toastTitle, close);
    this.toastBody = el('p', 'cali-learn-toast-body', 'learn-toast-body');
    this.toastLinkSlot = el('div', 'cali-learn-toast-links');
    this.toast.append(toastHead, this.toastBody, this.toastLinkSlot);

    this.hack = el('section', 'cali-learn-hack', 'learn-hack');
    this.hack.setAttribute('role', 'alertdialog');
    this.hack.hidden = true;
    const hackTitle = el('div', 'cali-learn-hack-title', undefined, COPY.hack.title);
    const hackSubtitle = el('div', 'cali-learn-hack-sub', undefined, COPY.hack.subtitle);
    this.hackPrompt = el('p', 'cali-learn-hack-prompt', 'learn-hack-prompt');
    const optionsBox = el('div', 'cali-learn-hack-options');
    for (let index = 0; index < 3; index += 1) {
      const option = el('button', 'cali-learn-hack-option', `btn-hack-option-${index + 1}`);
      option.type = 'button';
      this.listen(option, 'click', () => this.callbacks.onHackAnswer(index));
      this.hackOptions.push(option);
      optionsBox.appendChild(option);
    }
    this.hackTimer = el('div', 'cali-learn-hack-timer', 'learn-hack-timer');
    this.hackFeedback = el('div', 'cali-learn-hack-feedback', 'learn-hack-feedback');
    this.hackFeedback.hidden = true;
    this.hack.append(hackTitle, hackSubtitle, this.hackPrompt, optionsBox, this.hackTimer);

    this.planOverlay = el('div', 'cali-overlay cali-overlay--modal cali-learn-plan', 'learn-plan');
    this.planOverlay.setAttribute('role', 'dialog');
    this.planOverlay.setAttribute('aria-modal', 'true');
    this.planOverlay.hidden = true;
    const planPanel = el('div', 'cali-panel cali-modal cali-learn-terminal');
    const planTitle = el('h2', 'cali-learn-terminal-title', undefined, COPY.plan.title);
    const planSubtitle = el('p', 'cali-modal-subtitle', undefined, COPY.plan.subtitle);
    this.planSteps = el('ol', 'cali-learn-plan-steps', 'learn-plan-steps');
    const planActions = el('div', 'cali-learn-plan-options');
    for (const choice of ['turbo', 'stealth'] as const) {
      const option = COPY.plan.options[choice];
      const button = el('button', 'cali-btn cali-btn--primary cali-learn-plan-option', `btn-plan-${choice}`);
      button.type = 'button';
      button.append(el('strong', undefined, undefined, `${COPY.plan.approve}: ${option.label}`));
      button.append(el('span', undefined, undefined, option.detail));
      this.listen(button, 'click', () => this.callbacks.onPlanChosen(choice));
      planActions.appendChild(button);
    }
    planPanel.append(
      planTitle,
      planSubtitle,
      this.planSteps,
      planActions,
      lessonAnchor('cc_plan_mode', `${COPY.lessonCta}: ${lessonCaption('cc_plan_mode')}`, 'learn-plan-link'),
    );
    this.planOverlay.appendChild(planPanel);

    this.albumOverlay = el('div', 'cali-overlay cali-overlay--modal cali-learn-album', 'learn-album');
    this.albumOverlay.setAttribute('role', 'dialog');
    this.albumOverlay.setAttribute('aria-modal', 'true');
    this.albumOverlay.hidden = true;
    const albumPanel = el('div', 'cali-panel cali-modal cali-modal--wide');
    const albumTitle = el('h2', 'cali-modal-title', undefined, COPY.album.title);
    this.albumSubtitle = el('p', 'cali-modal-subtitle', 'learn-album-count');
    this.albumGrid = el('div', 'cali-learn-album-grid', 'learn-album-grid');
    const reward = el('p', 'cali-learn-album-reward', undefined, COPY.album.reward);
    const albumClose = el('button', 'cali-btn cali-btn--secondary', 'btn-album-close', COPY.album.close);
    albumClose.type = 'button';
    this.listen(albumClose, 'click', () => this.callbacks.onAlbumClosed());
    albumPanel.append(albumTitle, this.albumSubtitle, this.albumGrid, reward, albumClose);
    this.albumOverlay.appendChild(albumPanel);

    this.root.append(this.pill, this.toast, this.hack, this.hackFeedback, this.planOverlay, this.albumOverlay);
  }

  // ---- Title screen ----------------------------------------------------------------------------

  /**
   * "Aprende Claude mientras juegas" showcase (above the Reto card) plus the "Creado por DevHack"
   * corner badge on the title screen.
   */
  public mountTitleShowcase(titleScreen: HTMLElement, cardsCollected: number): void {
    const copy = COPY.showcase;
    const card = el('section', 'cali-panel cali-learn-showcase', 'learn-showcase');
    card.setAttribute('aria-label', copy.title);
    const badge = el('span', 'cali-badge cali-learn-showcase-badge', undefined, copy.badge);
    const title = el('h2', 'cali-learn-showcase-title', undefined, copy.title);
    const subtitle = el('p', 'cali-learn-showcase-subtitle', undefined, copy.subtitle);

    const grid = el('ul', 'cali-learn-showcase-grid', 'learn-showcase-features');
    for (const feature of copy.features) {
      const item = el('li', 'cali-learn-feature', `learn-feature-${feature.id}`);
      item.append(
        el('code', 'cali-learn-feature-cmd', undefined, feature.command),
        el('strong', 'cali-learn-feature-title', undefined, feature.title),
        el('span', 'cali-learn-feature-detail', undefined, feature.detail),
        el('span', 'cali-learn-feature-lesson', undefined, feature.lesson),
      );
      grid.appendChild(item);
    }

    const actions = el('div', 'cali-learn-showcase-actions');
    const play = el('button', 'cali-btn cali-btn--primary cali-learn-showcase-play', 'btn-learn-play-m5', copy.playCta);
    play.type = 'button';
    this.listen(play, 'click', () => this.callbacks.onPlayPromptMission());
    const album = el('button', 'cali-btn cali-btn--secondary', 'btn-learn-title-album');
    album.type = 'button';
    album.append(el('span', undefined, undefined, `✦ ${copy.albumCta}`));
    this.titleAlbumProgress = el('span', 'cali-learn-showcase-progress', 'learn-title-album-progress');
    album.append(this.titleAlbumProgress);
    this.listen(album, 'click', () => this.callbacks.onOpenAlbum());
    actions.append(play, album);

    const footnote = el('p', 'cali-learn-showcase-footnote');
    footnote.append(
      el('span', undefined, undefined, `${copy.footnote} `),
      lessonAnchor('cc_agentic_loop', COPY.courseNames['claude-code-desde-cero']),
      el('span', undefined, undefined, ' · '),
      lessonAnchor('cpt_prompt_4', COPY.courseNames['claude-para-todos']),
    );

    card.append(badge, title, subtitle, grid, actions, footnote);
    this.setTitleAlbumCount(cardsCollected);

    const retoCard =
      typeof titleScreen.querySelector === 'function' ? titleScreen.querySelector('.cali-reto-card') : null;
    if (retoCard && typeof retoCard.before === 'function') {
      retoCard.before(card);
    } else {
      titleScreen.appendChild(card);
    }

    const made = COPY.madeBy;
    const madeBy = el('a', 'cali-made-by', 'made-by-devhack');
    madeBy.href = made.url;
    madeBy.target = '_blank';
    madeBy.rel = 'noopener';
    madeBy.setAttribute('aria-label', made.ariaLabel);
    const mark = el('span', 'cali-made-by-mark', undefined, '</>');
    mark.setAttribute('aria-hidden', 'true');
    const text = el('span', 'cali-made-by-text');
    text.append(
      el('span', 'cali-made-by-prefix', undefined, made.prefix),
      el('strong', 'cali-made-by-brand', undefined, made.brand),
      el('span', 'cali-made-by-detail', undefined, made.detail),
    );
    madeBy.append(mark, text);
    titleScreen.appendChild(madeBy);
    this.titleNodes.push(card, madeBy);
  }

  public setTitleAlbumCount(have: number): void {
    if (this.titleAlbumProgress) {
      this.titleAlbumProgress.textContent = COPY.showcase.albumProgress(have, CLAUDE_CARD_KEYS.length);
    }
  }

  // ---- Per-frame -----------------------------------------------------------------------------

  public update(dt: number): void {
    const safeDt = Number.isFinite(dt) && dt > 0 ? dt : 0;
    if (this.toastHideAtMs > 0 && Date.now() >= this.toastHideAtMs) {
      this.hideToast();
    }
    if (this.feedbackRemaining > 0) {
      this.feedbackRemaining -= safeDt;
      if (this.feedbackRemaining <= 0) this.hackFeedback.hidden = true;
    }
  }

  public renderPill(charges: number | null): void {
    const visible = charges !== null;
    if (this.pill.hidden === visible) this.pill.hidden = !visible;
    if (charges === null) return;
    const text = COPY.rewindPill(charges);
    if (this.pill.textContent !== text) this.pill.textContent = text;
    this.pill.dataset.empty = charges <= 0 ? 'true' : 'false';
  }

  public renderHack(
    hack: { readonly questionIndex: number; readonly remainingSeconds: number } | null,
    questions: readonly HackQuestion[],
  ): void {
    if (!hack) {
      if (!this.hack.hidden) this.hack.hidden = true;
      this.shownHackIndex = -1;
      return;
    }
    const question = questions[hack.questionIndex];
    if (!question) return;
    if (this.shownHackIndex !== hack.questionIndex) {
      this.shownHackIndex = hack.questionIndex;
      this.hackPrompt.textContent = `$ ${question.prompt}`;
      question.options.forEach((option, index) => {
        const button = this.hackOptions[index];
        if (button) button.textContent = `[${index + 1}] ${option}`;
      });
    }
    this.hackTimer.textContent = `${Math.max(0, hack.remainingSeconds).toFixed(1)} s`;
    if (this.hack.hidden) this.hack.hidden = false;
  }

  /** Short centre-screen flash (hack result, /rewind, card pickups). */
  public flash(text: string, kind: 'correct' | 'wrong'): void {
    this.hackFeedback.textContent = text;
    this.hackFeedback.dataset.kind = kind;
    this.hackFeedback.hidden = false;
    this.feedbackRemaining = FEEDBACK_SECONDS;
  }

  // ---- Toasts --------------------------------------------------------------------------------

  /** Shows a short, skippable learning toast. It never pauses the game. */
  public showToast(title: string, body: string, lesson: LessonKey | null): void {
    this.toastTitle.textContent = title;
    this.toastBody.textContent = body;
    this.toastLinkSlot.replaceChildren();
    if (lesson) {
      this.toastLinkSlot.append(
        lessonAnchor(lesson, `${COPY.lessonCta} · ${lessonCaption(lesson)}`, 'learn-toast-link'),
      );
    }
    this.toast.hidden = false;
    this.toastHideAtMs = Date.now() + TOAST_SECONDS * 1000;
  }

  public hideToast(): void {
    this.toast.hidden = true;
    this.toastHideAtMs = 0;
  }

  // ---- Modo Plan -----------------------------------------------------------------------------

  public openPlan(missionId: MissionId): void {
    const steps = COPY.plan.steps[missionId as keyof typeof COPY.plan.steps] ?? [];
    this.planSteps.replaceChildren(...steps.map((step) => el('li', undefined, undefined, step)));
    this.planOverlay.hidden = false;
    this.planOpen = true;
  }

  public closePlan(): void {
    this.planOverlay.hidden = true;
    this.planOpen = false;
  }

  public isPlanOpen(): boolean {
    return this.planOpen;
  }

  // ---- Álbum Claude --------------------------------------------------------------------------

  public openAlbum(collected: readonly ClaudeCardKey[]): void {
    this.albumSubtitle.textContent = COPY.album.subtitle(collected.length, CLAUDE_CARD_KEYS.length);
    this.albumGrid.replaceChildren(
      ...CLAUDE_CARD_KEYS.map((card, index) => {
        const owned = collected.includes(card);
        const tile = el('article', 'cali-learn-card', `album-card-${card}`);
        tile.dataset.owned = owned ? 'true' : 'false';
        tile.append(el('span', 'cali-learn-card-num', undefined, `${index + 1}/10`));
        if (owned) {
          const copy = COPY.cards[card];
          const lesson = CLAUDE_CARD_LESSONS[card];
          tile.append(
            el('strong', 'cali-learn-card-title', undefined, copy.title),
            el('p', 'cali-learn-card-body', undefined, copy.body),
            lessonAnchor(lesson, `${COPY.lessonCta} →`),
          );
        } else {
          tile.append(
            el('strong', 'cali-learn-card-title', undefined, COPY.album.locked),
            el('p', 'cali-learn-card-body', undefined, COPY.album.lockedHint),
          );
        }
        return tile;
      }),
    );
    this.albumOverlay.hidden = false;
    this.albumOpen = true;
  }

  public closeAlbum(): void {
    this.albumOverlay.hidden = true;
    this.albumOpen = false;
  }

  public isAlbumOpen(): boolean {
    return this.albumOpen;
  }

  public dispose(): void {
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    for (const node of [
      this.pill,
      this.toast,
      this.hack,
      this.hackFeedback,
      this.planOverlay,
      this.albumOverlay,
      ...this.titleNodes,
    ]) {
      node.remove();
    }
  }

  private listen(target: HTMLElement, type: string, handler: () => void): void {
    const wrapped = (): void => handler();
    target.addEventListener(type, wrapped);
    this.cleanups.push(() => target.removeEventListener(type, wrapped));
  }
}
