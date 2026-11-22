/**
 * Accessible DOM HUD, Title Screen, Overlays, and Minimap controller for GTA VI: Cali.
 * Consumes readonly snapshots and routes all user actions through HudCallbacks.
 * All player-facing Español Caleño text is sourced strictly from LOCALE_CALI.
 */

import { CALI_MAP } from '../config/caliMap';
import { LOCALE_CALI } from '../config/localeCali';
import type {
  AudioState,
  CaliMapConfig,
  CameraMode,
  MissionId,
  MissionSnapshot,
  PlayerSnapshot,
  WorldSnapshot,
} from '../types/game';
import { MinimapRenderer } from './minimapRenderer';

export interface HudCallbacks {
  onStartMission(id: MissionId): void;
  onResume(): void;
  onRestart(): void;
  onReturnTitle(): void;
  onCycleRadio(): void;
  onToggleMute(): void;
  onToggleVoices?: () => void;
  onCycleCamera(): void;
  onTogglePause(): void;
  onRetryWebgl(): void;
  onToggleTimeOfDay?: () => void;
}

interface ListenerBinding {
  readonly target: EventTarget;
  readonly type: string;
  readonly handler: EventListener;
}

interface MissionCardRefs {
  readonly button: HTMLButtonElement;
  readonly recordBadge: HTMLSpanElement;
  readonly statusBadge: HTMLSpanElement;
}

function formatTimer(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) {
    return LOCALE_CALI.titleScreen.emptyTime;
  }
  const totalSeconds = Math.floor(seconds);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function formatCop(amount: number): string {
  const safe = Number.isFinite(amount) && amount > 0 ? Math.floor(amount) : 0;
  const formatted = String(safe).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `$ ${formatted} ${LOCALE_CALI.hud.cashCurrency}`;
}

export function formatNitroPercent(nitro: number): number {
  if (!Number.isFinite(nitro)) {
    return 0;
  }
  return Math.round(Math.max(0, Math.min(100, nitro)));
}

const STRAIGHT_THRESHOLD_RAD = Math.PI / 6;
const TURN_BACK_THRESHOLD_RAD = (Math.PI * 3) / 4;
const MAX_STEP_DOTS = 6;
const VOICES_BTN_BASE_CLASS = 'cali-btn cali-btn--ghost cali-btn--compact cali-voices-pill';
const VOICES_BTN_OFF_CLASS = `${VOICES_BTN_BASE_CLASS} cali-voices-pill--off`;

export function formatTurnCue(bearingDeltaRad: number | null | undefined): string {
  const rad =
    typeof bearingDeltaRad === 'number' && Number.isFinite(bearingDeltaRad)
      ? bearingDeltaRad
      : 0;
  const absRad = Math.abs(rad);
  if (absRad <= STRAIGHT_THRESHOLD_RAD) {
    return LOCALE_CALI.hud.directionStraight;
  }
  if (absRad >= TURN_BACK_THRESHOLD_RAD) {
    return LOCALE_CALI.hud.directionBack;
  }
  return rad > 0 ? LOCALE_CALI.hud.directionLeft : LOCALE_CALI.hud.directionRight;
}

function formatVehiclePrompt(player: PlayerSnapshot): string | null {
  if (player.mode === 'driving') {
    return LOCALE_CALI.hud.exitVehiclePrompt;
  }
  if (!player.canEnterVehicle) {
    return null;
  }
  if (player.nearbyVehicleKind) {
    const vehicleName = LOCALE_CALI.vehicleNames[player.nearbyVehicleKind];
    return player.nearbyVehicleKind === 'banshee'
      ? LOCALE_CALI.hud.enterNamedVehicle(vehicleName)
      : LOCALE_CALI.hud.hijackNamedVehicle(vehicleName);
  }
  return LOCALE_CALI.hud.enterVehiclePrompt;
}

function createEl<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  testId?: string,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (className) {
    el.className = className;
  }
  if (testId) {
    el.dataset.testid = testId;
  }
  return el;
}

function setText(el: HTMLElement, value: string): void {
  if (el.textContent !== value) {
    el.textContent = value;
  }
}

function setHidden(el: HTMLElement, hidden: boolean): void {
  if (el.hidden !== hidden) {
    el.hidden = hidden;
  }
}

export class HudController {
  private readonly root: HTMLElement;
  private readonly callbacks: HudCallbacks;
  private readonly map: CaliMapConfig;
  private readonly listeners: ListenerBinding[] = [];

  private readonly shell: HTMLDivElement;
  private readonly minimapRenderer: MinimapRenderer;

  // Screen & overlay roots
  private readonly titleScreen: HTMLElement;
  private readonly gameplayHud: HTMLElement;
  private readonly pauseOverlay: HTMLElement;
  private readonly missionPassedOverlay: HTMLElement;
  private readonly bustedOverlay: HTMLElement;
  private readonly victoryOverlay: HTMLElement;
  private readonly webglErrorOverlay: HTMLElement;

  // Title screen dynamic badges
  private readonly mission1Card: MissionCardRefs;
  private readonly mission2Card: MissionCardRefs;
  private readonly freeRoamCard: MissionCardRefs;

  // Gameplay HUD dynamic nodes
  private readonly objectiveTitle: HTMLElement;
  private readonly stepRow: HTMLElement;
  private readonly stepProgress: HTMLElement;
  private readonly stepDots: readonly HTMLSpanElement[];
  private readonly objectiveLabel: HTMLElement;
  private readonly objectiveDetail: HTMLElement;
  private readonly districtBadge: HTMLElement;
  private readonly landmarksBadge: HTMLElement;
  private readonly tickerText: HTMLElement;

  private readonly compassPill: HTMLElement;
  private readonly compassArrow: HTMLElement;
  private readonly compassCue: HTMLElement;
  private readonly compassDest: HTMLElement;
  private readonly compassDistance: HTMLElement;

  private readonly bannerBox: HTMLElement;
  private readonly bannerHeadline: HTMLElement;
  private readonly bannerSub: HTMLElement;

  private readonly wantedContainer: HTMLElement;
  private readonly wantedStars: readonly HTMLSpanElement[];
  private readonly bustWarning: HTMLElement;
  private readonly bustBarFill: HTMLElement;
  private readonly evadeBar: HTMLElement;
  private readonly evadeBarTrack: HTMLElement;
  private readonly evadeBarFill: HTMLElement;
  private readonly cashValue: HTMLElement;
  private readonly timerValue: HTMLElement;
  private readonly timeToggleButton: HTMLButtonElement;
  private readonly cameraButton: HTMLButtonElement;

  private readonly vehiclePrompt: HTMLElement;
  private readonly driftBadge: HTMLElement;
  private readonly dialogueBox: HTMLElement;
  private readonly dialogueSpeaker: HTMLElement;
  private readonly dialogueText: HTMLElement;

