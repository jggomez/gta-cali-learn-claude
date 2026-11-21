import { describe, expect, it, vi } from 'vitest';
import {
  AudioEngine,
  type AudioContextLike,
  type AudioNodeLike,
  type AudioParamLike,
  type GainNodeLike,
  type OscillatorNodeLike,
} from '../../../src/audio/audioEngine';
import { LOCALE_CALI } from '../../../src/config/localeCali';
import type { PlayerMode, WantedLevel, WorldSnapshot } from '../../../src/types/game';

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

  public connect(destination: AudioNodeLike): AudioNodeLike {
    this.connections.push(destination);
    return destination;
  }

  public start(when = 0): void {
    this.startedAt = when;
  }

  public stop(when = 0): void {
    this.stoppedAt = when;
  }
}

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

function makeWorld(opts?: {
  mode?: PlayerMode;
  speedKmh?: number;
  wantedStars?: WantedLevel;
}): WorldSnapshot {
  const mode = opts?.mode ?? 'on_foot';
  const speedKmh = opts?.speedKmh ?? 0;

  return {
    timeSeconds: 0,
    player: {
      mode,
      x: 0,
      y: 0,
      z: 0,
      heading: 0,
      speedMps: speedKmh / 3.6,
      speedKmh,
      vehicleId: mode === 'driving' ? 'player_banshee' : null,
      nearbyVehicleId: null,
      canEnterVehicle: false,
      nitro: 1,
      isDrifting: false,
      isBoosting: false,
      isSprinting: false,
      inRiverHazard: false,
    },
    vehicles: [],
    wantedStars: opts?.wantedStars ?? 0,
    bustProgress: 0,
    isBusted: false,
    driftScore: 0,
    topSpeedKmh: speedKmh,
    currentDistrict: 'Bulevar del Río',
    collisionImpact: 0,
  };
}

describe('AudioEngine', () => {
  it('cycles radio stations and handles mute/unmute state transitions', () => {
    const engine = new AudioEngine({ contextFactory: () => null });

    expect(engine.getState().station).toBe('salsa_brava');
    expect(engine.getState().stationLabel).toBe(LOCALE_CALI.radio.salsa_brava);
    expect(engine.getState().muted).toBe(false);
    expect(engine.getState().unlocked).toBe(false);

    expect(engine.cycleStation().station).toBe('sucursal_synth');
    expect(engine.getState().stationLabel).toBe(LOCALE_CALI.radio.sucursal_synth);

    expect(engine.cycleStation().station).toBe('off');
    expect(engine.getState().stationLabel).toBe(LOCALE_CALI.radio.off);

    expect(engine.cycleStation().station).toBe('salsa_brava');

    expect(engine.toggleMute().muted).toBe(true);
    expect(engine.toggleMute().muted).toBe(false);
    expect(engine.setStation('sucursal_synth').station).toBe('sucursal_synth');
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
      engine.toggleMute();
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

  it('schedules engine RPM hum, police siren sweeps, and all 5 SFX kinds', () => {
    const mockCtx = new MockAudioContext();
    const engine = new AudioEngine({
      station: 'off',
      contextFactory: () => mockCtx,
    });
    engine.unlock();

    // Driving creates continuous engine oscillator and modulates frequency by speed
    engine.update(makeWorld({ mode: 'driving', speedKmh: 120, wantedStars: 0 }), 0.05);
    expect(mockCtx.oscillators.length).toBe(1);
    const firstOsc = mockCtx.oscillators[0];
    expect(firstOsc).toBeDefined();
    expect(firstOsc?.node.frequency.setCalls.length).toBeGreaterThan(0);

    // Active police chase schedules siren sweeps
    const beforeSiren = mockCtx.oscillators.length;
    for (let i = 0; i < 12; i++) {
      mockCtx.currentTime += 0.05;
      engine.update(makeWorld({ mode: 'driving', speedKmh: 90, wantedStars: 2 }), 0.05);
    }
    expect(mockCtx.oscillators.length).toBeGreaterThan(beforeSiren);

    // All 5 SFX kinds schedule oscillators cleanly
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
});
