import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CALI_MAP } from '../../../src/config/caliMap';
import { LOCALE_CALI } from '../../../src/config/localeCali';
import type {
  AudioState,
  DialogueSpeaker,
  MissionSnapshot,
  WorldSnapshot,
} from '../../../src/types/game';
import {
  formatNitroPercent,
  formatTurnCue,
  HudController,
  type HudCallbacks,
} from '../../../src/ui/hudController';
import { MinimapRenderer } from '../../../src/ui/minimapRenderer';

class FakeDomElement {
  public readonly tagName: string;
  public className = '';
  public textContent = '';
  public hidden = false;
  public type = '';
  public width = 0;
  public height = 0;
  public readonly dataset: Record<string, string> = {};
  public readonly style: Record<string, string> = {};
  public readonly children: FakeDomElement[] = [];
  private readonly attributes = new Map<string, string>();
  private readonly listeners = new Map<string, EventListener[]>();
  private parent: FakeDomElement | null = null;

  public constructor(tagName: string) {
    this.tagName = tagName.toLowerCase();
  }

  public setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  public getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  public append(...nodes: FakeDomElement[]): void {
    for (const node of nodes) {
      this.appendChild(node);
    }
  }

  public appendChild(node: FakeDomElement): FakeDomElement {
    node.parent = this;
    this.children.push(node);
    return node;
  }

  public remove(): void {
    if (!this.parent) {
      return;
    }
    const idx = this.parent.children.indexOf(this);
    if (idx >= 0) {
      this.parent.children.splice(idx, 1);
    }
    this.parent = null;
  }

  public addEventListener(type: string, listener: EventListener): void {
    const existing = this.listeners.get(type) ?? [];
    existing.push(listener);
    this.listeners.set(type, existing);
  }

  public removeEventListener(type: string, listener: EventListener): void {
    const existing = this.listeners.get(type);
    if (!existing) {
      return;
    }
    const idx = existing.indexOf(listener);
    if (idx >= 0) {
      existing.splice(idx, 1);
    }
  }

  public click(): void {
    const clickListeners = this.listeners.get('click') ?? [];
    for (const listener of clickListeners) {
      listener({} as Event);
    }
  }

  public getContext(_kind: string): null {
    return null;
  }

  public findFirst(predicate: (el: FakeDomElement) => boolean): FakeDomElement | null {
    if (predicate(this)) {
      return this;
    }
    for (const child of this.children) {
      const match = child.findFirst(predicate);
      if (match) {
        return match;
      }
    }
    return null;
  }

  public hasClass(name: string): boolean {
    return this.className.split(/\s+/).includes(name);
  }
}

function createCallbacks(): HudCallbacks {
  return {
    onStartMission: vi.fn(),
    onResume: vi.fn(),
    onRestart: vi.fn(),
    onReturnTitle: vi.fn(),
    onCycleRadio: vi.fn(),
    onToggleMute: vi.fn(),
    onCycleCamera: vi.fn(),
    onTogglePause: vi.fn(),
    onRetryWebgl: vi.fn(),
  };
}

function createWorldSnapshot(nitro: number, isBoosting = false): WorldSnapshot {
  return {
    timeSeconds: 12,
    player: {
      mode: 'driving',
      x: -4,
      y: 0,
      z: 12,
      heading: 0,
      speedMps: 25,
      speedKmh: 90,
      vehicleId: 'player_banshee',
      nearbyVehicleId: null,
      canEnterVehicle: false,
      nitro,
      isDrifting: false,
      isBoosting,
      isSprinting: false,
      inRiverHazard: false,
    },
    vehicles: [
      {
        id: 'player_banshee',
        kind: 'banshee',
        role: 'player',
        x: -4,
        y: 0,
        z: 12,
        heading: 0,
        speedMps: 25,
        speedKmh: 90,
        steerAngle: 0,
        isDrifting: false,
        isBoosting,
        nitro,
        sirenActive: false,
        colorHex: 0xff2e93,
        halfWidth: 1.1,
        halfLength: 2.3,
      },
    ],
    wantedStars: 0,
    bustProgress: 0,
    isBusted: false,
    driftScore: 0,
    topSpeedKmh: 90,
    currentDistrict: 'Bulevar del Río',
    collisionImpact: 0,
  };
}

