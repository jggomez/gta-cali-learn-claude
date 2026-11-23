/**
 * Runtime composition root for GTA I - Cali - Colombia (La Sucursal del Cielo).
 * Coordinates GameWorld, MissionDirector, AudioEngine, WorldRenderer, HudController,
 * InputManager, fixed-clamp requestAnimationFrame loop, and readonly window.__GTA_CALI__.
 */

import { installUtmLinkTagging, type LinkTrackingHandle } from '../ui/linkTracking';
import { switchLanguage } from '../config/language';
import { AudioEngine } from '../audio/audioEngine';
import { VoiceEngine, type VoiceProfile } from '../audio/voiceEngine';
import { CALI_MAP } from '../config/caliMap';
import { LOCALE_CALI } from '../config/localeCali';
import { MissionDirector, StorageAdapter, type StorageLike } from '../missions/missionDirector';
import { GameWorld } from '../simulation/gameWorld';
import type {
  CaliMapConfig,
  CameraMode,
  DialogueSpeaker,
  GameDebugSnapshot,
  GarageConfig,
  InputState,
  MissionId,
  MissionSnapshot,
  WantedLevel,
  WorldSnapshot,
} from '../types/game';
import { FirestoreLeaderboard } from '../services/firestoreLeaderboard';
import type { LeaderboardPort } from '../services/leaderboardPort';
import { HudController } from '../ui/hudController';
import { WebGLUnavailableError } from '../world/sceneSetup';
import { WorldRenderer } from '../world/worldRenderer';
import { CLAUDE_CARD_PICKUP_RADIUS, CLAUDE_CARD_SPOTS } from '../config/claudeCardSpots';
import { ChallengeSession } from './challengeSession';
import { LearningSession } from './learningSession';
import { InputManager } from './inputManager';
import {
  QUALITY_PRESETS,
  createResolutionScalerState,
  cycleQualityLevel,
  detectInitialQuality,
  resolveRenderPixelRatio,
  stepResolutionScaler,
  type DeviceProfile,
  type QualityLevel,
  type ResolutionScalerState,
} from './qualityGovernor';

declare global {
  interface Window {
    readonly __GTA_CALI__?: GameDebugSnapshot;
  }
}

export interface GameAppOptions {
  readonly voiceEngine?: VoiceEngine;
  /** Reto AcaDevHack leaderboard; defaults to the Firestore `gta-cali` adapter. */
  readonly leaderboard?: LeaderboardPort;
}

const MAX_FRAME_DT_SECONDS = 0.05;
const DEFAULT_FRAME_DT_SECONDS = 1 / 60;
const PLAYABLE_CAMERA_MODES: readonly CameraMode[] = ['chase', 'cinematic', 'hood'];
const COLLISION_FOLEY_THRESHOLD = 0.14;
const POLICE_MEGAPHONE_RANGE_METERS = 48;
const POLICE_MEGAPHONE_RANGE_SQ = POLICE_MEGAPHONE_RANGE_METERS * POLICE_MEGAPHONE_RANGE_METERS;
const PEDESTRIAN_FLEE_RANGE_METERS = 14;
const PEDESTRIAN_FLEE_RANGE_SQ = PEDESTRIAN_FLEE_RANGE_METERS * PEDESTRIAN_FLEE_RANGE_METERS;
const PEDESTRIAN_ADMIRE_RANGE_METERS = 13;
const PEDESTRIAN_ADMIRE_RANGE_SQ =
  PEDESTRIAN_ADMIRE_RANGE_METERS * PEDESTRIAN_ADMIRE_RANGE_METERS;
const PEDESTRIAN_ADMIRE_MIN_SPEED_KMH = 65;
const PEDESTRIAN_HORN_RANGE_METERS = 18;
const PEDESTRIAN_HORN_RANGE_SQ =
  PEDESTRIAN_HORN_RANGE_METERS * PEDESTRIAN_HORN_RANGE_METERS;

const IDLE_INPUT: InputState = {
  forward: false,
  backward: false,
  left: false,
  right: false,
  handbrake: false,
  boost: false,
  interactPressed: false,
  hornPressed: false,
};

function getBrowserLocalStorage(): StorageLike | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

function blurFocusedElementInside(container: HTMLElement): void {
  if (typeof document === 'undefined' || typeof HTMLElement === 'undefined') {
    return;
  }
  const active = document.activeElement;
  if (active instanceof HTMLElement && container.contains(active)) {
    active.blur();
  }
}

function mapDialogueSpeakerToVoiceProfile(speaker: DialogueSpeaker): VoiceProfile {
  switch (speaker) {
    case 'valeria':
      return 'valeria';
    case 'mateo':
      return 'mateo';
    case 'system':
    case 'radio':
      return 'system';
  }
}

const MOBILE_USER_AGENT_PATTERN = /Android|iPhone|iPad|iPod|Mobile/i;

function readDevicePixelRatio(): number {
  return typeof window !== 'undefined' && Number.isFinite(window.devicePixelRatio)
    ? window.devicePixelRatio
    : 1;
}

