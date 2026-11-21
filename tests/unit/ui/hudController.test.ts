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
  HudController,
  type HudCallbacks,
} from '../../../src/ui/hudController';

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

  public addEventListener(_type: string, _listener: EventListener): void {
    // No-op in headless unit tests
  }

  public removeEventListener(_type: string, _listener: EventListener): void {
    // No-op in headless unit tests
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
});