  private readonly speedNumber: HTMLElement;
  private readonly nitroTrack: HTMLElement;
  private readonly nitroFill: HTMLElement;
  private readonly radioButton: HTMLButtonElement;
  private readonly radioLabel: HTMLElement;
  private readonly voicesButton: HTMLButtonElement;
  private readonly muteButton: HTMLButtonElement;

  // Overlay dynamic nodes
  private readonly pauseRadioBtn: HTMLButtonElement;
  private readonly pauseMuteBtn: HTMLButtonElement;

  private readonly passedReward: HTMLElement;
  private readonly passedTime: HTMLElement;
  private readonly passedNewRecord: HTMLElement;
  private readonly passedNextBtn: HTMLButtonElement;

  private readonly bustedTitle: HTMLElement;
  private readonly bustedSubtitle: HTMLElement;
  private readonly bustedRetryBtn: HTMLButtonElement;
  private readonly bustedTitleBtn: HTMLButtonElement;

  private readonly victoryCash: HTMLElement;
  private readonly victoryM1Time: HTMLElement;
  private readonly victoryM2Time: HTMLElement;
  private readonly victoryLandmarks: HTMLElement;

  public constructor(root: HTMLElement, callbacks: HudCallbacks, map: CaliMapConfig = CALI_MAP) {
    this.root = root;
    this.callbacks = callbacks;
    this.map = map;

    this.shell = createEl('div', 'cali-ui');

    // 1. Title Screen (z-40)
    const titleParts = this.buildTitleScreen();
    this.titleScreen = titleParts.section;
    this.mission1Card = titleParts.mission1;
    this.mission2Card = titleParts.mission2;
    this.freeRoamCard = titleParts.freeRoam;

    // 2. Gameplay HUD (z-10 / z-20)
    const hudParts = this.buildGameplayHud();
    this.gameplayHud = hudParts.section;
    this.objectiveTitle = hudParts.objectiveTitle;
    this.stepRow = hudParts.stepRow;
    this.stepProgress = hudParts.stepProgress;
    this.stepDots = hudParts.stepDots;
    this.objectiveLabel = hudParts.objectiveLabel;
    this.objectiveDetail = hudParts.objectiveDetail;
    this.districtBadge = hudParts.districtBadge;
    this.landmarksBadge = hudParts.landmarksBadge;
    this.tickerText = hudParts.tickerText;
    this.compassPill = hudParts.compassPill;
    this.compassArrow = hudParts.compassArrow;
    this.compassCue = hudParts.compassCue;
    this.compassDest = hudParts.compassDest;
    this.compassDistance = hudParts.compassDistance;
    this.bannerBox = hudParts.bannerBox;
    this.bannerHeadline = hudParts.bannerHeadline;
    this.bannerSub = hudParts.bannerSub;
    this.wantedContainer = hudParts.wantedContainer;
    this.wantedStars = hudParts.wantedStars;
    this.bustWarning = hudParts.bustWarning;
    this.bustBarFill = hudParts.bustBarFill;
    this.evadeBar = hudParts.evadeBar;
    this.evadeBarTrack = hudParts.evadeBarTrack;
    this.evadeBarFill = hudParts.evadeBarFill;
    this.cashValue = hudParts.cashValue;
    this.timerValue = hudParts.timerValue;
    this.timeToggleButton = hudParts.timeToggleButton;
    this.cameraButton = hudParts.cameraButton;
    this.vehiclePrompt = hudParts.vehiclePrompt;
    this.driftBadge = hudParts.driftBadge;
    this.dialogueBox = hudParts.dialogueBox;
    this.dialogueSpeaker = hudParts.dialogueSpeaker;
    this.dialogueText = hudParts.dialogueText;
    this.speedNumber = hudParts.speedNumber;
    this.nitroTrack = hudParts.nitroTrack;
    this.nitroFill = hudParts.nitroFill;
    this.radioButton = hudParts.radioButton;
    this.radioLabel = hudParts.radioLabel;
    this.voicesButton = hudParts.voicesButton;
    this.muteButton = hudParts.muteButton;
    this.minimapRenderer = new MinimapRenderer(hudParts.minimapCanvas, this.map);

    // 3. Overlays (z-30 / z-40)
    const pauseParts = this.buildPauseOverlay();
    this.pauseOverlay = pauseParts.overlay;
    this.pauseRadioBtn = pauseParts.radioBtn;
    this.pauseMuteBtn = pauseParts.muteBtn;

    const passedParts = this.buildMissionPassedOverlay();
    this.missionPassedOverlay = passedParts.overlay;
    this.passedReward = passedParts.reward;
    this.passedTime = passedParts.time;
    this.passedNewRecord = passedParts.newRecord;
    this.passedNextBtn = passedParts.nextBtn;

    const bustedParts = this.buildBustedOverlay();
    this.bustedOverlay = bustedParts.overlay;
    this.bustedTitle = bustedParts.title;
    this.bustedSubtitle = bustedParts.subtitle;
    this.bustedRetryBtn = bustedParts.retryBtn;
    this.bustedTitleBtn = bustedParts.titleBtn;

    const victoryParts = this.buildVictoryOverlay();
    this.victoryOverlay = victoryParts.overlay;
    this.victoryCash = victoryParts.cash;
    this.victoryM1Time = victoryParts.m1Time;
    this.victoryM2Time = victoryParts.m2Time;
    this.victoryLandmarks = victoryParts.landmarks;

    this.webglErrorOverlay = this.buildWebglErrorOverlay();

    this.shell.append(
      this.gameplayHud,
      this.pauseOverlay,
      this.missionPassedOverlay,
      this.bustedOverlay,
      this.victoryOverlay,
      this.titleScreen,
      this.webglErrorOverlay,
    );
    this.root.appendChild(this.shell);
  }

  public render(
    world: WorldSnapshot,
    mission: MissionSnapshot,
    audio: AudioState,
    cameraMode: CameraMode,
  ): void {
    const mode = mission.mode;
    const showHud = mode !== 'title';

    setHidden(this.titleScreen, mode !== 'title');
    setHidden(this.gameplayHud, !showHud);
    setHidden(this.pauseOverlay, mode !== 'paused');
    setHidden(this.missionPassedOverlay, mode !== 'mission_passed');
    setHidden(this.bustedOverlay, mode !== 'busted');
    setHidden(this.victoryOverlay, mode !== 'victory');

    this.renderVoicesButton(audio);

    if (mode === 'title') {
      this.renderTitleCards(mission);
      return;
    }

    this.renderGameplayHud(world, mission, audio, cameraMode);

    if (mode === 'playing' || mode === 'paused') {
      this.minimapRenderer.render(world, mission);
    }

    if (mode === 'paused') {
      this.renderPauseOverlay(audio);
    } else if (mode === 'mission_passed') {
      this.renderMissionPassedOverlay(mission);
    } else if (mode === 'busted') {
      this.renderBustedOverlay(mission);
    } else if (mode === 'victory') {
      this.renderVictoryOverlay(mission);
    }
  }