function readDeviceProfile(gpuRenderer: string | undefined): DeviceProfile {
  const nav: (Navigator & { readonly deviceMemory?: number }) | undefined =
    typeof navigator !== 'undefined' ? navigator : undefined;
  return {
    devicePixelRatio: readDevicePixelRatio(),
    isMobile: MOBILE_USER_AGENT_PATTERN.test(nav?.userAgent ?? ''),
    ...(typeof nav?.hardwareConcurrency === 'number'
      ? { hardwareConcurrency: nav.hardwareConcurrency }
      : {}),
    ...(typeof nav?.deviceMemory === 'number' ? { deviceMemoryGb: nav.deviceMemory } : {}),
    ...(gpuRenderer ? { gpuRenderer } : {}),
  };
}

function distance2DSquared(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
}

interface WorldRendererAssetsTelemetry {
  dispose(): void;
  readonly isAssetsLoaded?: () => boolean;
  readonly areAssetsLoaded?: () => boolean;
  readonly getAssetsLoaded?: () => boolean;
  readonly assetsLoaded?: boolean;
  readonly setGarageAppearance?: (garage: GarageConfig) => void;
}

function applyRendererGarageAppearance(
  renderer: WorldRendererAssetsTelemetry | null,
  garage: GarageConfig,
): void {
  renderer?.setGarageAppearance?.(garage);
}

function readAssetsLoaded(renderer: WorldRendererAssetsTelemetry | null): boolean | undefined {
  if (!renderer) {
    return undefined;
  }
  if (typeof renderer.isAssetsLoaded === 'function') {
    return renderer.isAssetsLoaded();
  }
  if (typeof renderer.areAssetsLoaded === 'function') {
    return renderer.areAssetsLoaded();
  }
  if (typeof renderer.getAssetsLoaded === 'function') {
    return renderer.getAssetsLoaded();
  }
  if (typeof renderer.assetsLoaded === 'boolean') {
    return renderer.assetsLoaded;
  }
  return undefined;
}

export class GameApp {
  private readonly canvas: HTMLCanvasElement;
  private readonly hudRoot: HTMLElement;
  private readonly linkTracking: LinkTrackingHandle;
  private readonly map: CaliMapConfig;

  private readonly world: GameWorld;
  private readonly missionDirector: MissionDirector;
  private readonly audioEngine: AudioEngine;
  private readonly voiceEngine: VoiceEngine;
  private readonly hud: HudController;
  private readonly challenge: ChallengeSession;
  private readonly learning: LearningSession;
  private readonly inputManager: InputManager;
  private worldRenderer: WorldRenderer | null = null;

  private cameraMode: CameraMode = 'chase';
  private garageConfig: GarageConfig;
  private garageOpen = false;
  private garagePausedGameplay = false;
  private rafId: number | null = null;
  private lastFrameTimeMs: number | null = null;
  private smoothedFps = 60;
  private qualityLevel: QualityLevel = 'medium';
  private qualityDetected = false;
  private resolutionScaler: ResolutionScalerState = createResolutionScalerState();
  private cachedWorldSnapshot: Readonly<WorldSnapshot> | null = null;
  private running = false;
  private disposed = false;

  private lastSpokenDialogueId: string | null = null;
  private lastWantedStars: WantedLevel = 0;
  private lastStuntJumpAudioAt = 0;
  private lastPayNSprayAudioAt = 0;
  private prevFleeingPedIds = new Set<string>();
  private policeMegaphoneIndex = 0;
  private pedestrianFleeIndex = 0;
  private pedestrianAdmireIndex = 0;

  private readonly handleResizeListener: () => void;
  private readonly handleAnimationFrame: (timestampMs: number) => void;