function createMissionSnapshot(speaker: DialogueSpeaker | null = null): MissionSnapshot {
  return {
    mode: 'playing',
    activeMission: 'mission_1_bulevar',
    missionTitle: LOCALE_CALI.missions.mission_1_bulevar.title,
    activeObjective: {
      id: 'm1_torre_pickup',
      kind: 'reach_point',
      label: LOCALE_CALI.objectives.mission1.pickupLabel,
      detail: LOCALE_CALI.objectives.mission1.pickupDetail,
      target: { x: -4, z: -112 },
      radius: 16,
      landmarkId: 'torre_de_cali',
      stepIndex: 1,
      totalSteps: 4,
      beaconColorHex: 0xff2e93,
    },
    targetWantedStars: 0,
    completedMissions: [],
    bestTimes: {},
    discoveredLandmarks: ['san_antonio'],
    dialogue: speaker
      ? {
          id: `dialogue_${speaker}`,
          speaker,
          text: 'Mensaje de prueba',
          remainingSeconds: 4,
        }
      : null,
    viralTicker: LOCALE_CALI.viralTicker[0] ?? '',
    rewardCop: 0,
    cashCop: 0,
    timerSeconds: 12,
    elapsedSeconds: 12,
    lastCompletedTimeSeconds: null,
    isNewRecord: false,
  };
}

const DEFAULT_AUDIO: AudioState = {
  station: 'salsa_brava',
  stationLabel: LOCALE_CALI.radio.salsa_brava,
  muted: false,
  masterVolume: 0.7,
  unlocked: true,
};

describe('formatNitroPercent', () => {
  it('clamps 0..100 nitro percentages cleanly and handles non-finite input', () => {
    expect(formatNitroPercent(0)).toBe(0);
    expect(formatNitroPercent(42)).toBe(42);
    expect(formatNitroPercent(42.6)).toBe(43);
    expect(formatNitroPercent(100)).toBe(100);
    expect(formatNitroPercent(-15)).toBe(0);
    expect(formatNitroPercent(150)).toBe(100);
    expect(formatNitroPercent(Number.NaN)).toBe(0);
  });
});