  public showWebglError(): void {
    setHidden(this.webglErrorOverlay, false);
  }

  public hideWebglError(): void {
    setHidden(this.webglErrorOverlay, true);
  }

  public dispose(): void {
    for (const binding of this.listeners) {
      binding.target.removeEventListener(binding.type, binding.handler);
    }
    this.listeners.length = 0;
    this.shell.remove();
  }

  private onClick(el: HTMLElement, handler: () => void): void {
    const listener: EventListener = () => handler();
    el.addEventListener('click', listener);
    this.listeners.push({ target: el, type: 'click', handler: listener });
  }

  private renderTitleCards(mission: MissionSnapshot): void {
    this.updateMissionCard(this.mission1Card, 'mission_1_bulevar', mission);
    this.updateMissionCard(this.mission2Card, 'mission_2_cristo_rey', mission);

    const discovered = mission.discoveredLandmarks.length;
    const total = this.map.landmarks.length;
    setText(this.freeRoamCard.recordBadge, `${LOCALE_CALI.hud.landmarksLabel}: ${discovered}/${total}`);
    setHidden(this.freeRoamCard.statusBadge, discovered < total);
    setText(this.freeRoamCard.statusBadge, LOCALE_CALI.titleScreen.completedBadge);
  }

  private updateMissionCard(
    refs: MissionCardRefs,
    missionId: MissionId,
    mission: MissionSnapshot,
  ): void {
    const bestTime = mission.bestTimes[missionId];
    const completed = mission.completedMissions.includes(missionId);
    const hasRecord = bestTime !== undefined;

    setText(
      refs.recordBadge,
      hasRecord
        ? `${LOCALE_CALI.titleScreen.bestTimePrefix}: ${formatTimer(bestTime)}`
        : `${LOCALE_CALI.titleScreen.noRecord} · ${LOCALE_CALI.titleScreen.emptyTime}`,
    );
    refs.recordBadge.dataset.empty = hasRecord ? 'false' : 'true';
    setHidden(refs.statusBadge, !completed);
    setText(refs.statusBadge, LOCALE_CALI.titleScreen.completedBadge);
  }

  private renderGameplayHud(
    world: WorldSnapshot,
    mission: MissionSnapshot,
    audio: AudioState,
    cameraMode: CameraMode,
  ): void {
    const objective = mission.activeObjective;

    // Top-left: objective, step progress & ticker
    setText(this.objectiveTitle, mission.missionTitle);
    this.renderStepProgress(objective);
    setText(this.objectiveLabel, objective?.label ?? mission.missionTitle);
    setText(this.objectiveDetail, objective?.detail ?? '');
    setText(this.districtBadge, world.currentDistrict);
    setText(
      this.landmarksBadge,
      `${LOCALE_CALI.hud.landmarksLabel} ${mission.discoveredLandmarks.length}/${this.map.landmarks.length}`,
    );
    setText(this.tickerText, mission.viralTicker);

    // Top-center compass & center-screen checkpoint action banner
    this.renderCompass(world, objective);
    this.renderBanner(mission);

    // Top-right: wanted, bust/evade meters, cash, timer, time-of-day, camera
    this.renderPoliceStatus(world, mission);
    setText(this.cashValue, formatCop(mission.cashCop));
    setText(this.timerValue, formatTimer(mission.timerSeconds));
    const isCountdown = Boolean(mission.isCountdown);
    this.timerValue.dataset.countdown = isCountdown ? 'true' : 'false';
    this.timerValue.dataset.urgent = isCountdown && mission.timerSeconds <= 20 ? 'true' : 'false';

    const timeOfDay = mission.timeOfDay ?? 'golden_hour';
    this.timeToggleButton.dataset.time = timeOfDay;
    setText(this.timeToggleButton, `[T] ${LOCALE_CALI.timeOfDayLabels[timeOfDay]}`);
    setText(this.cameraButton, LOCALE_CALI.cameraLabels[cameraMode]);

    // Bottom-center: vehicle-specific [F] prompt, drift badge, dialogue
    const promptText = formatVehiclePrompt(world.player);
    setHidden(this.vehiclePrompt, promptText === null);
    if (promptText !== null) {
      setText(this.vehiclePrompt, promptText);
    }

    const showDrift = world.player.isDrifting || world.driftScore >= 50;
    setHidden(this.driftBadge, !showDrift);
    if (showDrift) {
      setText(this.driftBadge, `${LOCALE_CALI.hud.driftLabel} ${Math.floor(world.driftScore)}`);
    }

    const dialogue = mission.dialogue;
    setHidden(this.dialogueBox, dialogue === null);
    if (dialogue) {
      setText(this.dialogueSpeaker, LOCALE_CALI.speakers[dialogue.speaker]);
      setText(this.dialogueText, dialogue.text);
    }

    // Bottom-right: speedometer, nitro, radio
    setText(this.speedNumber, String(Math.max(0, Math.round(world.player.speedKmh))));
    const nitroPct = formatNitroPercent(world.player.nitro);
    const nitroWidth = `${nitroPct}%`;
    if (this.nitroFill.style.width !== nitroWidth) {
      this.nitroFill.style.width = nitroWidth;
    }
    this.nitroTrack.setAttribute('aria-valuenow', String(nitroPct));
    this.nitroFill.dataset.boosting = world.player.isBoosting ? 'true' : 'false';

    const radioDisplay = audio.muted
      ? `${audio.stationLabel} (${LOCALE_CALI.hud.audioMutedBadge})`
      : audio.stationLabel;
    setText(this.radioLabel, radioDisplay);
    this.radioButton.dataset.station = audio.station;

    this.muteButton.setAttribute('aria-pressed', String(audio.muted));
    setText(
      this.muteButton,
      audio.muted ? LOCALE_CALI.overlays.pause.toggleUnmute : LOCALE_CALI.overlays.pause.toggleMute,
    );
  }

  private renderVoicesButton(audio: AudioState): void {
    const voicesEnabled = audio.voicesEnabled !== false;
    setText(
      this.voicesButton,
      voicesEnabled ? LOCALE_CALI.hud.voicesOnLabel : LOCALE_CALI.hud.voicesOffLabel,
    );
    this.voicesButton.setAttribute('aria-pressed', String(voicesEnabled));
    this.voicesButton.dataset.enabled = voicesEnabled ? 'true' : 'false';
    const nextVoicesClass = voicesEnabled ? VOICES_BTN_BASE_CLASS : VOICES_BTN_OFF_CLASS;
    if (this.voicesButton.className !== nextVoicesClass) {
      this.voicesButton.className = nextVoicesClass;
    }
  }