  public constructor(
    canvas: HTMLCanvasElement,
    hudRoot: HTMLElement,
    map: CaliMapConfig = CALI_MAP,
    options: GameAppOptions = {},
  ) {
    this.canvas = canvas;
    this.hudRoot = hudRoot;
    this.map = map;
    this.linkTracking = installUtmLinkTagging(hudRoot);

    this.world = new GameWorld(this.map);
    const browserStorage = getBrowserLocalStorage();
    const storage = new StorageAdapter(browserStorage);
    this.missionDirector = new MissionDirector(this.map, storage);
    this.garageConfig = this.missionDirector.getGarageConfig();
    this.world.applyGarageCar(
      this.garageConfig.carKind,
      this.garageConfig.paintHex,
      this.garageConfig.neonHex,
    );

    const initialRecords = this.missionDirector.getRecords();
    const initialVoicesEnabled = initialRecords.voicesEnabled ?? true;
    this.audioEngine = new AudioEngine({
      station: initialRecords.preferredStation,
      muted: initialRecords.muted,
      initialVoicesEnabled,
    });
    this.voiceEngine =
      options.voiceEngine ??
      new VoiceEngine({
        enabled: initialVoicesEnabled,
        muted: initialRecords.muted,
      });

    this.hud = new HudController(
      this.hudRoot,
      {
        onStartMission: (id) => {
          this.challenge.abandon();
          this.startMission(id);
        },
        onResume: () => this.resumeGame(),
        onRestart: () => this.restartMission(),
        onReturnTitle: () => {
          this.challenge.abandon();
          this.returnToTitle();
        },
        onCycleRadio: () => this.cycleRadio(),
        onToggleMute: () => this.toggleMute(),
        onToggleVoices: () => this.toggleVoices(),
        onCycleCamera: () => this.cycleCamera(),
        onTogglePause: () => this.togglePause(),
        onToggleTimeOfDay: () => this.toggleTimeOfDay(),
        onToggleGarage: () => this.toggleGarage(),
        onCycleQuality: () => this.cycleQuality(),
        onUpdateGarage: (garage) => this.updateGarage(garage),
        onRetryWebgl: () => this.retryWebgl(),
        onOpenAlbum: () => this.learning.openAlbum(),
        onSwitchLanguage: (language) => switchLanguage(language),
      },
      this.map,
    );
    this.hud.setGarageConfig(this.garageConfig);

    this.challenge = new ChallengeSession({
      root: this.hudRoot,
      port: options.leaderboard ?? new FirestoreLeaderboard(),
      storage: browserStorage,
      host: {
        startChallengeStage: (missionId) => this.startMission(missionId, { challengeRun: true }),
        returnToTitle: () => this.returnToTitle(),
      },
    });
    this.challenge.mountTitleCard(this.hud.getTitleScreen());

    this.learning = new LearningSession({
      root: this.hudRoot,
      storage: browserStorage,
      cardSpots: CLAUDE_CARD_SPOTS,
      cardPickupRadius: CLAUDE_CARD_PICKUP_RADIUS,
      host: {
        rewindWorld: (seconds) => {
          this.invalidateWorldSnapshot();
          return this.world.rewind(seconds);
        },
        applyWantedDelta: (delta) => this.applyWantedDelta(delta),
        setBustHold: (held) => this.world.setBustHold(held),
        relieveBust: () => {
          this.invalidateWorldSnapshot();
          this.world.relieveBust();
        },
        applyPlanChoice: (choice) => {
          if (choice === 'turbo') {
            this.invalidateWorldSnapshot();
            this.world.refillNitro();
          } else {
            this.applyWantedDelta(-1);
          }
        },
        onCardsChanged: (collected, complete) => {
          this.hud.setClaudePaintUnlocked(complete);
          this.worldRenderer?.setCollectedClaudeCards(new Set(collected));
        },
        startMission: (missionId) => {
          this.challenge.abandon();
          this.startMission(missionId);
        },
        speakRadioAd: (text) => {
          this.audioEngine.playRadioSquelch();
          this.voiceEngine.speak(text, 'narrator', 'callout');
        },
      },
    });
    this.hud.setClaudePaintUnlocked(this.learning.hasAllCards());
    this.learning.mountTitleShowcase(this.hud.getTitleScreen());

    this.inputManager = new InputManager(
      {
        onCycleRadio: () => this.cycleRadio(),
        onCycleCamera: () => this.cycleCamera(),
        onToggleMute: () => this.toggleMute(),
        onToggleVoices: () => this.toggleVoices(),
        onTogglePause: () => this.togglePause(),
        onToggleTimeOfDay: () => this.toggleTimeOfDay(),
        onToggleGarage: () => this.toggleGarage(),
        onCycleQuality: () => this.cycleQuality(),
        onHorn: () => this.triggerHorn(),
        onRewind: () =>
          this.learning.requestRewind(this.missionDirector.getSnapshot().mode === 'playing'),
        onNumberKey: (index) => {
          this.learning.handleNumberKey(index);
        },
        onAnyUserGesture: () => {
          this.audioEngine.unlock();
        },
        isPlaying: () =>
          this.missionDirector.getSnapshot().mode === 'playing' &&
          !this.garageOpen &&
          !this.challenge.isBlockingGameplay() &&
          !this.learning.isBlockingGameplay(),
      },
      window,
      this.canvas,
    );

    this.handleResizeListener = () => {
      this.resizeRenderer();
    };
    this.handleAnimationFrame = (timestampMs: number) => {
      this.onFrame(timestampMs);
    };

    this.initRenderer();
    this.attachDebugHook();
    window.addEventListener('resize', this.handleResizeListener);
  }

