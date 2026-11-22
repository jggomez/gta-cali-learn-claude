import { describe, expect, it, vi } from 'vitest';
import {
  AudioEngine,
  computeEngineTelemetry,
  computeNearestPoliceSiren,
  type AudioBufferLike,
  type AudioBufferSourceNodeLike,
  type AudioContextLike,
  type AudioNodeLike,
  type AudioParamLike,
  type BiquadFilterNodeLike,
  type GainNodeLike,
  type OscillatorNodeLike,
} from '../../../src/audio/audioEngine';
import { LOCALE_CALI } from '../../../src/config/localeCali';
import type {
  PedestrianSnapshot,
  PlayerMode,
  VehicleKind,
  VehicleSnapshot,
  WantedLevel,
  WorldSnapshot,
} from '../../../src/types/game';

interface CreatedOscillatorRecord {
  node: MockOscillatorNode;
  startedAt: number | null;
  stoppedAt: number | null;
}

class MockAudioParam implements AudioParamLike {
  public value = 0;
  public readonly setCalls: Array<{ value: number; time: number }> = [];
  public readonly expRampCalls: Array<{ value: number; time: number }> = [];
  public readonly linRampCalls: Array<{ value: number; time: number }> = [];

  public setValueAtTime(value: number, startTime: number): this {
    this.value = value;
    this.setCalls.push({ value, time: startTime });
    return this;
  }

  public exponentialRampToValueAtTime(value: number, endTime: number): this {
    this.value = value;
    this.expRampCalls.push({ value, time: endTime });
    return this;
  }

  public linearRampToValueAtTime(value: number, endTime: number): this {
    this.value = value;
    this.linRampCalls.push({ value, time: endTime });
    return this;
  }
}

class MockGainNode implements GainNodeLike {
  public readonly gain = new MockAudioParam();
  public readonly connections: AudioNodeLike[] = [];
  public disconnected = false;

  public connect(destination: AudioNodeLike): AudioNodeLike {
    this.connections.push(destination);
    return destination;
  }

  public disconnect(): void {
    this.disconnected = true;
  }
}

class MockOscillatorNode implements OscillatorNodeLike {
  public type: OscillatorType = 'sine';
  public readonly frequency = new MockAudioParam();
  public readonly connections: AudioNodeLike[] = [];
  public startedAt: number | null = null;
  public stoppedAt: number | null = null;
  public disconnected = false;

  public connect(destination: AudioNodeLike): AudioNodeLike {
    this.connections.push(destination);
    return destination;
  }

  public disconnect(): void {
    this.disconnected = true;
  }

  public start(when = 0): void {
    this.startedAt = when;
  }

  public stop(when = 0): void {
    this.stoppedAt = when;
  }
}

class MockBiquadFilterNode implements BiquadFilterNodeLike {
  public type: BiquadFilterType = 'lowpass';
  public readonly frequency = new MockAudioParam();
  public readonly Q = new MockAudioParam();
  public readonly connections: AudioNodeLike[] = [];
  public disconnected = false;

  public connect(destination: AudioNodeLike): AudioNodeLike {
    this.connections.push(destination);
    return destination;
  }

  public disconnect(): void {
    this.disconnected = true;
  }
}

class MockAudioBuffer implements AudioBufferLike {
  public readonly length: number;
  public readonly sampleRate: number;
  private readonly channels: Float32Array[];

  public constructor(channelCount: number, length: number, sampleRate: number) {
    this.length = length;
    this.sampleRate = sampleRate;
    this.channels = Array.from({ length: channelCount }, () => new Float32Array(length));
  }

  public getChannelData(channel: number): Float32Array {
    return this.channels[channel] ?? new Float32Array(this.length);
  }
}

class MockAudioBufferSourceNode implements AudioBufferSourceNodeLike {
  public buffer: AudioBufferLike | null = null;
  public loop = false;
  public readonly connections: AudioNodeLike[] = [];
  public startedAt: number | null = null;
  public stoppedAt: number | null = null;
  public disconnected = false;

  public connect(destination: AudioNodeLike): AudioNodeLike {
    this.connections.push(destination);
    return destination;
  }

  public disconnect(): void {
    this.disconnected = true;
  }