describe('HudController', () => {
  const originalDocument = globalThis.document;
  let root: FakeDomElement;

  beforeEach(() => {
    root = new FakeDomElement('div');
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      writable: true,
      value: {
        createElement: (tag: string) => new FakeDomElement(tag),
      },
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      writable: true,
      value: originalDocument,
    });
  });

  it('renders nitro bar width and aria-valuenow directly on a 0..100 scale', () => {
    const hud = new HudController(root as unknown as HTMLElement, createCallbacks(), CALI_MAP);
    const nitroFill = root.findFirst((el) => el.hasClass('cali-nitro-fill'));
    const nitroTrack = root.findFirst((el) => el.hasClass('cali-nitro-track'));

    expect(nitroFill).not.toBeNull();
    expect(nitroTrack).not.toBeNull();

    hud.render(createWorldSnapshot(42, true), createMissionSnapshot(), DEFAULT_AUDIO, 'chase');
    expect(nitroFill?.style.width).toBe('42%');
    expect(nitroTrack?.getAttribute('aria-valuenow')).toBe('42');
    expect(nitroFill?.dataset.boosting).toBe('true');

    hud.render(createWorldSnapshot(0, false), createMissionSnapshot(), DEFAULT_AUDIO, 'chase');
    expect(nitroFill?.style.width).toBe('0%');
    expect(nitroTrack?.getAttribute('aria-valuenow')).toBe('0');
    expect(nitroFill?.dataset.boosting).toBe('false');

    hud.render(createWorldSnapshot(100, false), createMissionSnapshot(), DEFAULT_AUDIO, 'chase');
    expect(nitroFill?.style.width).toBe('100%');
    expect(nitroTrack?.getAttribute('aria-valuenow')).toBe('100');

    hud.dispose();
  });

  it('maps English DialogueSpeaker keys to localized Español Caleño labels', () => {
    const hud = new HudController(root as unknown as HTMLElement, createCallbacks(), CALI_MAP);
    const speakerEl = root.findFirst((el) => el.hasClass('cali-dialogue-speaker'));

    expect(speakerEl).not.toBeNull();

    const expectations: ReadonlyArray<readonly [DialogueSpeaker, string]> = [
      ['valeria', 'Valeria'],
      ['mateo', 'Mateo'],
      ['radio', 'Radio'],
      ['system', 'Sistema'],
    ];

    for (const [speakerKey, expectedLabel] of expectations) {
      hud.render(
        createWorldSnapshot(100),
        createMissionSnapshot(speakerKey),
        DEFAULT_AUDIO,
        'chase',
      );
      expect(speakerEl?.textContent).toBe(expectedLabel);
    }

    hud.dispose();
  });

  it('renders step progress badge, segmented dots, top-center compass rotation, turn cue, and live distance', () => {
    const hud = new HudController(root as unknown as HTMLElement, createCallbacks(), CALI_MAP);
    const stepProgress = root.findFirst((el) => el.dataset.testid === 'hud-step-progress');
    const compass = root.findFirst((el) => el.dataset.testid === 'hud-compass');
    const compassArrow = root.findFirst((el) => el.dataset.testid === 'hud-compass-arrow');
    const compassCue = root.findFirst((el) => el.dataset.testid === 'hud-compass-cue');
    const distanceEl = root.findFirst((el) => el.dataset.testid === 'hud-distance');

    expect(stepProgress).not.toBeNull();
    expect(compass).not.toBeNull();
    expect(compassArrow).not.toBeNull();
    expect(compassCue).not.toBeNull();
    expect(distanceEl).not.toBeNull();

    const missionWithNav: MissionSnapshot = {
      ...createMissionSnapshot(),
      activeObjective: {
        ...createMissionSnapshot().activeObjective!,
        stepIndex: 1,
        totalSteps: 4,
        distanceMeters: 142,
        bearingDeltaRad: Math.PI / 2,
      },
    };

    hud.render(createWorldSnapshot(80), missionWithNav, DEFAULT_AUDIO, 'chase');
    expect(stepProgress?.textContent).toBe(LOCALE_CALI.hud.stepProgress(2, 4));
    expect(compass?.hidden).toBe(false);
    expect(distanceEl?.textContent).toBe(`142 ${LOCALE_CALI.hud.metersUnit}`);
    expect(compassCue?.textContent).toBe(LOCALE_CALI.hud.directionLeft);
    // Font-independent CSS chevron (no Unicode glyph) + left bearing rotates counter-clockwise
    expect(compassArrow?.textContent).toBe('');
    expect(compassArrow?.style.transform).toContain('rotate(-1.571rad)');

    // Turn cue mapping across all quadrants
    expect(formatTurnCue(0)).toBe(LOCALE_CALI.hud.directionStraight);
    expect(formatTurnCue(Math.PI / 2)).toBe(LOCALE_CALI.hud.directionLeft);
    expect(formatTurnCue(-Math.PI / 2)).toBe(LOCALE_CALI.hud.directionRight);
    expect(formatTurnCue(Math.PI)).toBe(LOCALE_CALI.hud.directionBack);

    // Compass hides when activeObjective has no target
    hud.render(
      createWorldSnapshot(80),
      {
        ...missionWithNav,
        activeObjective: {
          ...missionWithNav.activeObjective!,
          target: null,
          distanceMeters: null,
          bearingDeltaRad: null,
        },
      },
      DEFAULT_AUDIO,
      'chase',
    );
    expect(compass?.hidden).toBe(true);

    hud.dispose();
  });

  it('renders center-screen checkpoint banners with accent attribute and hides when inactive', () => {
    const hud = new HudController(root as unknown as HTMLElement, createCallbacks(), CALI_MAP);
    const bannerEl = root.findFirst((el) => el.dataset.testid === 'hud-banner');
    expect(bannerEl).not.toBeNull();

    hud.render(
      createWorldSnapshot(100),
      {
        ...createMissionSnapshot(),
        banner: {
          id: 'm2Ramp',
          title: LOCALE_CALI.banners.m2Ramp.title,
          subtitle: LOCALE_CALI.banners.m2Ramp.subtitle,
          accent: 'gold',
          remainingSeconds: 2.5,
        },
      },
      DEFAULT_AUDIO,
      'chase',
    );

    expect(bannerEl?.hidden).toBe(false);
    expect(bannerEl?.dataset.accent).toBe('gold');
    expect(bannerEl?.findFirst((el) => el.textContent === LOCALE_CALI.banners.m2Ramp.title)).not.toBeNull();
    expect(bannerEl?.findFirst((el) => el.textContent === LOCALE_CALI.banners.m2Ramp.subtitle)).not.toBeNull();

    hud.render(
      createWorldSnapshot(100),
      { ...createMissionSnapshot(), banner: null },
      DEFAULT_AUDIO,
      'chase',
    );
    expect(bannerEl?.hidden).toBe(true);

    hud.dispose();
  });

  it('renders vehicle-specific [F] enter/hijack prompts and police evade cooldown bar', () => {
    const hud = new HudController(root as unknown as HTMLElement, createCallbacks(), CALI_MAP);
    const promptEl = root.findFirst((el) => el.dataset.testid === 'hud-vehicle-prompt');
    const evadeEl = root.findFirst((el) => el.dataset.testid === 'hud-evade-bar');
    expect(promptEl).not.toBeNull();
    expect(evadeEl).not.toBeNull();

    const baseWorld = createWorldSnapshot(100);
    // On foot near Banshee -> enterNamedVehicle
    hud.render(
      {
        ...baseWorld,
        player: {
          ...baseWorld.player,
          mode: 'on_foot',
          canEnterVehicle: true,
          nearbyVehicleId: 'player_banshee',
          nearbyVehicleKind: 'banshee',
        },
        wantedStars: 2,
        bustProgress: 0,
        policeEvadeProgress: 0.65,
      },
      createMissionSnapshot(),
      DEFAULT_AUDIO,
      'chase',
    );
    expect(promptEl?.hidden).toBe(false);
    expect(promptEl?.textContent).toBe(
      LOCALE_CALI.hud.enterNamedVehicle(LOCALE_CALI.vehicleNames.banshee),
    );
    expect(evadeEl?.hidden).toBe(false);
    expect(
      evadeEl?.findFirst((el) => el.textContent === LOCALE_CALI.hud.evadingPoliceLabel),
    ).not.toBeNull();

    // On foot near Chiva -> hijackNamedVehicle; evade hides while busting
    hud.render(
      {
        ...baseWorld,
        player: {
          ...baseWorld.player,
          mode: 'on_foot',
          canEnterVehicle: true,
          nearbyVehicleId: 'traffic_chiva',
          nearbyVehicleKind: 'chiva',
        },
        wantedStars: 2,
        bustProgress: 0.4,
        policeEvadeProgress: 0.65,
      },
      createMissionSnapshot(),
      DEFAULT_AUDIO,
      'chase',
    );
    expect(promptEl?.textContent).toBe(
      LOCALE_CALI.hud.hijackNamedVehicle(LOCALE_CALI.vehicleNames.chiva),
    );
    expect(evadeEl?.hidden).toBe(true);

    hud.dispose();
  });

  it('renders day/night toggle button, invokes onToggleTimeOfDay, and updates label dynamically', () => {
    const onToggleTimeOfDay = vi.fn();
    const callbacks: HudCallbacks = {
      ...createCallbacks(),
      onToggleTimeOfDay,
    };
    const hud = new HudController(root as unknown as HTMLElement, callbacks, CALI_MAP);
    const timeBtn = root.findFirst((el) => el.dataset.testid === 'btn-time-toggle');
    expect(timeBtn).not.toBeNull();

    hud.render(
      createWorldSnapshot(100),
      { ...createMissionSnapshot(), timeOfDay: 'golden_hour' },
      DEFAULT_AUDIO,
      'chase',
    );
    expect(timeBtn?.textContent).toBe(`[T] ${LOCALE_CALI.timeOfDayLabels.golden_hour}`);
    expect(timeBtn?.dataset.time).toBe('golden_hour');

    hud.render(
      createWorldSnapshot(100),
      { ...createMissionSnapshot(), timeOfDay: 'night' },
      DEFAULT_AUDIO,
      'chase',
    );
    expect(timeBtn?.textContent).toBe(`[T] ${LOCALE_CALI.timeOfDayLabels.night}`);
    expect(timeBtn?.dataset.time).toBe('night');

    timeBtn?.click();
    expect(onToggleTimeOfDay).toHaveBeenCalledTimes(1);

    hud.dispose();
  });

  it('sets countdown and urgent dataset attributes on the timer and shows timeUp vs busted failure copy', () => {
    const hud = new HudController(root as unknown as HTMLElement, createCallbacks(), CALI_MAP);
    const timerEl = root.findFirst((el) => el.dataset.testid === 'hud-timer');
    const bustedOverlay = root.findFirst((el) => el.dataset.testid === 'busted-overlay');
    const retryBtn = root.findFirst((el) => el.dataset.testid === 'btn-busted-retry');
    expect(timerEl).not.toBeNull();
    expect(bustedOverlay).not.toBeNull();
    expect(retryBtn).not.toBeNull();

    // Non-countdown mission
    hud.render(
      createWorldSnapshot(100),
      { ...createMissionSnapshot(), isCountdown: false, timerSeconds: 12 },
      DEFAULT_AUDIO,
      'chase',
    );
    expect(timerEl?.dataset.countdown).toBe('false');
    expect(timerEl?.dataset.urgent).toBe('false');

    // Countdown with > 20s remaining -> not urgent
    hud.render(
      createWorldSnapshot(100),
      { ...createMissionSnapshot(), isCountdown: true, timerSeconds: 45 },
      DEFAULT_AUDIO,
      'chase',
    );
    expect(timerEl?.dataset.countdown).toBe('true');
    expect(timerEl?.dataset.urgent).toBe('false');

    // Countdown with <= 20s remaining -> urgent
    hud.render(
      createWorldSnapshot(100),
      { ...createMissionSnapshot(), isCountdown: true, timerSeconds: 18 },
      DEFAULT_AUDIO,
      'chase',
    );
    expect(timerEl?.dataset.countdown).toBe('true');
    expect(timerEl?.dataset.urgent).toBe('true');

    // Time-up failure modal displays ¡Se acabó el tiempo!
    hud.render(
      createWorldSnapshot(100),
      {
        ...createMissionSnapshot(),
        mode: 'busted',
        isCountdown: true,
        timerSeconds: 0,
        failureReason: 'time_up',
      },
      DEFAULT_AUDIO,
      'chase',
    );
    expect(bustedOverlay?.hidden).toBe(false);
    expect(
      bustedOverlay?.findFirst((el) => el.textContent === LOCALE_CALI.overlays.timeUp.title),
    ).not.toBeNull();
    expect(
      bustedOverlay?.findFirst((el) => el.textContent === LOCALE_CALI.overlays.timeUp.subtitle),
    ).not.toBeNull();
    expect(retryBtn?.textContent).toBe(LOCALE_CALI.overlays.timeUp.retry);

    // Police busted failure modal displays ¡Te agarró la tomba!
    hud.render(
      createWorldSnapshot(100),
      {
        ...createMissionSnapshot(),
        mode: 'busted',
        failureReason: 'busted',
      },
      DEFAULT_AUDIO,
      'chase',
    );
    expect(
      bustedOverlay?.findFirst((el) => el.textContent === LOCALE_CALI.overlays.busted.title),
    ).not.toBeNull();
    expect(
      bustedOverlay?.findFirst((el) => el.textContent === LOCALE_CALI.overlays.busted.subtitle),
    ).not.toBeNull();
    expect(retryBtn?.textContent).toBe(LOCALE_CALI.overlays.busted.retry);

    hud.dispose();
  });
});