  private renderStepProgress(objective: MissionSnapshot['activeObjective']): void {
    const hasSteps = objective !== null && objective.totalSteps > 0;
    setHidden(this.stepRow, !hasSteps);
    if (!hasSteps) {
      return;
    }

    const currentStep = Math.max(1, Math.min(objective.totalSteps, objective.stepIndex + 1));
    setText(this.stepProgress, LOCALE_CALI.hud.stepProgress(currentStep, objective.totalSteps));
    this.stepDots.forEach((dot, idx) => {
      const outOfRange = idx >= objective.totalSteps;
      setHidden(dot, outOfRange);
      if (!outOfRange) {
        dot.dataset.state =
          objective.stepIndex >= objective.totalSteps || idx < objective.stepIndex
            ? 'done'
            : idx === objective.stepIndex
              ? 'current'
              : 'pending';
      }
    });
  }

  private renderCompass(
    world: WorldSnapshot,
    objective: MissionSnapshot['activeObjective'],
  ): void {
    const target = objective?.target ?? null;
    setHidden(this.compassPill, target === null);
    if (!objective || !target) {
      return;
    }

    const bearing =
      typeof objective.bearingDeltaRad === 'number' && Number.isFinite(objective.bearingDeltaRad)
        ? objective.bearingDeltaRad
        : 0;
    const cssRad = Object.is(-bearing, -0) ? 0 : -bearing;
    const transform = `rotate(${cssRad.toFixed(3)}rad)`;
    if (this.compassArrow.style.transform !== transform) {
      this.compassArrow.style.transform = transform;
    }

    setText(this.compassCue, formatTurnCue(bearing));
    const destination = objective.landmarkId
      ? LOCALE_CALI.landmarks[objective.landmarkId]
      : objective.label;
    setText(this.compassDest, destination);

    const rawMeters =
      typeof objective.distanceMeters === 'number' && Number.isFinite(objective.distanceMeters)
        ? objective.distanceMeters
        : Math.hypot(target.x - world.player.x, target.z - world.player.z);
    setText(
      this.compassDistance,
      `${Math.max(0, Math.round(rawMeters))} ${LOCALE_CALI.hud.metersUnit}`,
    );
  }

  private renderBanner(mission: MissionSnapshot): void {
    const activeBanner = mission.mode === 'playing' ? (mission.banner ?? null) : null;
    setHidden(this.bannerBox, activeBanner === null);
    if (!activeBanner) {
      return;
    }
    this.bannerBox.dataset.accent = activeBanner.accent;
    setText(this.bannerHeadline, activeBanner.title);
    setText(this.bannerSub, activeBanner.subtitle);
  }

  private renderPoliceStatus(world: WorldSnapshot, mission: MissionSnapshot): void {
    const stars = world.wantedStars;
    this.wantedContainer.dataset.wanted = String(stars);
    const sirenRedPhase = Math.floor(world.timeSeconds * 5) % 2 === 0;
    this.wantedStars.forEach((starEl, index) => {
      const active = index < stars;
      setText(starEl, active ? '★' : '☆');
      starEl.dataset.active = active ? 'true' : 'false';
      starEl.dataset.phase = active
        ? (index + (sirenRedPhase ? 0 : 1)) % 2 === 0
          ? 'red'
          : 'blue'
        : 'idle';
    });

    const showBust = world.bustProgress > 0.05 && mission.activeMission !== 'free_roam';
    setHidden(this.bustWarning, !showBust);
    if (showBust) {
      const pct = `${Math.round(Math.min(1, world.bustProgress) * 100)}%`;
      if (this.bustBarFill.style.width !== pct) {
        this.bustBarFill.style.width = pct;
      }
    }

    const evadeProgress = world.policeEvadeProgress ?? 0;
    const showEvade =
      world.wantedStars > 0 && evadeProgress > 0.05 && world.bustProgress <= 0.05;
    setHidden(this.evadeBar, !showEvade);
    if (showEvade) {
      const evadePct = Math.round(Math.max(0, Math.min(1, evadeProgress)) * 100);
      const evadeWidth = `${evadePct}%`;
      if (this.evadeBarFill.style.width !== evadeWidth) {
        this.evadeBarFill.style.width = evadeWidth;
      }
      this.evadeBarTrack.setAttribute('aria-valuenow', String(evadePct));
    }
  }

  private renderPauseOverlay(audio: AudioState): void {
    setText(this.pauseRadioBtn, `${LOCALE_CALI.overlays.pause.cycleRadio}: ${audio.stationLabel}`);
    setText(
      this.pauseMuteBtn,
      audio.muted ? LOCALE_CALI.overlays.pause.toggleUnmute : LOCALE_CALI.overlays.pause.toggleMute,
    );
  }

  private renderMissionPassedOverlay(mission: MissionSnapshot): void {
    setText(this.passedReward, formatCop(mission.rewardCop));
    setText(this.passedTime, formatTimer(mission.lastCompletedTimeSeconds));
    setHidden(this.passedNewRecord, !mission.isNewRecord);
    setHidden(this.passedNextBtn, mission.activeMission !== 'mission_1_bulevar');
  }

  private renderBustedOverlay(mission: MissionSnapshot): void {
    const isTimeUp = mission.failureReason === 'time_up';
    const copy = isTimeUp ? LOCALE_CALI.overlays.timeUp : LOCALE_CALI.overlays.busted;
    this.bustedOverlay.dataset.reason = isTimeUp ? 'time_up' : 'busted';
    setText(this.bustedTitle, copy.title);
    setText(this.bustedSubtitle, copy.subtitle);
    setText(this.bustedRetryBtn, copy.retry);
    setText(this.bustedTitleBtn, copy.backToTitle);
  }

  private renderVictoryOverlay(mission: MissionSnapshot): void {
    setText(this.victoryCash, formatCop(mission.cashCop));
    setText(
      this.victoryM1Time,
      `${LOCALE_CALI.missions.mission_1_bulevar.title}: ${formatTimer(mission.bestTimes.mission_1_bulevar)}`,
    );
    setText(
      this.victoryM2Time,
      `${LOCALE_CALI.missions.mission_2_cristo_rey.title}: ${formatTimer(mission.bestTimes.mission_2_cristo_rey)}`,
    );
    setText(
      this.victoryLandmarks,
      `${mission.discoveredLandmarks.length}/${this.map.landmarks.length}`,
    );
  }