  public start(when = 0): void {
    this.startedAt = when;
  }

  public stop(when = 0): void {
    this.stoppedAt = when;
  }
}

/** Minimal AudioContext mock (without optional filter/buffer APIs) to guarantee backwards compatibility. */
class MockAudioContext implements AudioContextLike {
  public currentTime = 1.0;
  public state: AudioContextState = 'suspended';
  public readonly destination: AudioNodeLike = {
    connect: (dest) => dest,
  };
  public readonly oscillators: CreatedOscillatorRecord[] = [];
  public readonly gains: MockGainNode[] = [];
  public readonly resume = vi.fn(async () => {
    this.state = 'running';
  });
  public readonly close = vi.fn(async () => {
    this.state = 'closed';
  });

  public createOscillator(): OscillatorNodeLike {
    const node = new MockOscillatorNode();
    const record: CreatedOscillatorRecord = {
      node,
      startedAt: null,
      stoppedAt: null,
    };
    const origStart = node.start.bind(node);
    const origStop = node.stop.bind(node);
    node.start = (when = 0) => {
      origStart(when);
      record.startedAt = when;
    };
    node.stop = (when = 0) => {
      origStop(when);
      record.stoppedAt = when;
    };
    this.oscillators.push(record);
    return node;
  }

  public createGain(): GainNodeLike {
    const gain = new MockGainNode();
    this.gains.push(gain);
    return gain;
  }
}

/** Full Web Audio mock implementing optional BiquadFilter and Noise Buffer APIs. */
class FullMockAudioContext extends MockAudioContext {
  public readonly sampleRate = 44100;
  public readonly filters: MockBiquadFilterNode[] = [];
  public readonly buffers: MockAudioBuffer[] = [];
  public readonly bufferSources: MockAudioBufferSourceNode[] = [];

  public createBiquadFilter(): BiquadFilterNodeLike {
    const filter = new MockBiquadFilterNode();
    this.filters.push(filter);
    return filter;
  }

  public createBuffer(channels: number, length: number, sampleRate: number): AudioBufferLike {
    const buffer = new MockAudioBuffer(channels, length, sampleRate);
    this.buffers.push(buffer);
    return buffer;
  }

  public createBufferSource(): AudioBufferSourceNodeLike {
    const source = new MockAudioBufferSourceNode();
    this.bufferSources.push(source);
    return source;
  }
}

function makeVehicle(overrides: Partial<VehicleSnapshot> = {}): VehicleSnapshot {
  const speedKmh = overrides.speedKmh ?? 0;
  return {
    id: overrides.id ?? 'player_banshee',
    kind: overrides.kind ?? 'banshee',
    role: overrides.role ?? 'player',
    x: overrides.x ?? 0,
    y: overrides.y ?? 0,
    z: overrides.z ?? 0,
    heading: overrides.heading ?? 0,
    speedMps: overrides.speedMps ?? speedKmh / 3.6,
    speedKmh,
    steerAngle: overrides.steerAngle ?? 0,
    isDrifting: overrides.isDrifting ?? false,
    isBoosting: overrides.isBoosting ?? false,
    nitro: overrides.nitro ?? 100,
    sirenActive: overrides.sirenActive ?? false,
    colorHex: overrides.colorHex ?? 0xff2e93,
    halfWidth: overrides.halfWidth ?? 1.0,
    halfLength: overrides.halfLength ?? 2.3,
  };
}

function makePedestrian(id: string, x: number, z: number): PedestrianSnapshot {
  return {
    id,
    x,
    y: 0,
    z,
    heading: 0,
    speedMps: 1.5,
    fleeing: false,
    shirtColorHex: 0xffffff,
    pantsColorHex: 0x222222,
  };
}