  public start(): void {
    if (this.running || this.disposed) {
      return;
    }
    this.running = true;
    this.lastFrameTimeMs = null;
    this.resizeRenderer();
    this.renderPresentState(0);
    this.rafId = window.requestAnimationFrame(this.handleAnimationFrame);
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.running = false;
    this.linkTracking.dispose();

    if (this.rafId !== null) {
      window.cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    window.removeEventListener('resize', this.handleResizeListener);
    this.detachDebugHook();

    this.inputManager.dispose();
    this.hud.dispose();
    this.challenge.dispose();
    this.learning.dispose();
    this.worldRenderer?.dispose();
    this.worldRenderer = null;
    this.voiceEngine.dispose();
    this.audioEngine.dispose();
  }

  public toggleVoices(): void {
    this.audioEngine.unlock();
    const nextEnabled = this.audioEngine.toggleVoices();
    this.voiceEngine.setEnabled(nextEnabled);
    const state = this.audioEngine.getState();
    this.missionDirector.saveAudioPreferences(
      state.station,
      state.muted,
      state.voicesEnabled,
    );
    this.renderPresentState(0);
  }

  public updateGarage(next: GarageConfig): void {
    this.audioEngine.unlock();
    const saved = this.missionDirector.saveGarageConfig(next);
    this.garageConfig = saved;
    this.invalidateWorldSnapshot();
    this.world.applyGarageCar(saved.carKind, saved.paintHex, saved.neonHex);
    applyRendererGarageAppearance(this.worldRenderer, saved);
    this.hud.setGarageConfig(saved);
    this.renderPresentState(0);
  }

  public toggleGarage(): void {
    const mode = this.missionDirector.getSnapshot().mode;
    if (this.garageOpen) {
      this.garageOpen = false;
      this.hud.setGarageOpen(false);
      if (this.garagePausedGameplay) {
        this.garagePausedGameplay = false;
        if (mode === 'paused') {
          this.missionDirector.setPaused(false);
        }
      }
      this.inputManager.clearKeys();
      blurFocusedElementInside(this.hudRoot);
      this.renderPresentState(0);
      return;
    }

    if (mode !== 'title' && mode !== 'playing') {
      return;
    }

    this.audioEngine.unlock();
    this.garageOpen = true;
    this.garagePausedGameplay = mode === 'playing';
    if (this.garagePausedGameplay) {
      this.missionDirector.setPaused(true);
      this.inputManager.clearKeys();
      this.silenceAudioForFrozenState();
    }
    this.hud.setGarageOpen(true);
    this.renderPresentState(0);
  }

  public getDebugSnapshot(): GameDebugSnapshot {
    const worldSnap = this.world.getSnapshot();
    const missionSnap = this.missionDirector.getSnapshot();
    const assetsLoaded = readAssetsLoaded(this.worldRenderer);
    return {
      mode: missionSnap.mode,
      cameraMode: this.resolveActiveCameraMode(missionSnap),
      world: worldSnap,
      mission: missionSnap,
      audio: this.audioEngine.getState(),
      fps: Math.round(this.smoothedFps),
      garage: { ...this.garageConfig },
      ...(this.worldRenderer
        ? {
            perf: {
              fps: Math.round(this.smoothedFps),
              quality: this.qualityLevel,
              resolutionScale: this.resolutionScaler.scale,
              pixelRatio: this.worldRenderer.getPixelRatio(),
              ...this.worldRenderer.getRenderStats(),
            },
          }
        : {}),
      ...(assetsLoaded !== undefined ? { assetsLoaded } : {}),
      learning: this.learning.getDebug(),
      voice: this.voiceEngine.getLastVoiceName(),
    };
  }

  public getQualityLevel(): QualityLevel {
    return this.qualityLevel;
  }

  private cycleQuality(): void {
    this.qualityLevel = cycleQualityLevel(this.qualityLevel);
    this.resolutionScaler = createResolutionScalerState();
    this.applyQuality();
  }

  private applyQuality(): void {
    const preset = QUALITY_PRESETS[this.qualityLevel];
    this.worldRenderer?.setQuality(preset);
    this.applyRenderPixelRatio();
    this.hud.setQualityLevel(this.qualityLevel);
  }

  private applyRenderPixelRatio(): void {
    this.worldRenderer?.setPixelRatio(
      resolveRenderPixelRatio(
        QUALITY_PRESETS[this.qualityLevel],
        readDevicePixelRatio(),
        this.resolutionScaler.scale,
      ),
    );
  }

  private updateDynamicResolution(dt: number): void {
    const next = stepResolutionScaler(this.resolutionScaler, this.smoothedFps, dt);
    const scaleChanged = next.scale !== this.resolutionScaler.scale;
    this.resolutionScaler = next;
    if (scaleChanged) {
      this.applyRenderPixelRatio();
    }
  }

  private readWorldSnapshot(): Readonly<WorldSnapshot> {
    this.cachedWorldSnapshot ??= this.world.getSnapshot();
    return this.cachedWorldSnapshot;
  }

  private stepWorld(dt: number, input: InputState): Readonly<WorldSnapshot> {
    this.cachedWorldSnapshot = this.world.step(dt, input);
    return this.cachedWorldSnapshot;
  }

  private invalidateWorldSnapshot(): void {
    this.cachedWorldSnapshot = null;
  }

  private initRenderer(): void {
    this.worldRenderer?.dispose();
    this.worldRenderer = null;

    try {
      this.worldRenderer = new WorldRenderer(this.canvas, this.map);
      applyRendererGarageAppearance(this.worldRenderer, this.garageConfig);
      this.worldRenderer.setCollectedClaudeCards(new Set(this.learning.getCollectedCards()));
      this.hud.hideWebglError();
      this.detectQualityOnce(this.worldRenderer.getGpuRendererName());
      this.applyQuality();
      this.resizeRenderer();
    } catch (error) {
      this.worldRenderer = null;
      if (error instanceof WebGLUnavailableError) {
        this.detectQualityOnce(undefined);
        this.hud.setQualityLevel(this.qualityLevel);
        this.hud.showWebglError();
        return;
      }
      throw error;
    }
  }

  private detectQualityOnce(gpuRenderer: string | undefined): void {
    if (this.qualityDetected) {
      return;
    }
    this.qualityDetected = true;
    this.qualityLevel = detectInitialQuality(readDeviceProfile(gpuRenderer));
  }

  private retryWebgl(): void {
    this.audioEngine.unlock();
    this.initRenderer();
    this.renderPresentState(0);
  }

  private resizeRenderer(): void {
    if (!this.worldRenderer) {
      return;
    }
    const width = this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.clientHeight || window.innerHeight;
    this.worldRenderer.resize(width, height);
  }

  /** Launches a mission, opening the Modo Plan briefing first when it has not been shown yet. */
  private startMission(
    missionId: MissionId,
    options: { readonly challengeRun?: boolean } = {},
  ): void {
    this.audioEngine.unlock();
    this.learning.beginMission(missionId, () => this.launchMission(missionId, options));
    this.renderPresentState(0);
  }

  private launchMission(
    missionId: MissionId,
    options: { readonly challengeRun?: boolean } = {},
  ): void {
    this.audioEngine.unlock();
    this.garageOpen = false;
    this.garagePausedGameplay = false;
    this.hud.setGarageOpen(false);
    const start = this.map.missionStarts[missionId];
    this.invalidateWorldSnapshot();
    this.world.reset({
      spawn: start.playerSpawn,
      carSpawn: start.carSpawn,
      startInVehicle: start.startInVehicle,
      wantedStars: start.initialWantedStars,
      playerCarKind: this.garageConfig.carKind,
      playerPaintHex: this.garageConfig.paintHex,
      playerNeonHex: this.garageConfig.neonHex,
      enableRivals: missionId === 'mission_3_pique_bulevar',
    });
    applyRendererGarageAppearance(this.worldRenderer, this.garageConfig);
    const missionSnap = this.missionDirector.startMission(missionId, options);
    this.learning.onMissionStarted(this.readWorldSnapshot());
    this.resetVoiceAndPursuitTrackers(start.initialWantedStars);
    this.syncSpokenMissionDialogue(missionSnap);
    this.inputManager.clearKeys();
    blurFocusedElementInside(this.hudRoot);
    this.renderPresentState(0);
  }

  private restartMission(): void {
    if (this.challenge.isRunning() || this.missionDirector.getSnapshot().isChallengeRun) {
      // Reto AcaDevHack runs are back to back: a restart begins again at Mission 1.
      this.challenge.retry();
      return;
    }
    const activeMission = this.missionDirector.getSnapshot().activeMission;
    this.startMission(activeMission);
  }

  private resumeGame(): void {
    this.audioEngine.unlock();
    this.garageOpen = false;
    this.garagePausedGameplay = false;
    this.hud.setGarageOpen(false);
    this.missionDirector.setPaused(false);
    this.inputManager.clearKeys();
    blurFocusedElementInside(this.hudRoot);
    this.renderPresentState(0);
  }

  private togglePause(): void {
    if (this.garageOpen) {
      this.toggleGarage();
      return;
    }
    const mode = this.missionDirector.getSnapshot().mode;
    if (mode === 'playing') {
      this.missionDirector.setPaused(true);
      this.inputManager.clearKeys();
      this.silenceAudioForFrozenState();
      this.renderPresentState(0);
    } else if (mode === 'paused') {
      this.resumeGame();
    }
  }

  private returnToTitle(): void {
    this.learning.cancelPendingPlan();
    this.garageOpen = false;
    this.garagePausedGameplay = false;
    this.hud.setGarageOpen(false);
    this.invalidateWorldSnapshot();
    this.world.reset({
      startInVehicle: false,
      wantedStars: 0,
      playerCarKind: this.garageConfig.carKind,
      playerPaintHex: this.garageConfig.paintHex,
      playerNeonHex: this.garageConfig.neonHex,
    });
    applyRendererGarageAppearance(this.worldRenderer, this.garageConfig);
    this.missionDirector.returnToTitle();
    this.resetVoiceAndPursuitTrackers(0);
    this.inputManager.clearKeys();
    this.silenceAudioForFrozenState();
    this.renderPresentState(0);
  }

  private triggerHorn(): void {
    if (this.garageOpen || this.missionDirector.getSnapshot().mode !== 'playing') {
      return;
    }
    this.audioEngine.unlock();
    const worldSnap = this.world.getSnapshot();
    if (worldSnap.player.mode !== 'driving' || worldSnap.player.vehicleId === null) {
      return;
    }
    const activeVehicle = worldSnap.vehicles.find(
      (vehicle) => vehicle.id === worldSnap.player.vehicleId,
    );
    if (!activeVehicle) {
      return;
    }
    this.audioEngine.playHorn(activeVehicle.kind);
    const pedestrians = worldSnap.pedestrians ?? [];
    const hasNearbyPedestrian = pedestrians.some(
      (ped) =>
        distance2DSquared(ped.x, ped.z, worldSnap.player.x, worldSnap.player.z) <=
        PEDESTRIAN_HORN_RANGE_SQ,
    );
    if (hasNearbyPedestrian) {
      this.voiceEngine.speakPedestrianHornReaction(LOCALE_CALI.voiceLines.pedestrianHorn);
    }
  }

  private cycleRadio(): void {
    this.audioEngine.unlock();
    const state = this.audioEngine.cycleStation();
    this.missionDirector.saveAudioPreferences(
      state.station,
      state.muted,
      state.voicesEnabled,
    );
    this.renderPresentState(0);
  }

  private toggleMute(): void {
    this.audioEngine.unlock();
    const state = this.audioEngine.toggleMute();
    this.voiceEngine.setMuted(state.muted);
    this.missionDirector.saveAudioPreferences(
      state.station,
      state.muted,
      state.voicesEnabled,
    );
    this.renderPresentState(0);
  }

  private cycleCamera(): void {
    const currentIndex = PLAYABLE_CAMERA_MODES.indexOf(this.cameraMode);
    this.cameraMode =
      PLAYABLE_CAMERA_MODES[(currentIndex + 1) % PLAYABLE_CAMERA_MODES.length] ?? 'chase';
    this.renderPresentState(0);
  }

  private toggleTimeOfDay(): void {
    if (this.missionDirector.getSnapshot().mode !== 'playing') {
      return;
    }
    this.missionDirector.toggleTimeOfDay();
    this.renderPresentState(0);
  }

  private onFrame(timestampMs: number): void {
    if (!this.running || this.disposed) {
      return;
    }

    const rawDt =
      this.lastFrameTimeMs === null
        ? DEFAULT_FRAME_DT_SECONDS
        : (timestampMs - this.lastFrameTimeMs) / 1000;
    this.lastFrameTimeMs = timestampMs;

    const dt =
      Number.isFinite(rawDt) && rawDt > 0
        ? Math.min(rawDt, MAX_FRAME_DT_SECONDS)
        : DEFAULT_FRAME_DT_SECONDS;

    if (Number.isFinite(rawDt) && rawDt > 0.001) {
      const instantFps = Math.min(240, 1 / rawDt);
      this.smoothedFps = this.smoothedFps * 0.9 + instantFps * 0.1;
    }

    if (this.missionDirector.getSnapshot().mode === 'playing') {
      this.updateDynamicResolution(dt);
    }
    this.stepFrame(dt);
    this.rafId = window.requestAnimationFrame(this.handleAnimationFrame);
  }

  private stepFrame(dt: number): void {
    const initialMission = this.missionDirector.getSnapshot();
    const mode = initialMission.mode;

    if (mode === 'playing') {
      this.stepPlayingFrame(dt, initialMission);
      return;
    }

    if (mode === 'title' || mode === 'victory') {
      const worldSnap = this.stepWorld(dt, IDLE_INPUT);
      this.audioEngine.update(
        {
          ...worldSnap,
          wantedStars: 0,
          player: { ...worldSnap.player, mode: 'on_foot' },
        },
        dt,
      );
      this.renderSnapshots(worldSnap, initialMission, dt);
      return;
    }

    // Paused, Mission Passed, or Busted: freeze simulation progression cleanly
    this.silenceAudioForFrozenState();
    this.renderSnapshots(this.readWorldSnapshot(), initialMission, 0);
  }

  private stepPlayingFrame(dt: number, prevMission: Readonly<MissionSnapshot>): void {
    const prevWorld = this.readWorldSnapshot();
    const prevObjectiveStep = prevMission.activeObjective?.stepIndex ?? -1;
    const prevObjectiveId = prevMission.activeObjective?.id ?? null;

    const input = this.inputManager.consumeInputState();
    const cameraLook = this.inputManager.consumeCameraLook();
    this.worldRenderer?.applyCameraLook(
      cameraLook.yawDelta,
      cameraLook.pitchDelta,
      cameraLook.zoomDelta,
    );
    let worldSnap = this.stepWorld(dt, input);
    const missionSnap = this.missionDirector.update(worldSnap, dt);
    this.challenge.onMissionTransition(prevMission, missionSnap);
    this.learning.step(dt, worldSnap, prevMission, missionSnap, this.audioEngine.getState());

    const nextObjectiveStep = missionSnap.activeObjective?.stepIndex ?? -1;
    let worldMutated = false;

    if (
      missionSnap.mode === 'playing' &&
      missionSnap.activeMission === 'mission_2_cristo_rey' &&
      prevObjectiveStep >= 0 &&
      nextObjectiveStep > prevObjectiveStep
    ) {
      this.invalidateWorldSnapshot();
      this.world.refillNitro();
      this.learning.notifyHookRefill();
      worldMutated = true;
    }

    if (
      missionSnap.mode === 'playing' &&
      missionSnap.activeMission === 'mission_3_pique_bulevar' &&
      missionSnap.activeObjective
    ) {
      this.invalidateWorldSnapshot();
      this.world.setPlayerRaceProgress(missionSnap.activeObjective.stepIndex);
      worldMutated = true;
    }

    if (worldSnap.wantedStars !== missionSnap.targetWantedStars) {
      this.invalidateWorldSnapshot();
      this.world.setWantedStars(missionSnap.targetWantedStars);
      worldMutated = true;
    }

    if (worldMutated) {
      worldSnap = this.readWorldSnapshot();
    }

    this.triggerSfxTransitions(prevWorld, worldSnap, prevMission, missionSnap, prevObjectiveStep, prevObjectiveId);
    this.triggerCollisionAndVoiceEvents(worldSnap, missionSnap);
    this.audioEngine.update(worldSnap, dt);
    this.renderSnapshots(worldSnap, missionSnap, dt);
  }

  private resetVoiceAndPursuitTrackers(initialWantedStars: WantedLevel): void {
    this.lastSpokenDialogueId = null;
    this.lastWantedStars = initialWantedStars;
    this.lastStuntJumpAudioAt = 0;
    this.lastPayNSprayAudioAt = 0;
    this.prevFleeingPedIds.clear();
  }

  private triggerCollisionAndVoiceEvents(
    worldSnap: Readonly<WorldSnapshot>,
    missionSnap: Readonly<MissionSnapshot>,
  ): void {
    if (worldSnap.collisionImpact > COLLISION_FOLEY_THRESHOLD) {
      this.audioEngine.playCollision(worldSnap.collisionImpact);
    }

    const stuntJumpAt = worldSnap.lastStuntJumpAt ?? 0;
    if (stuntJumpAt > this.lastStuntJumpAudioAt) {
      this.lastStuntJumpAudioAt = stuntJumpAt;
      this.audioEngine.playStuntJump();
    }

    const payNSprayAt = worldSnap.lastPayNSprayAt ?? 0;
    if (payNSprayAt > this.lastPayNSprayAudioAt) {
      this.lastPayNSprayAudioAt = payNSprayAt;
      this.audioEngine.playPayNSpray();
      this.voiceEngine.speakPayNSprayCallout(LOCALE_CALI.voiceLines.payNSpray);
    }

    this.syncSpokenMissionDialogue(missionSnap);
    this.syncPoliceVoiceAndSquelch(worldSnap);
    this.syncPedestrianVoiceCallouts(worldSnap);
  }

  private syncSpokenMissionDialogue(missionSnap: Readonly<MissionSnapshot>): void {
    const dialogue = missionSnap.dialogue;
    if (!dialogue) {
      this.lastSpokenDialogueId = null;
      return;
    }
    if (dialogue.id !== this.lastSpokenDialogueId) {
      this.lastSpokenDialogueId = dialogue.id;
      if (dialogue.id.startsWith('payNSpray_')) {
        return;
      }
      const profile = mapDialogueSpeakerToVoiceProfile(dialogue.speaker);
      this.voiceEngine.speak(dialogue.spokenText, profile, 'mission');
    }
  }

  private syncPoliceVoiceAndSquelch(worldSnap: Readonly<WorldSnapshot>): void {
    if (worldSnap.wantedStars > this.lastWantedStars) {
      this.audioEngine.playRadioSquelch();
    }
    this.lastWantedStars = worldSnap.wantedStars;

    if (worldSnap.wantedStars <= 0) {
      return;
    }

    const policeInRange = worldSnap.vehicles.some(
      (vehicle) =>
        (vehicle.kind === 'police' || vehicle.role === 'police') &&
        vehicle.sirenActive &&
        distance2DSquared(
          vehicle.x,
          vehicle.z,
          worldSnap.player.x,
          worldSnap.player.z,
        ) <= POLICE_MEGAPHONE_RANGE_SQ,
    );

    if (!policeInRange) {
      return;
    }

    const lines = LOCALE_CALI.voiceLines.policeMegaphone;
    const line = lines[this.policeMegaphoneIndex % lines.length];
    if (line && this.voiceEngine.speak(line, 'police', 'callout')) {
      this.policeMegaphoneIndex = (this.policeMegaphoneIndex + 1) % lines.length;
      this.audioEngine.playRadioSquelch();
    }
  }

  private syncPedestrianVoiceCallouts(worldSnap: Readonly<WorldSnapshot>): void {
    const pedestrians = worldSnap.pedestrians ?? [];
    const nextFleeingPedIds = new Set<string>();
    let hasNewlyFleeingNearby = false;
    let hasNearbyForAdmire = false;

    for (const ped of pedestrians) {
      if (ped.fleeing) {
        nextFleeingPedIds.add(ped.id);
      }
      const distSq = distance2DSquared(
        ped.x,
        ped.z,
        worldSnap.player.x,
        worldSnap.player.z,
      );
      if (
        ped.fleeing &&
        !this.prevFleeingPedIds.has(ped.id) &&
        distSq <= PEDESTRIAN_FLEE_RANGE_SQ
      ) {
        hasNewlyFleeingNearby = true;
      }
      if (distSq <= PEDESTRIAN_ADMIRE_RANGE_SQ) {
        hasNearbyForAdmire = true;
      }
    }

    this.prevFleeingPedIds = nextFleeingPedIds;

    if (hasNewlyFleeingNearby) {
      const fleeLines = LOCALE_CALI.voiceLines.pedestrianFlee;
      const line = fleeLines[this.pedestrianFleeIndex % fleeLines.length];
      if (line && this.voiceEngine.speak(line, 'pedestrian', 'callout')) {
        this.pedestrianFleeIndex = (this.pedestrianFleeIndex + 1) % fleeLines.length;
      }
      return;
    }

    if (!hasNearbyForAdmire || worldSnap.player.mode !== 'driving') {
      return;
    }

    const activeVehicle =
      worldSnap.player.vehicleId !== null
        ? worldSnap.vehicles.find((vehicle) => vehicle.id === worldSnap.player.vehicleId)
        : undefined;
    if (
      activeVehicle?.role === 'player' &&
      (worldSnap.player.speedKmh > PEDESTRIAN_ADMIRE_MIN_SPEED_KMH ||
        worldSnap.player.isDrifting)
    ) {
      const admireLines = LOCALE_CALI.voiceLines.pedestrianAdmire;
      const line = admireLines[this.pedestrianAdmireIndex % admireLines.length];
      if (line && this.voiceEngine.speak(line, 'pedestrian', 'callout')) {
        this.pedestrianAdmireIndex = (this.pedestrianAdmireIndex + 1) % admireLines.length;
      }
    }
  }

  private triggerSfxTransitions(
    prevWorld: Readonly<WorldSnapshot>,
    nextWorld: Readonly<WorldSnapshot>,
    prevMission: Readonly<MissionSnapshot>,
    nextMission: Readonly<MissionSnapshot>,
    prevObjectiveStep: number,
    prevObjectiveId: string | null,
  ): void {
    if (nextWorld.player.mode !== prevWorld.player.mode) {
      this.audioEngine.playSfx('enter_car');
    }

    if (nextWorld.player.isBoosting && !prevWorld.player.isBoosting) {
      this.audioEngine.playSfx('nitro');
    }

    if (
      prevMission.mode === 'playing' &&
      (nextMission.mode === 'mission_passed' || nextMission.mode === 'victory')
    ) {
      this.audioEngine.playSfx('mission_passed');
      return;
    }

    if (prevMission.mode === 'playing' && nextMission.mode === 'busted') {
      this.audioEngine.playSfx('busted');
      return;
    }

    const nextObjective = nextMission.activeObjective;
    if (
      nextMission.mode === 'playing' &&
      nextObjective &&
      (nextObjective.stepIndex > prevObjectiveStep ||
        (prevObjectiveId !== null && nextObjective.id !== prevObjectiveId))
    ) {
      this.audioEngine.playSfx('checkpoint');
    }
  }

  private silenceAudioForFrozenState(): void {
    const snap = this.readWorldSnapshot();
    this.audioEngine.update(
      {
        ...snap,
        wantedStars: 0,
        player: { ...snap.player, mode: 'on_foot' },
      },
      0,
    );
  }

  private resolveActiveCameraMode(mission: Readonly<MissionSnapshot>): CameraMode {
    if (mission.mode === 'title' || mission.mode === 'victory') {
      return 'victory_orbit';
    }
    return this.cameraMode;
  }

  private renderPresentState(dt: number): void {
    this.renderSnapshots(this.readWorldSnapshot(), this.missionDirector.getSnapshot(), dt);
  }

  private renderSnapshots(
    worldSnap: Readonly<WorldSnapshot>,
    missionSnap: Readonly<MissionSnapshot>,
    dt: number,
  ): void {
    const activeCamera = this.resolveActiveCameraMode(missionSnap);
    this.worldRenderer?.sync(worldSnap, missionSnap, activeCamera, dt);
    this.hud.render(
      worldSnap,
      missionSnap,
      this.audioEngine.getState(),
      activeCamera,
      this.garageConfig,
    );
    this.challenge.render(missionSnap);
    this.learning.render(dt, missionSnap);
  }

  /** Police hack / Modo Plan: change wanted stars through the director so its floor follows. */
  private applyWantedDelta(delta: number): void {
    const current = this.world.getSnapshot().wantedStars;
    const next = this.missionDirector.applyWantedDelta(current, delta);
    if (next !== current) {
      this.invalidateWorldSnapshot();
      this.world.setWantedStars(next);
    }
  }

  private attachDebugHook(): void {
    Object.defineProperty(window, '__GTA_CALI__', {
      configurable: true,
      enumerable: true,
      get: (): GameDebugSnapshot => this.getDebugSnapshot(),
    });
  }

  private detachDebugHook(): void {
    const win = window as { __GTA_CALI__?: GameDebugSnapshot };
    delete win.__GTA_CALI__;
  }
}