  private buildTitleScreen(): {
    section: HTMLElement;
    mission1: MissionCardRefs;
    mission2: MissionCardRefs;
    freeRoam: MissionCardRefs;
  } {
    const section = createEl('section', 'cali-screen cali-title-screen', 'title-screen');
    section.setAttribute('aria-label', LOCALE_CALI.brand.title);

    const hero = createEl('header', 'cali-title-hero');
    const title = createEl('h1', 'cali-display-title');
    title.textContent = LOCALE_CALI.brand.title;
    const subtitle = createEl('p', 'cali-display-subtitle');
    subtitle.textContent = LOCALE_CALI.brand.subtitle;
    const tagline = createEl('p', 'cali-display-tagline');
    tagline.textContent = LOCALE_CALI.brand.tagline;
    hero.append(title, subtitle, tagline);

    const missionGrid = createEl('div', 'cali-mission-grid');
    const mission1 = this.createMissionCard('mission_1_bulevar', 'btn-mission-1', true);
    const mission2 = this.createMissionCard('mission_2_cristo_rey', 'btn-mission-2', false);
    const freeRoam = this.createMissionCard('free_roam', 'btn-free-roam', false);
    missionGrid.append(mission1.button, mission2.button, freeRoam.button);

    const controlsPanel = createEl('aside', 'cali-panel cali-controls-card');
    const controlsHeading = createEl('h2', 'cali-controls-title');
    controlsHeading.textContent = LOCALE_CALI.titleScreen.controlsTitle;
    const controlsList = createEl('ul', 'cali-controls-list');

    for (const item of LOCALE_CALI.controls) {
      const li = createEl('li', 'cali-control-row');
      const kbd = createEl('kbd', 'cali-keycap');
      kbd.textContent = item.keys;
      const desc = createEl('span', 'cali-control-action');
      desc.textContent = item.action;
      li.append(kbd, desc);
      controlsList.appendChild(li);
    }
    controlsPanel.append(controlsHeading, controlsList);

    section.append(hero, missionGrid, controlsPanel);
    return { section, mission1, mission2, freeRoam };
  }

  private createMissionCard(
    missionId: MissionId,
    testId: string,
    isPrimary: boolean,
  ): MissionCardRefs {
    const copy = LOCALE_CALI.missions[missionId];
    const button = createEl(
      'button',
      `cali-mission-card ${isPrimary ? 'cali-btn--primary' : 'cali-btn--secondary'}`,
      testId,
    );
    button.type = 'button';

    const header = createEl('div', 'cali-mission-card-header');
    const badge = createEl('span', 'cali-badge');
    badge.textContent = copy.badge;
    const statusBadge = createEl('span', 'cali-badge cali-badge--success');
    statusBadge.hidden = true;
    header.append(badge, statusBadge);

    const heading = createEl('span', 'cali-mission-card-title');
    heading.textContent = copy.title;

    const sub = createEl('span', 'cali-mission-card-subtitle');
    sub.textContent = copy.subtitle;

    const desc = createEl('span', 'cali-mission-card-desc');
    desc.textContent = copy.description;

    const footer = createEl('div', 'cali-mission-card-footer');
    const recordBadge = createEl('span', 'cali-record-badge');
    recordBadge.textContent = `${LOCALE_CALI.titleScreen.noRecord} · ${LOCALE_CALI.titleScreen.emptyTime}`;
    const cta = createEl('span', 'cali-mission-cta');
    cta.textContent = LOCALE_CALI.titleScreen.playCta;
    footer.append(recordBadge, cta);

    button.append(header, heading, sub, desc, footer);
    this.onClick(button, () => this.callbacks.onStartMission(missionId));

    return { button, recordBadge, statusBadge };
  }