function makeWorld(opts?: {
  mode?: PlayerMode;
  speedKmh?: number;
  heading?: number;
  x?: number;
  z?: number;
  wantedStars?: WantedLevel;
  isDrifting?: boolean;
  isBoosting?: boolean;
  vehicleKind?: VehicleKind;
  vehicles?: readonly VehicleSnapshot[];
  pedestrians?: readonly PedestrianSnapshot[];
}): WorldSnapshot {
  const mode = opts?.mode ?? 'on_foot';
  const speedKmh = opts?.speedKmh ?? 0;
  const wantedStars = opts?.wantedStars ?? 0;
  const vehicleId = mode === 'driving' ? 'player_vehicle' : null;

  let vehicles: readonly VehicleSnapshot[];
  if (opts?.vehicles) {
    vehicles = opts.vehicles;
  } else {
    const list: VehicleSnapshot[] = [];
    if (mode === 'driving') {
      list.push(
        makeVehicle({
          id: 'player_vehicle',
          kind: opts?.vehicleKind ?? 'banshee',
          role: 'player',
          x: opts?.x ?? 0,
          z: opts?.z ?? 0,
          speedKmh,
          isDrifting: opts?.isDrifting ?? false,
          isBoosting: opts?.isBoosting ?? false,
        }),
      );
    }
    if (wantedStars > 0) {
      list.push(
        makeVehicle({
          id: 'police_1',
          kind: 'police',
          role: 'police',
          x: 0,
          z: 20,
          heading: Math.PI,
          speedKmh: 72,
          speedMps: 20,
          sirenActive: true,
        }),
      );
    }
    vehicles = list;
  }

  return {
    timeSeconds: 0,
    player: {
      mode,
      x: opts?.x ?? 0,
      y: 0,
      z: opts?.z ?? 0,
      heading: opts?.heading ?? 0,
      speedMps: speedKmh / 3.6,
      speedKmh,
      vehicleId,
      nearbyVehicleId: null,
      canEnterVehicle: false,
      nitro: 100,
      isDrifting: opts?.isDrifting ?? false,
      isBoosting: opts?.isBoosting ?? false,
      isSprinting: false,
      inRiverHazard: false,
    },
    vehicles,
    pedestrians: opts?.pedestrians ?? [],
    wantedStars,
    bustProgress: 0,
    isBusted: false,
    driftScore: 0,
    topSpeedKmh: speedKmh,
    currentDistrict: 'Bulevar del Río',
    collisionImpact: 0,
  };
}

describe('computeEngineTelemetry', () => {
  it('computes 5-speed gears 1..5 with smooth rpmNorm in [0.18, 1.0] and upshift RPM drop', () => {
    const idle = computeEngineTelemetry(0, 'banshee');
    expect(idle.gear).toBe(1);
    expect(idle.rpmNorm).toBeCloseTo(0.18, 2);

    const highGear1 = computeEngineTelemetry(40, 'banshee');
    const lowGear2 = computeEngineTelemetry(46, 'banshee');
    expect(highGear1.gear).toBe(1);
    expect(lowGear2.gear).toBe(2);
    expect(highGear1.rpmNorm).toBeGreaterThan(lowGear2.rpmNorm);

    const gear3 = computeEngineTelemetry(100, 'banshee');
    const gear4 = computeEngineTelemetry(150, 'banshee');
    const gear5 = computeEngineTelemetry(215, 'banshee');
    expect(gear3.gear).toBe(3);
    expect(gear4.gear).toBe(4);
    expect(gear5.gear).toBe(5);

    for (const speed of [-10, Number.NaN, 0, 20, 60, 110, 160, 240, 320]) {
      const sample = computeEngineTelemetry(speed, 'banshee');
      expect(sample.gear).toBeGreaterThanOrEqual(1);
      expect(sample.gear).toBeLessThanOrEqual(5);
      expect(sample.rpmNorm).toBeGreaterThanOrEqual(0.18);
      expect(sample.rpmNorm).toBeLessThanOrEqual(1.0);
      expect(sample.fundamentalHz).toBeGreaterThan(20);
    }
  });

  it('produces higher-revving V8 curves for banshee/police/taxi than deeper diesel curves for mio_bus/chiva', () => {
    const banshee = computeEngineTelemetry(80, 'banshee');
    const police = computeEngineTelemetry(80, 'police');
    const taxi = computeEngineTelemetry(80, 'taxi');
    const mioBus = computeEngineTelemetry(80, 'mio_bus');
    const chiva = computeEngineTelemetry(80, 'chiva');

    expect(banshee.fundamentalHz).toBeGreaterThan(mioBus.fundamentalHz * 1.5);
    expect(banshee.fundamentalHz).toBeGreaterThan(chiva.fundamentalHz * 1.5);
    expect(police.fundamentalHz).toBeGreaterThan(mioBus.fundamentalHz);
    expect(taxi.fundamentalHz).toBeGreaterThan(chiva.fundamentalHz);

    // Idle fundamental is also deeper for diesel vehicles
    expect(computeEngineTelemetry(0, 'banshee').fundamentalHz).toBeGreaterThan(
      computeEngineTelemetry(0, 'mio_bus').fundamentalHz,
    );
    expect(computeEngineTelemetry(0, 'banshee').fundamentalHz).toBeGreaterThan(
      computeEngineTelemetry(0, 'chiva').fundamentalHz,
    );
  });
});