describe('MinimapRenderer', () => {
  it('renders zoomed player-centered road GPS polyline, 2-letter landmark badges, pedestrians, and off-radar beacon', () => {
    const lineCalls: Array<{ x: number; y: number }> = [];
    const textCalls: string[] = [];
    const arcCalls: Array<{ x: number; y: number; r: number }> = [];

    const ctxStub = {
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      lineCap: 'butt',
      lineJoin: 'miter',
      font: '',
      textAlign: 'start',
      textBaseline: 'alphabetic',
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      fillRect: vi.fn(),
      strokeRect: vi.fn(),
      beginPath: vi.fn(),
      closePath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn((x: number, y: number) => {
        lineCalls.push({ x, y });
      }),
      arc: vi.fn((x: number, y: number, r: number) => {
        arcCalls.push({ x, y, r });
      }),
      fill: vi.fn(),
      stroke: vi.fn(),
      setLineDash: vi.fn(),
      fillText: vi.fn((text: string) => {
        textCalls.push(text);
      }),
    };

    const canvasStub = {
      width: 180,
      height: 132,
      getContext: () => ctxStub,
    } as unknown as HTMLCanvasElement;

    const renderer = new MinimapRenderer(canvasStub, CALI_MAP);
    const baseWorld = createWorldSnapshot(100);
    const world: WorldSnapshot = {
      ...baseWorld,
      player: { ...baseWorld.player, x: -90, z: 36, heading: Math.PI / 2 },
      pedestrians: [
        {
          id: 'ped_1',
          x: -80,
          y: 0,
          z: 30,
          heading: 0,
          speedMps: 1.5,
          fleeing: false,
          shirtColorHex: 0xff2e93,
          pantsColorHex: 0x1d0e3d,
        },
      ],
      wantedStars: 2,
    };

    const mission: MissionSnapshot = {
      ...createMissionSnapshot(),
      activeObjective: {
        ...createMissionSnapshot().activeObjective!,
        target: { x: 132, z: 126 }, // Far east -> outside zoomed radar frame!
        gpsRoute: [
          { x: -90, z: 36 },
          { x: -68, z: 36 },
          { x: -68, z: 77 },
          { x: 132, z: 77 },
          { x: 132, z: 126 },
        ],
      },
    };

    renderer.render(world, mission);

    // San Antonio ('SA') is right next to player (-96, 32) and must be badged
    expect(textCalls).toContain('SA');
    // Multi-point GPS polyline + edge beacon + roads drawn
    expect(lineCalls.length).toBeGreaterThan(20);
    // Pedestrians and landmarks rendered as arcs
    expect(arcCalls.length).toBeGreaterThan(3);
  });
});