  private buildGameplayHud(): {
    section: HTMLElement;
    objectiveTitle: HTMLElement;
    stepRow: HTMLElement;
    stepProgress: HTMLElement;
    stepDots: HTMLSpanElement[];
    objectiveLabel: HTMLElement;
    objectiveDetail: HTMLElement;
    districtBadge: HTMLElement;
    landmarksBadge: HTMLElement;
    tickerText: HTMLElement;
    compassPill: HTMLElement;
    compassArrow: HTMLElement;
    compassCue: HTMLElement;
    compassDest: HTMLElement;
    compassDistance: HTMLElement;
    bannerBox: HTMLElement;
    bannerHeadline: HTMLElement;
    bannerSub: HTMLElement;
    wantedContainer: HTMLElement;
    wantedStars: HTMLSpanElement[];
    bustWarning: HTMLElement;
    bustBarFill: HTMLElement;
    evadeBar: HTMLElement;
    evadeBarTrack: HTMLElement;
    evadeBarFill: HTMLElement;
    cashValue: HTMLElement;
    timerValue: HTMLElement;
    timeToggleButton: HTMLButtonElement;
    cameraButton: HTMLButtonElement;
    minimapCanvas: HTMLCanvasElement;
    vehiclePrompt: HTMLElement;
    driftBadge: HTMLElement;
    dialogueBox: HTMLElement;
    dialogueSpeaker: HTMLElement;
    dialogueText: HTMLElement;
    speedNumber: HTMLElement;
    nitroTrack: HTMLElement;
    nitroFill: HTMLElement;
    radioButton: HTMLButtonElement;
    radioLabel: HTMLElement;
    voicesButton: HTMLButtonElement;
    muteButton: HTMLButtonElement;
  } {
    const section = createEl('div', 'cali-hud', 'gameplay-hud');
    section.hidden = true;

    // Zone 1: Top-Left (Objective + Step Progress + CaliViral Ticker)
    const topLeft = createEl('div', 'cali-hud-zone cali-hud-top-left');
    const objectivePanel = createEl('div', 'cali-panel cali-objective-panel', 'hud-objective');
    const objectiveHeader = createEl('div', 'cali-objective-header');
    const objectiveTag = createEl('span', 'cali-tag');
    objectiveTag.textContent = LOCALE_CALI.hud.objectiveTag;
    const objectiveTitle = createEl('span', 'cali-objective-mission');
    objectiveHeader.append(objectiveTag, objectiveTitle);

    const stepRow = createEl('div', 'cali-step-row');
    const stepProgress = createEl('span', 'cali-step-badge cali-mono', 'hud-step-progress');
    const stepDotsWrap = createEl('span', 'cali-step-dots');
    stepDotsWrap.setAttribute('aria-hidden', 'true');
    const stepDots: HTMLSpanElement[] = [];
    for (let i = 0; i < MAX_STEP_DOTS; i += 1) {
      const dot = createEl('span', 'cali-step-dot');
      dot.dataset.state = 'pending';
      stepDots.push(dot);
      stepDotsWrap.appendChild(dot);
    }
    stepRow.append(stepProgress, stepDotsWrap);

    const objectiveLabel = createEl('p', 'cali-objective-label');
    const objectiveDetail = createEl('p', 'cali-objective-detail');
    const metaRow = createEl('div', 'cali-objective-meta');
    const districtBadge = createEl('span', 'cali-meta-pill', 'hud-district');
    const landmarksBadge = createEl('span', 'cali-meta-pill', 'hud-landmarks');
    metaRow.append(districtBadge, landmarksBadge);
    objectivePanel.append(objectiveHeader, stepRow, objectiveLabel, objectiveDetail, metaRow);

    const tickerPill = createEl('div', 'cali-ticker-pill', 'hud-ticker');
    const tickerTag = createEl('span', 'cali-ticker-tag');
    tickerTag.textContent = LOCALE_CALI.hud.tickerTag;
    const tickerText = createEl('span', 'cali-ticker-text');
    tickerPill.append(tickerTag, tickerText);
    topLeft.append(objectivePanel, tickerPill);

    // Top-Center: GTA Navigation Compass Pill
    const topCenter = createEl('div', 'cali-hud-zone cali-hud-top-center');
    const compassPill = createEl('div', 'cali-panel cali-compass', 'hud-compass');
    compassPill.hidden = true;
    const compassArrowWrap = createEl('span', 'cali-compass-arrow-wrap');
    compassArrowWrap.setAttribute('aria-hidden', 'true');
    const compassArrow = createEl('span', 'cali-compass-arrow', 'hud-compass-arrow');
    compassArrow.textContent = '';
    compassArrowWrap.appendChild(compassArrow);

    const compassCopy = createEl('div', 'cali-compass-copy');
    const compassCue = createEl('span', 'cali-compass-cue', 'hud-compass-cue');
    const compassDest = createEl('span', 'cali-compass-dest', 'hud-compass-dest');
    compassCopy.append(compassCue, compassDest);

    const compassDistance = createEl('span', 'cali-mono cali-compass-distance', 'hud-distance');
    compassPill.append(compassArrowWrap, compassCopy, compassDistance);
    topCenter.appendChild(compassPill);

    // Center-Screen GTA Action Checkpoint Banner (passive, pointer-events: none)
    const bannerBox = createEl('div', 'cali-banner', 'hud-banner');
    bannerBox.setAttribute('role', 'status');
    bannerBox.setAttribute('aria-live', 'polite');
    bannerBox.dataset.accent = 'gold';
    bannerBox.hidden = true;
    const bannerHeadline = createEl('p', 'cali-banner-headline');
    const bannerSub = createEl('p', 'cali-banner-sub');
    bannerBox.append(bannerHeadline, bannerSub);

    // Zone 2: Top-Right (Wanted + Bust/Evade Meter + Cash + Timer + Interactive Controls)
    const topRight = createEl('div', 'cali-hud-zone cali-hud-top-right');
    const statusPanel = createEl('div', 'cali-panel cali-status-panel');

    const wantedContainer = createEl('div', 'cali-wanted-row', 'hud-wanted');
    wantedContainer.setAttribute('role', 'status');
    wantedContainer.setAttribute('aria-label', LOCALE_CALI.hud.wantedLabel);
    const wantedLabel = createEl('span', 'cali-wanted-label');
    wantedLabel.textContent = LOCALE_CALI.hud.wantedLabel;
    const starsWrap = createEl('span', 'cali-wanted-stars');
    const wantedStars: HTMLSpanElement[] = [];
    for (let i = 0; i < 3; i++) {
      const star = createEl('span', 'cali-star');
      star.textContent = '☆';
      star.dataset.active = 'false';
      wantedStars.push(star);
      starsWrap.appendChild(star);
    }
    wantedContainer.append(wantedLabel, starsWrap);

    const bustWarning = createEl('div', 'cali-bust-warning', 'hud-bust-warning');
    bustWarning.hidden = true;
    const bustText = createEl('span', 'cali-bust-text');
    bustText.textContent = LOCALE_CALI.hud.bustWarning;
    const bustBarTrack = createEl('div', 'cali-bust-track');
    const bustBarFill = createEl('div', 'cali-bust-fill');
    bustBarTrack.appendChild(bustBarFill);
    bustWarning.append(bustText, bustBarTrack);

    const evadeBar = createEl('div', 'cali-evade-bar', 'hud-evade-bar');
    evadeBar.hidden = true;
    const evadeText = createEl('span', 'cali-evade-text');
    evadeText.textContent = LOCALE_CALI.hud.evadingPoliceLabel;
    const evadeBarTrack = createEl('div', 'cali-evade-track');
    evadeBarTrack.setAttribute('role', 'progressbar');
    evadeBarTrack.setAttribute('aria-label', LOCALE_CALI.hud.evadingPoliceLabel);
    evadeBarTrack.setAttribute('aria-valuemin', '0');
    evadeBarTrack.setAttribute('aria-valuemax', '100');
    evadeBarTrack.setAttribute('aria-valuenow', '0');
    const evadeBarFill = createEl('div', 'cali-evade-fill');
    evadeBarTrack.appendChild(evadeBarFill);
    evadeBar.append(evadeText, evadeBarTrack);

    const telemetryRow = createEl('div', 'cali-telemetry-row');
    const cashValue = createEl('span', 'cali-mono cali-cash', 'hud-cash');
    const timerValue = createEl('span', 'cali-mono cali-timer', 'hud-timer');
    telemetryRow.append(cashValue, timerValue);

    statusPanel.append(wantedContainer, bustWarning, evadeBar, telemetryRow);

    const quickActions = createEl('div', 'cali-quick-actions');
    const timeToggleButton = createEl(
      'button',
      'cali-btn cali-btn--ghost cali-btn--compact',
      'btn-time-toggle',
    );
    timeToggleButton.type = 'button';
    timeToggleButton.dataset.time = 'golden_hour';
    timeToggleButton.textContent = `[T] ${LOCALE_CALI.timeOfDayLabels.golden_hour}`;
    timeToggleButton.setAttribute('aria-label', LOCALE_CALI.hud.timeToggleHint);
    this.onClick(timeToggleButton, () => this.callbacks.onToggleTimeOfDay?.());

    const cameraButton = createEl('button', 'cali-btn cali-btn--ghost cali-btn--compact', 'btn-camera');
    cameraButton.type = 'button';
    cameraButton.textContent = LOCALE_CALI.cameraLabels.chase;
    this.onClick(cameraButton, () => this.callbacks.onCycleCamera());

    const pauseButton = createEl('button', 'cali-btn cali-btn--ghost cali-btn--compact', 'btn-pause');
    pauseButton.type = 'button';
    pauseButton.textContent = LOCALE_CALI.hud.pauseHint;
    this.onClick(pauseButton, () => this.callbacks.onTogglePause());
    quickActions.append(timeToggleButton, cameraButton, pauseButton);

    topRight.append(statusPanel, quickActions);

    // Zone 3: Bottom-Left (2D GPS Minimap)
    const bottomLeft = createEl('div', 'cali-hud-zone cali-hud-bottom-left');
    const minimapFrame = createEl('div', 'cali-panel cali-minimap-frame');
    const minimapCanvas = createEl('canvas', 'cali-minimap-canvas', 'minimap-canvas');
    minimapCanvas.width = 180;
    minimapCanvas.height = 132;
    minimapCanvas.setAttribute('aria-label', LOCALE_CALI.brand.cityName);
    minimapFrame.appendChild(minimapCanvas);
    bottomLeft.appendChild(minimapFrame);

    // Zone 4: Bottom-Center (Context Prompt + Drift + Dialogue Toast)
    const bottomCenter = createEl('div', 'cali-hud-zone cali-hud-bottom-center');
    const vehiclePrompt = createEl('div', 'cali-prompt-pill', 'hud-vehicle-prompt');
    vehiclePrompt.hidden = true;
    const driftBadge = createEl('div', 'cali-badge cali-drift-badge', 'hud-drift');
    driftBadge.hidden = true;

    const dialogueBox = createEl('div', 'cali-panel cali-dialogue-toast', 'hud-dialogue');
    dialogueBox.setAttribute('aria-live', 'polite');
    dialogueBox.hidden = true;
    const dialogueSpeaker = createEl('span', 'cali-dialogue-speaker');
    const dialogueText = createEl('p', 'cali-dialogue-text');
    dialogueBox.append(dialogueSpeaker, dialogueText);
    bottomCenter.append(driftBadge, vehiclePrompt, dialogueBox);

    // Zone 5: Bottom-Right (Speedometer + Nitro + Radio FM + Hints)
    const bottomRight = createEl('div', 'cali-hud-zone cali-hud-bottom-right');
    const drivePanel = createEl('div', 'cali-panel cali-drive-panel');

    const speedWrap = createEl('div', 'cali-speed-readout', 'hud-speed');
    const speedNumber = createEl('span', 'cali-mono cali-speed-number');
    speedNumber.textContent = '0';
    const speedUnit = createEl('span', 'cali-speed-unit');
    speedUnit.textContent = LOCALE_CALI.hud.speedUnit;
    speedWrap.append(speedNumber, speedUnit);

    const nitroWrap = createEl('div', 'cali-nitro-wrap', 'hud-nitro');
    const nitroLabel = createEl('span', 'cali-nitro-label');
    nitroLabel.textContent = LOCALE_CALI.hud.nitroLabel;
    const nitroTrack = createEl('div', 'cali-nitro-track');
    nitroTrack.setAttribute('role', 'progressbar');
    nitroTrack.setAttribute('aria-label', LOCALE_CALI.hud.nitroLabel);
    nitroTrack.setAttribute('aria-valuemin', '0');
    nitroTrack.setAttribute('aria-valuemax', '100');
    nitroTrack.setAttribute('aria-valuenow', '100');
    const nitroFill = createEl('div', 'cali-nitro-fill');
    nitroFill.style.width = '100%';
    nitroTrack.appendChild(nitroFill);
    nitroWrap.append(nitroLabel, nitroTrack);

    drivePanel.append(speedWrap, nitroWrap);

    const audioRow = createEl('div', 'cali-audio-row');
    const radioButton = createEl('button', 'cali-radio-pill', 'hud-radio');
    radioButton.type = 'button';
    const radioLabel = createEl('span', 'cali-radio-label');
    radioLabel.textContent = LOCALE_CALI.radio.salsa_brava;
    radioButton.appendChild(radioLabel);
    this.onClick(radioButton, () => this.callbacks.onCycleRadio());

    const voicesButton = createEl('button', VOICES_BTN_BASE_CLASS, 'btn-voices');
    voicesButton.type = 'button';
    voicesButton.textContent = LOCALE_CALI.hud.voicesOnLabel;
    voicesButton.setAttribute('aria-pressed', 'true');
    voicesButton.dataset.enabled = 'true';
    this.onClick(voicesButton, () => this.callbacks.onToggleVoices?.());

    const muteButton = createEl('button', 'cali-btn cali-btn--ghost cali-btn--compact', 'btn-mute');
    muteButton.type = 'button';
    muteButton.textContent = LOCALE_CALI.overlays.pause.toggleMute;
    this.onClick(muteButton, () => this.callbacks.onToggleMute());
    audioRow.append(radioButton, voicesButton, muteButton);

    const hints = createEl('div', 'cali-hud-hints', 'hud-hints');
    const hintTexts = [LOCALE_CALI.hud.radioHint, LOCALE_CALI.hud.cameraHint, LOCALE_CALI.hud.pauseHint];
    for (const text of hintTexts) {
      const span = createEl('span', 'cali-keycap');
      span.textContent = text;
      hints.appendChild(span);
    }

    bottomRight.append(drivePanel, audioRow, hints);
    section.append(topLeft, topCenter, topRight, bannerBox, bottomLeft, bottomCenter, bottomRight);

    return {
      section,
      objectiveTitle,
      stepRow,
      stepProgress,
      stepDots,
      objectiveLabel,
      objectiveDetail,
      districtBadge,
      landmarksBadge,
      tickerText,
      compassPill,
      compassArrow,
      compassCue,
      compassDest,
      compassDistance,
      bannerBox,
      bannerHeadline,
      bannerSub,
      wantedContainer,
      wantedStars,
      bustWarning,
      bustBarFill,
      evadeBar,
      evadeBarTrack,
      evadeBarFill,
      cashValue,
      timerValue,
      timeToggleButton,
      cameraButton,
      minimapCanvas,
      vehiclePrompt,
      driftBadge,
      dialogueBox,
      dialogueSpeaker,
      dialogueText,
      speedNumber,
      nitroTrack,
      nitroFill,
      radioButton,
      radioLabel,
      voicesButton,
      muteButton,
    };
  }