describe('computeNearestPoliceSiren', () => {
  it('is inactive when wantedStars is 0 or no police vehicle has sirenActive', () => {
    const zeroStars = computeNearestPoliceSiren(
      makeWorld({
        wantedStars: 0,
        vehicles: [
          makeVehicle({ id: 'p1', kind: 'police', role: 'police', x: 0, z: 10, sirenActive: true }),
        ],
      }),
    );
    expect(zeroStars.active).toBe(false);
    expect(zeroStars.attenuation).toBe(0);

    const inactiveSiren = computeNearestPoliceSiren(
      makeWorld({
        wantedStars: 2,
        vehicles: [
          makeVehicle({ id: 'p1', kind: 'police', role: 'police', x: 0, z: 10, sirenActive: false }),
        ],
      }),
    );
    expect(inactiveSiren.active).toBe(false);
  });

  it('selects nearest active police car, applies distance attenuation, Wail vs Yelp threshold, and Doppler', () => {
    // Far police at 52m (wail), near police at 15m (yelp) closing in toward player
    const nearClosing = computeNearestPoliceSiren(
      makeWorld({
        wantedStars: 2,
        x: 0,
        z: 0,
        speedKmh: 0,
        vehicles: [
          makeVehicle({
            id: 'p_far',
            kind: 'police',
            role: 'police',
            x: 0,
            z: 52,
            heading: Math.PI,
            speedMps: 15,
            sirenActive: true,
          }),
          makeVehicle({
            id: 'p_near',
            kind: 'police',
            role: 'police',
            x: 0,
            z: 15,
            heading: Math.PI,
            speedMps: 20,
            sirenActive: true,
          }),
        ],
      }),
    );
    expect(nearClosing.active).toBe(true);
    expect(nearClosing.distanceMeters).toBeCloseTo(15, 3);
    expect(nearClosing.mode).toBe('yelp');
    expect(nearClosing.attenuation).toBeCloseTo(1 / (1 + 15 / 26), 4);
    expect(nearClosing.dopplerRatio).toBeGreaterThan(1.0);
    expect(nearClosing.dopplerRatio).toBeLessThanOrEqual(1.06);

    // Far police at 40m receding away from player -> wail + Doppler < 1.0
    const farReceding = computeNearestPoliceSiren(
      makeWorld({
        wantedStars: 1,
        x: 0,
        z: 0,
        speedKmh: 0,
        vehicles: [
          makeVehicle({
            id: 'p_far',
            kind: 'police',
            role: 'police',
            x: 0,
            z: 40,
            heading: 0,
            speedMps: 25,
            sirenActive: true,
          }),
        ],
      }),
    );
    expect(farReceding.active).toBe(true);
    expect(farReceding.distanceMeters).toBeCloseTo(40, 3);
    expect(farReceding.mode).toBe('wail');
    expect(farReceding.attenuation).toBeCloseTo(1 / (1 + 40 / 26), 4);
    expect(farReceding.dopplerRatio).toBeLessThan(1.0);
    expect(farReceding.dopplerRatio).toBeGreaterThanOrEqual(0.94);
  });
});