  private buildPauseOverlay(): {
    overlay: HTMLElement;
    radioBtn: HTMLButtonElement;
    muteBtn: HTMLButtonElement;
  } {
    const copy = LOCALE_CALI.overlays.pause;
    const overlay = createEl('div', 'cali-overlay cali-overlay--modal', 'pause-overlay');
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.hidden = true;

    const modal = createEl('div', 'cali-panel cali-modal');
    const title = createEl('h2', 'cali-modal-title');
    title.textContent = copy.title;
    const subtitle = createEl('p', 'cali-modal-subtitle');
    subtitle.textContent = copy.subtitle;

    const actions = createEl('div', 'cali-modal-actions');
    const resumeBtn = this.makeButton(copy.resume, 'cali-btn cali-btn--primary', 'btn-resume', () =>
      this.callbacks.onResume(),
    );
    const restartBtn = this.makeButton(copy.restart, 'cali-btn cali-btn--secondary', 'btn-restart', () =>
      this.callbacks.onRestart(),
    );
    const radioBtn = this.makeButton(
      copy.cycleRadio,
      'cali-btn cali-btn--ghost',
      'btn-pause-radio',
      () => this.callbacks.onCycleRadio(),
    );
    const muteBtn = this.makeButton(
      copy.toggleMute,
      'cali-btn cali-btn--ghost',
      'btn-pause-mute',
      () => this.callbacks.onToggleMute(),
    );
    const titleBtn = this.makeButton(
      copy.backToTitle,
      'cali-btn cali-btn--ghost',
      'btn-pause-title',
      () => this.callbacks.onReturnTitle(),
    );

    actions.append(resumeBtn, restartBtn, radioBtn, muteBtn, titleBtn);
    modal.append(title, subtitle, actions);
    overlay.appendChild(modal);

    return { overlay, radioBtn, muteBtn };
  }