describe('AudioEngine', () => {
  it('cycles radio stations, handles mute/unmute, and manages voicesEnabled state', () => {
    const engine = new AudioEngine({ contextFactory: () => null });

    expect(engine.getState().station).toBe('salsa_brava');
    expect(engine.getState().stationLabel).toBe(LOCALE_CALI.radio.salsa_brava);
    expect(engine.getState().muted).toBe(false);
    expect(engine.getState().voicesEnabled).toBe(true);
    expect(engine.getState().unlocked).toBe(false);

    expect(engine.cycleStation().station).toBe('sucursal_synth');
    expect(engine.getState().stationLabel).toBe(LOCALE_CALI.radio.sucursal_synth);

    expect(engine.cycleStation().station).toBe('off');
    expect(engine.getState().stationLabel).toBe(LOCALE_CALI.radio.off);

    expect(engine.cycleStation().station).toBe('salsa_brava');

    expect(engine.toggleMute().muted).toBe(true);
    expect(engine.toggleMute().muted).toBe(false);
    expect(engine.setStation('sucursal_synth').station).toBe('sucursal_synth');

    engine.setVoicesEnabled(false);
    expect(engine.getState().voicesEnabled).toBe(false);
    expect(engine.toggleVoices()).toBe(true);
    expect(engine.getState().voicesEnabled).toBe(true);

    const customInitial = new AudioEngine({
      contextFactory: () => null,
      initialVoicesEnabled: false,
    });
    expect(customInitial.getState().voicesEnabled).toBe(false);
  });

  it('operates as a safe no-op when AudioContext is unavailable', () => {
    const engine = new AudioEngine({ contextFactory: () => null });

    expect(() => {
      const state = engine.unlock();
      expect(state.unlocked).toBe(false);
      engine.update(makeWorld({ mode: 'driving', speedKmh: 95, wantedStars: 2 }), 0.05);
      engine.playSfx('checkpoint');
      engine.playSfx('mission_passed');
      engine.playSfx('busted');
      engine.playSfx('enter_car');
      engine.playSfx('nitro');
      engine.playCollision(0.8);
      engine.playRadioSquelch();
      engine.toggleMute();
      engine.toggleVoices();
      engine.dispose();
    }).not.toThrow();
  });

  it('unlocks mock AudioContext and schedules Salsa Brava and Sucursal Synth steps', () => {
    const mockCtx = new MockAudioContext();
    const engine = new AudioEngine({
      station: 'salsa_brava',
      contextFactory: () => mockCtx,
    });

    const state = engine.unlock();
    expect(state.unlocked).toBe(true);
    expect(mockCtx.resume).toHaveBeenCalledTimes(1);
    expect(mockCtx.gains.length).toBeGreaterThanOrEqual(1);

    // Advance enough frames to trigger multiple Salsa Brava 16th-note steps (clave + montuno + bass)
    for (let i = 0; i < 10; i++) {
      mockCtx.currentTime += 0.05;
      engine.update(makeWorld({ mode: 'on_foot' }), 0.05);
    }

    const salsaOscCount = mockCtx.oscillators.length;
    expect(salsaOscCount).toBeGreaterThan(3);
    expect(mockCtx.oscillators.every((osc) => osc.startedAt !== null)).toBe(true);

    // Switch to Sucursal Synth and verify synth oscillators get scheduled
    engine.setStation('sucursal_synth');
    for (let i = 0; i < 10; i++) {
      mockCtx.currentTime += 0.05;
      engine.update(makeWorld({ mode: 'on_foot' }), 0.05);
    }

    const synthOscCount = mockCtx.oscillators.length - salsaOscCount;
    expect(synthOscCount).toBeGreaterThan(3);

    // Switch to off: no more radio oscillators when on foot with 0 wanted stars
    engine.setStation('off');
    const beforeOffCount = mockCtx.oscillators.length;
    for (let i = 0; i < 8; i++) {
      mockCtx.currentTime += 0.05;
      engine.update(makeWorld({ mode: 'on_foot', wantedStars: 0 }), 0.05);
    }
    expect(mockCtx.oscillators.length).toBe(beforeOffCount);
  });

  it('schedules multi-harmonic engine hum, continuous police siren, and all 5 SFX kinds on minimal mocks', () => {
    const mockCtx = new MockAudioContext();
    const engine = new AudioEngine({
      station: 'off',
      contextFactory: () => mockCtx,
    });
    engine.unlock();

    // Driving creates primary + sub continuous engine oscillators and modulates frequency
    engine.update(makeWorld({ mode: 'driving', speedKmh: 120, wantedStars: 0 }), 0.05);
    expect(mockCtx.oscillators.length).toBeGreaterThanOrEqual(2);
    const firstOsc = mockCtx.oscillators[0];
    expect(firstOsc).toBeDefined();
    expect(firstOsc?.node.frequency.setCalls.length).toBeGreaterThan(0);

    // Active police chase creates and modulates continuous siren oscillator
    const beforeSiren = mockCtx.oscillators.length;
    for (let i = 0; i < 12; i++) {
      mockCtx.currentTime += 0.05;
      engine.update(makeWorld({ mode: 'driving', speedKmh: 90, wantedStars: 2 }), 0.05);
    }
    expect(mockCtx.oscillators.length).toBeGreaterThan(beforeSiren);
    const sirenOsc = mockCtx.oscillators[beforeSiren];
    expect(sirenOsc?.node.frequency.setCalls.length).toBeGreaterThan(5);

    // All 5 SFX kinds schedule oscillators cleanly (enter_car now includes door slam + V8 starter flare)
    const sfxKinds = ['checkpoint', 'mission_passed', 'busted', 'enter_car', 'nitro'] as const;
    for (const kind of sfxKinds) {
      const before = mockCtx.oscillators.length;
      engine.playSfx(kind);
      expect(mockCtx.oscillators.length).toBeGreaterThan(before);
    }

    // Muting silences master gain and suppresses new SFX
    engine.setMuted(true);
    expect(mockCtx.gains[0]?.gain.value).toBe(0);
    const beforeMutedSfx = mockCtx.oscillators.length;
    engine.playSfx('checkpoint');
    expect(mockCtx.oscillators.length).toBe(beforeMutedSfx);

    // Dispose closes context and marks engine locked
    engine.dispose();
    expect(mockCtx.close).toHaveBeenCalledTimes(1);
    expect(engine.getState().unlocked).toBe(false);
  });

  it('synthesizes 5-speed filtered engine with gear-shift pops, drift screech, turbo spool, crash foley, squelch, street murmur, and clean dispose', () => {
    const fullCtx = new FullMockAudioContext();
    const engine = new AudioEngine({
      station: 'off',
      contextFactory: () => fullCtx,
    });
    engine.unlock();

    // 1. Engine lowpass filter cutoff opens with rpmNorm (320..2600 Hz) and gear change triggers exhaust pop
    engine.update(makeWorld({ mode: 'driving', speedKmh: 15, vehicleKind: 'banshee' }), 0.05);
    const engineFilter = fullCtx.filters.find((f) => f.type === 'lowpass');
    expect(engineFilter).toBeDefined();
    const lowRpmCutoff = engineFilter?.frequency.value ?? 0;
    expect(lowRpmCutoff).toBeGreaterThanOrEqual(320);
    expect(lowRpmCutoff).toBeLessThanOrEqual(2600);

    fullCtx.currentTime += 0.05;
    engine.update(makeWorld({ mode: 'driving', speedKmh: 41, vehicleKind: 'banshee' }), 0.05);
    const highRpmCutoff = engineFilter?.frequency.value ?? 0;
    expect(highRpmCutoff).toBeGreaterThan(lowRpmCutoff);
    expect(highRpmCutoff).toBeLessThanOrEqual(2600);

    // Shift from Gear 1 (41 km/h) -> Gear 2 (50 km/h) triggers exhaust pop burst
    const sourcesBeforeShift = fullCtx.bufferSources.length;
    const oscBeforeShift = fullCtx.oscillators.length;
    fullCtx.currentTime += 0.05;
    engine.update(makeWorld({ mode: 'driving', speedKmh: 50, vehicleKind: 'banshee' }), 0.05);
    expect(fullCtx.bufferSources.length).toBeGreaterThan(sourcesBeforeShift);
    expect(fullCtx.oscillators.length).toBeGreaterThan(oscBeforeShift);

    // 2. Tire drift screech (bandpass ~1250 Hz, Q=4.5) gates smoothly when drifting > 18 km/h
    const oscCountBeforeBoost = fullCtx.oscillators.length;
    fullCtx.currentTime += 0.05;
    engine.update(
      makeWorld({ mode: 'driving', speedKmh: 65, isDrifting: true, isBoosting: true }),
      0.05,
    );
    const driftFilter = fullCtx.filters.find(
      (f) => f.type === 'bandpass' && f.Q.value >= 4.0,
    );
    expect(driftFilter).toBeDefined();
    expect(driftFilter?.frequency.value).toBeGreaterThanOrEqual(1100);
    expect(driftFilter?.frequency.value).toBeLessThanOrEqual(1450);
    expect(driftFilter?.Q.value).toBeCloseTo(4.5, 1);
    const driftGain = driftFilter?.connections[0] as MockGainNode | undefined;
    expect(driftGain?.gain.value).toBeGreaterThan(0.005);

    // Turbo spool oscillator created & rising while boosting
    const turboOsc = fullCtx.oscillators[oscCountBeforeBoost]?.node;
    expect(turboOsc).toBeDefined();
    const turboFreqWhileBoosting = turboOsc?.frequency.value ?? 0;
    expect(turboFreqWhileBoosting).toBeGreaterThan(1200);

    // Drift screech silences and turbo spool decays when no longer drifting/boosting
    for (let i = 0; i < 12; i++) {
      fullCtx.currentTime += 0.05;
      engine.update(
        makeWorld({ mode: 'driving', speedKmh: 15, isDrifting: true, isBoosting: false }),
        0.05,
      );
    }
    expect(driftGain?.gain.value ?? 1).toBeLessThan(0.002);
    expect(turboOsc?.frequency.value ?? 9999).toBeLessThan(turboFreqWhileBoosting);

    // Exiting car / pausing (dt=0, mode=on_foot) silences active drift & turbo immediately
    fullCtx.currentTime += 0.05;
    engine.update(
      makeWorld({ mode: 'driving', speedKmh: 85, isDrifting: true, isBoosting: true }),
      0.05,
    );
    expect(driftGain?.gain.value ?? 0).toBeGreaterThan(0.005);
    engine.update(makeWorld({ mode: 'on_foot' }), 0);
    expect(driftGain?.gain.value ?? 1).toBeLessThanOrEqual(0.0001);
    const turboGain = turboOsc?.connections[0] as MockGainNode | undefined;
    expect(turboGain?.gain.value ?? 1).toBeLessThanOrEqual(0.0001);

    // 3. Collision impact foley: clamps 0..1, 160ms cooldown, 110Hz->38Hz thump + metallic crunch noise
    const oscBeforeCrash = fullCtx.oscillators.length;
    const srcBeforeCrash = fullCtx.bufferSources.length;
    engine.playCollision(1.8);
    expect(fullCtx.oscillators.length).toBeGreaterThan(oscBeforeCrash);
    expect(fullCtx.bufferSources.length).toBeGreaterThan(srcBeforeCrash);
    const thumpOsc = fullCtx.oscillators[oscBeforeCrash]?.node;
    expect(thumpOsc?.frequency.setCalls[0]?.value).toBeCloseTo(110, 0);
    expect(thumpOsc?.frequency.linRampCalls[0]?.value).toBeCloseTo(38, 0);

    // Blocked within 160ms cooldown
    const oscAfterFirstCrash = fullCtx.oscillators.length;
    fullCtx.currentTime += 0.1;
    engine.playCollision(0.9);
    expect(fullCtx.oscillators.length).toBe(oscAfterFirstCrash);

    // Allowed after 160ms cooldown
    fullCtx.currentTime += 0.1;
    engine.playCollision(0.5);
    expect(fullCtx.oscillators.length).toBeGreaterThan(oscAfterFirstCrash);

    // Zero or negative intensity ignored
    const oscAfterSecondCrash = fullCtx.oscillators.length;
    fullCtx.currentTime += 0.5;
    engine.playCollision(0);
    expect(fullCtx.oscillators.length).toBe(oscAfterSecondCrash);

    // 4. Police radio squelch: filtered static burst + crisp 1800 Hz roger chirp
    const oscBeforeSquelch = fullCtx.oscillators.length;
    const srcBeforeSquelch = fullCtx.bufferSources.length;
    engine.playRadioSquelch();
    expect(fullCtx.bufferSources.length).toBeGreaterThan(srcBeforeSquelch);
    const chirpOsc = fullCtx.oscillators[oscBeforeSquelch]?.node;
    expect(chirpOsc?.frequency.setCalls[0]?.value).toBeCloseTo(1800, 0);

    // 5. Cali street crowd murmur: warm bandpass ~420 Hz scaled by pedestrians within 45m (<= 0.026)
    fullCtx.currentTime += 0.05;
    engine.update(
      makeWorld({
        mode: 'on_foot',
        x: 0,
        z: 0,
        pedestrians: [
          makePedestrian('ped_1', 10, 0),
          makePedestrian('ped_2', 0, 20),
          makePedestrian('ped_3', 15, 15),
          makePedestrian('ped_far', 100, 100),
        ],
      }),
      0.05,
    );
    const crowdFilter = fullCtx.filters.find(
      (f) => f.type === 'bandpass' && f.frequency.value >= 380 && f.frequency.value <= 460,
    );
    expect(crowdFilter).toBeDefined();
    const crowdGain = crowdFilter?.connections[0] as MockGainNode | undefined;
    expect(crowdGain).toBeDefined();
    expect(crowdGain?.gain.value).toBeGreaterThan(0);
    expect(crowdGain?.gain.value).toBeLessThanOrEqual(0.026);

    // Zero gain when muted
    engine.setMuted(true);
    expect(crowdGain?.gain.value).toBe(0);
    engine.setMuted(false);

    // Zero gain when no pedestrians are within 45m
    fullCtx.currentTime += 0.05;
    engine.update(
      makeWorld({
        mode: 'on_foot',
        x: 0,
        z: 0,
        pedestrians: [makePedestrian('ped_far', 90, 90)],
      }),
      0.05,
    );
    expect(crowdGain?.gain.value).toBe(0);

    // 6. Active police siren modulates continuously (Wail far vs Yelp close) & dispose cleans all persistent nodes
    const filtersBeforeSiren = fullCtx.filters.length;
    const oscBeforeSiren = fullCtx.oscillators.length;
    fullCtx.currentTime += 0.05;
    engine.update(
      makeWorld({
        mode: 'driving',
        speedKmh: 85,
        wantedStars: 2,
        vehicles: [
          makeVehicle({ id: 'player_vehicle', kind: 'banshee', role: 'player', speedKmh: 85 }),
          makeVehicle({
            id: 'police_far',
            kind: 'police',
            role: 'police',
            x: 0,
            z: 60,
            heading: Math.PI,
            speedMps: 18,
            sirenActive: true,
          }),
        ],
      }),
      0.05,
    );
    const sirenFilter = fullCtx.filters[filtersBeforeSiren];
    const sirenOsc = fullCtx.oscillators[oscBeforeSiren]?.node;
    const sirenGain = sirenFilter?.connections[0] as MockGainNode | undefined;
    expect(sirenFilter?.type).toBe('lowpass');
    expect(sirenOsc).toBeDefined();
    const farGain = sirenGain?.gain.value ?? 0;

    fullCtx.currentTime += 0.05;
    engine.update(
      makeWorld({
        mode: 'driving',
        speedKmh: 85,
        wantedStars: 2,
        vehicles: [
          makeVehicle({ id: 'player_vehicle', kind: 'banshee', role: 'player', speedKmh: 85 }),
          makeVehicle({
            id: 'police_close',
            kind: 'police',
            role: 'police',
            x: 0,
            z: 12,
            heading: Math.PI,
            speedMps: 18,
            sirenActive: true,
          }),
        ],
      }),
      0.05,
    );
    const closeGain = sirenGain?.gain.value ?? 0;
    expect(closeGain).toBeGreaterThan(farGain);

    engine.dispose();
    expect(fullCtx.close).toHaveBeenCalledTimes(1);
    const loopedSources = fullCtx.bufferSources.filter((src) => src.loop);
    expect(loopedSources.length).toBeGreaterThanOrEqual(2);
    expect(loopedSources.every((src) => src.stoppedAt !== null && src.disconnected)).toBe(true);
    expect(engineFilter?.disconnected).toBe(true);
    expect(driftFilter?.disconnected).toBe(true);
    expect(crowdFilter?.disconnected).toBe(true);
    expect(sirenFilter?.disconnected).toBe(true);
    expect(sirenOsc?.stoppedAt).not.toBeNull();
    expect(turboOsc?.stoppedAt).not.toBeNull();
  });
});