  private buildMissionPassedOverlay(): {
    overlay: HTMLElement;
    reward: HTMLElement;
    time: HTMLElement;
    newRecord: HTMLElement;
    nextBtn: HTMLButtonElement;
  } {
    const copy = LOCALE_CALI.overlays.missionPassed;
    const overlay = createEl('div', 'cali-overlay cali-overlay--banner', 'mission-passed-overlay');
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.hidden = true;

    const modal = createEl('div', 'cali-panel cali-modal cali-modal--success');
    const title = createEl('h2', 'cali-banner-title cali-banner-title--success');
    title.textContent = copy.title;
    const subtitle = createEl('p', 'cali-modal-subtitle');
    subtitle.textContent = copy.subtitle;

    const newRecord = createEl('span', 'cali-badge cali-badge--warning', 'badge-new-record');
    newRecord.textContent = copy.newRecordBadge;
    newRecord.hidden = true;

    const stats = createEl('dl', 'cali-stats-grid');
    const rewardLabel = createEl('dt');
    rewardLabel.textContent = copy.rewardLabel;
    const reward = createEl('dd', 'cali-mono', 'passed-reward');
    const timeLabel = createEl('dt');
    timeLabel.textContent = copy.timeLabel;
    const time = createEl('dd', 'cali-mono', 'passed-time');
    stats.append(rewardLabel, reward, timeLabel, time);

    const actions = createEl('div', 'cali-modal-actions');
    const nextBtn = this.makeButton(
      copy.nextMission,
      'cali-btn cali-btn--primary',
      'btn-next-mission',
      () => this.callbacks.onStartMission('mission_2_cristo_rey'),
    );
    const freeRoamBtn = this.makeButton(
      copy.freeRoam,
      'cali-btn cali-btn--secondary',
      'btn-passed-free-roam',
      () => this.callbacks.onStartMission('free_roam'),
    );
    const titleBtn = this.makeButton(
      copy.backToTitle,
      'cali-btn cali-btn--ghost',
      'btn-passed-title',
      () => this.callbacks.onReturnTitle(),
    );

    actions.append(nextBtn, freeRoamBtn, titleBtn);
    modal.append(title, subtitle, newRecord, stats, actions);
    overlay.appendChild(modal);

    return { overlay, reward, time, newRecord, nextBtn };
  }

  private buildBustedOverlay(): {
    overlay: HTMLElement;
    title: HTMLElement;
    subtitle: HTMLElement;
    retryBtn: HTMLButtonElement;
    titleBtn: HTMLButtonElement;
  } {
    const copy = LOCALE_CALI.overlays.busted;
    const overlay = createEl('div', 'cali-overlay cali-overlay--modal', 'busted-overlay');
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.hidden = true;

    const modal = createEl('div', 'cali-panel cali-modal cali-modal--busted');
    const title = createEl('h2', 'cali-banner-title cali-banner-title--busted');
    title.textContent = copy.title;
    const subtitle = createEl('p', 'cali-modal-subtitle');
    subtitle.textContent = copy.subtitle;

    const actions = createEl('div', 'cali-modal-actions');
    const retryBtn = this.makeButton(
      copy.retry,
      'cali-btn cali-btn--primary',
      'btn-busted-retry',
      () => this.callbacks.onRestart(),
    );
    const titleBtn = this.makeButton(
      copy.backToTitle,
      'cali-btn cali-btn--ghost',
      'btn-busted-title',
      () => this.callbacks.onReturnTitle(),
    );

    actions.append(retryBtn, titleBtn);
    modal.append(title, subtitle, actions);
    overlay.appendChild(modal);
    return { overlay, title, subtitle, retryBtn, titleBtn };
  }

  private buildVictoryOverlay(): {
    overlay: HTMLElement;
    cash: HTMLElement;
    m1Time: HTMLElement;
    m2Time: HTMLElement;
    landmarks: HTMLElement;
  } {
    const copy = LOCALE_CALI.overlays.victory;
    const overlay = createEl('section', 'cali-screen cali-victory-screen', 'victory-overlay');
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.hidden = true;

    const modal = createEl('div', 'cali-panel cali-modal cali-modal--victory');
    const title = createEl('h2', 'cali-display-title');
    title.textContent = copy.title;
    const subtitle = createEl('p', 'cali-modal-subtitle');
    subtitle.textContent = copy.subtitle;

    const stats = createEl('dl', 'cali-stats-grid');
    const cashLabel = createEl('dt');
    cashLabel.textContent = copy.totalCashLabel;
    const cash = createEl('dd', 'cali-mono', 'victory-cash');

    const timesLabel = createEl('dt');
    timesLabel.textContent = copy.bestTimesLabel;
    const timesWrap = createEl('dd', 'cali-mono cali-victory-times');
    const m1Time = createEl('span', 'cali-victory-time-row');
    const m2Time = createEl('span', 'cali-victory-time-row');
    timesWrap.append(m1Time, m2Time);

    const landmarksLabel = createEl('dt');
    landmarksLabel.textContent = copy.landmarksLabel;
    const landmarks = createEl('dd', 'cali-mono', 'victory-landmarks');
    stats.append(cashLabel, cash, timesLabel, timesWrap, landmarksLabel, landmarks);

    const actions = createEl('div', 'cali-modal-actions');
    const freeRoamBtn = this.makeButton(
      copy.freeRoamCta,
      'cali-btn cali-btn--primary',
      'btn-victory-free-roam',
      () => this.callbacks.onStartMission('free_roam'),
    );
    const replayBtn = this.makeButton(
      copy.replayCta,
      'cali-btn cali-btn--secondary',
      'btn-victory-replay',
      () => this.callbacks.onStartMission('mission_1_bulevar'),
    );
    const titleBtn = this.makeButton(
      copy.backToTitle,
      'cali-btn cali-btn--ghost',
      'btn-victory-title',
      () => this.callbacks.onReturnTitle(),
    );

    actions.append(freeRoamBtn, replayBtn, titleBtn);
    modal.append(title, subtitle, stats, actions);
    overlay.appendChild(modal);

    return { overlay, cash, m1Time, m2Time, landmarks };
  }

  private buildWebglErrorOverlay(): HTMLElement {
    const copy = LOCALE_CALI.overlays.webglError;
    const overlay = createEl('div', 'cali-overlay cali-overlay--error', 'webgl-error-overlay');
    overlay.setAttribute('role', 'alertdialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.hidden = true;

    const card = createEl('div', 'cali-panel cali-modal cali-modal--error');
    const title = createEl('h2', 'cali-modal-title');
    title.textContent = copy.title;
    const message = createEl('p', 'cali-modal-subtitle');
    message.textContent = copy.message;
    const retryBtn = this.makeButton(
      copy.retry,
      'cali-btn cali-btn--primary',
      'btn-retry-webgl',
      () => this.callbacks.onRetryWebgl(),
    );

    card.append(title, message, retryBtn);
    overlay.appendChild(card);
    return overlay;
  }

  private makeButton(
    label: string,
    className: string,
    testId: string,
    onClick: () => void,
  ): HTMLButtonElement {
    const button = createEl('button', className, testId);
    button.type = 'button';
    button.textContent = label;
    this.onClick(button, onClick);
    return button;
  }
}
