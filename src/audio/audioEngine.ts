/**
 * Procedural Web Audio API radio sequencer, multi-harmonic vehicle engine synth,
 * distance/Doppler police siren, ambient street murmur, and sound effects engine for GTA VI: Cali.
 * 100% offline synthesis with injectable AudioContext factory and safe headless no-op behavior.
 */

import { LOCALE_CALI } from '../config/localeCali';
import type {
  AudioState,
  RadioStationId,
  VehicleKind,
  VehicleSnapshot,
  WorldSnapshot,
} from '../types/game';

export interface AudioParamLike {
  value: number;
  setValueAtTime(value: number, startTime: number): unknown;
  exponentialRampToValueAtTime(value: number, endTime: number): unknown;
  linearRampToValueAtTime(value: number, endTime: number): unknown;
}

export interface AudioNodeLike {
  connect(destination: AudioNodeLike): unknown;
  disconnect?(): void;
}

export interface GainNodeLike extends AudioNodeLike {
  readonly gain: AudioParamLike;
}

export interface OscillatorNodeLike extends AudioNodeLike {
  type: OscillatorType;
  readonly frequency: AudioParamLike;
  start(when?: number): void;
  stop(when?: number): void;
}

export interface BiquadFilterNodeLike extends AudioNodeLike {
  type: BiquadFilterType;
  readonly frequency: AudioParamLike;
  readonly Q: AudioParamLike;
}

export interface AudioBufferLike {
  readonly length: number;
  readonly sampleRate: number;
  getChannelData(channel: number): Float32Array;
}

export interface AudioBufferSourceNodeLike extends AudioNodeLike {
  buffer: AudioBufferLike | null;
  loop: boolean;
  start(when?: number): void;
  stop(when?: number): void;
}

export interface AudioContextLike {
  readonly currentTime: number;
  readonly state: string;
  readonly destination: AudioNodeLike;
  readonly sampleRate?: number;
  resume(): Promise<void>;
  close(): Promise<void>;
  createOscillator(): OscillatorNodeLike;
  createGain(): GainNodeLike;
  createBiquadFilter?(): BiquadFilterNodeLike;
  createBuffer?(channels: number, length: number, sampleRate: number): AudioBufferLike;
  createBufferSource?(): AudioBufferSourceNodeLike;
}

export type AudioContextFactory = () => AudioContextLike | null;

export type SfxKind = 'checkpoint' | 'mission_passed' | 'busted' | 'enter_car' | 'nitro';

export interface AudioEngineOptions {
  readonly station?: RadioStationId;
  readonly muted?: boolean;
  readonly initialVoicesEnabled?: boolean;
  readonly contextFactory?: AudioContextFactory;
}

export interface EngineTelemetry {
  readonly gear: number;
  readonly rpmNorm: number;
  readonly fundamentalHz: number;
}

export interface PoliceSirenTelemetry {
  readonly active: boolean;
  readonly distanceMeters: number;
  readonly mode: 'wail' | 'yelp';
  readonly attenuation: number;
  readonly dopplerRatio: number;
}

interface VehicleEngineCurve {
  readonly thresholdsKmh: readonly [number, number, number, number, number, number];
  readonly minHz: number;
  readonly maxHz: number;
}

interface StoppableAudioNode extends AudioNodeLike {
  stop(when?: number): void;
}

const STATION_ORDER: readonly RadioStationId[] = ['salsa_brava', 'sucursal_synth', 'off'];
const DEFAULT_MASTER_VOLUME = 0.55;
const DEFAULT_SAMPLE_RATE = 44100;
const SALSA_STEP_SECONDS = 60 / 116 / 4; // 116 BPM 16th note
const SYNTH_STEP_SECONDS = 60 / 108 / 4; // 108 BPM 16th note
const MAX_STEP_DT = 0.1;

const MIN_RPM_NORM = 0.18;
const MAX_RPM_NORM = 1.0;
const ENGINE_FILTER_MIN_HZ = 320;
const ENGINE_FILTER_MAX_HZ = 2600;
const DRIFT_MIN_SPEED_KMH = 18;
const DRIFT_FILTER_BASE_HZ = 1250;
const DRIFT_FILTER_Q = 4.5;
const COLLISION_COOLDOWN_SECONDS = 0.16;
const SIREN_ATTENUATION_SCALE_METERS = 26;
const SIREN_YELP_THRESHOLD_METERS = 28;
const SIREN_WAIL_RATE_HZ = 0.55;
const SIREN_YELP_RATE_HZ = 2.6;
const SPEED_OF_SOUND_MPS = 343;
const DOPPLER_MIN = 0.94;
const DOPPLER_MAX = 1.06;
const CROWD_MURMUR_RADIUS_METERS = 45;
const CROWD_MURMUR_MAX_GAIN = 0.026;
const CROWD_MURMUR_FILTER_HZ = 420;
const CROWD_MURMUR_SATURATION_PEDS = 8;

const VEHICLE_ENGINE_CURVES: Readonly<Record<VehicleKind, VehicleEngineCurve>> = {
  renault4_turbo: {
    thresholdsKmh: [0, 42, 84, 128, 174, 224],
    minHz: 74,
    maxHz: 285,
  },
  spark_gt_turbo: {
    thresholdsKmh: [0, 40, 80, 122, 166, 214],
    minHz: 78,
    maxHz: 295,
  },
  willys_v8: {
    thresholdsKmh: [0, 38, 76, 118, 160, 206],
    minHz: 52,
    maxHz: 215,
  },
  banshee: {
    thresholdsKmh: [0, 44, 86, 130, 174, 230],
    minHz: 64,
    maxHz: 260,
  },
  police: {
    thresholdsKmh: [0, 38, 74, 112, 150, 198],
    minHz: 58,
    maxHz: 220,
  },
  taxi: {
    thresholdsKmh: [0, 32, 62, 94, 126, 168],
    minHz: 52,
    maxHz: 195,
  },
  mio_bus: {
    thresholdsKmh: [0, 22, 44, 68, 92, 122],
    minHz: 36,
    maxHz: 108,
  },
  chiva: {
    thresholdsKmh: [0, 20, 40, 62, 84, 114],
    minHz: 34,
    maxHz: 100,
  },
};

const INACTIVE_SIREN_TELEMETRY: PoliceSirenTelemetry = {
  active: false,
  distanceMeters: Number.POSITIVE_INFINITY,
  mode: 'wail',
  attenuation: 0,
  dopplerRatio: 1,
};

// Salsa Brava (116 BPM) patterns — 2-3 Son Clave + C minor / G7 Montuno + Tumbao bass
const SALSA_CLAVE_STEPS: ReadonlySet<number> = new Set([2, 4, 8, 11, 14]);
const SALSA_MONTUNO_CM: Readonly<Record<number, readonly number[]>> = {
  0: [261.63, 311.13, 392.0],
  3: [311.13, 392.0],
  6: [392.0, 523.25],
  8: [261.63, 311.13],
  10: [392.0],
  14: [293.66, 349.23, 493.88],
};
const SALSA_MONTUNO_G7: Readonly<Record<number, readonly number[]>> = {
  0: [246.94, 293.66, 349.23],
  3: [293.66, 392.0],
  6: [349.23, 493.88],
  8: [392.0],
  10: [349.23],
  14: [261.63, 311.13, 392.0],
};
const SALSA_BASS_BAR_0: Readonly<Record<number, number>> = {
  0: 65.41,
  6: 98.0,
  8: 130.81,
  14: 98.0,
};
const SALSA_BASS_BAR_1: Readonly<Record<number, number>> = {
  0: 98.0,
  6: 123.47,
  8: 146.83,
  14: 65.41,
};

// Sucursal Synth (108 BPM) — Vice Sunset Am -> F -> C -> G retrowave progression
const SYNTH_BASS_ROOTS: readonly number[] = [55.0, 43.65, 65.41, 49.0];
const SYNTH_ARP_CHORDS: readonly (readonly number[])[] = [
  [220.0, 261.63, 329.63, 440.0],
  [174.61, 220.0, 261.63, 349.23],
  [261.63, 329.63, 392.0, 523.25],
  [196.0, 246.94, 293.66, 392.0],
];

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function computeEngineTelemetry(
  speedKmh: number,
  vehicleKind: VehicleKind,
): EngineTelemetry {
  const safeSpeed = Number.isFinite(speedKmh) ? Math.max(0, speedKmh) : 0;
  const curve = VEHICLE_ENGINE_CURVES[vehicleKind];
  const thresholds = curve.thresholdsKmh;

  let gear = 5;
  let gearFraction = 1;

  for (let candidate = 1; candidate <= 5; candidate++) {
    const low = thresholds[candidate - 1] ?? 0;
    const high = thresholds[candidate] ?? low + 30;
    if (candidate === 5 || safeSpeed < high) {
      gear = candidate;
      const span = Math.max(1, high - low);
      gearFraction = clampNumber((safeSpeed - low) / span, 0, 1);
      break;
    }
  }

  let rawRpm: number;
  if (gear === 1) {
    rawRpm = MIN_RPM_NORM + gearFraction * 0.8;
  } else if (gear < 5) {
    rawRpm = 0.42 + gearFraction * 0.56;
  } else {
    rawRpm = 0.44 + gearFraction * 0.56;
  }

  const rpmNorm = clampNumber(rawRpm, MIN_RPM_NORM, MAX_RPM_NORM);
  const rpmRatio = (rpmNorm - MIN_RPM_NORM) / (MAX_RPM_NORM - MIN_RPM_NORM);
  const fundamentalHz = curve.minHz + rpmRatio * (curve.maxHz - curve.minHz);

  return { gear, rpmNorm, fundamentalHz };
}

export function computeNearestPoliceSiren(world: WorldSnapshot): PoliceSirenTelemetry {
  if (world.wantedStars <= 0) {
    return INACTIVE_SIREN_TELEMETRY;
  }

  let nearest: VehicleSnapshot | null = null;
  let nearestDist = Number.POSITIVE_INFINITY;

  for (const vehicle of world.vehicles) {
    if (vehicle.role !== 'police' || !vehicle.sirenActive) {
      continue;
    }
    const dist = Math.hypot(
      vehicle.x - world.player.x,
      vehicle.y - world.player.y,
      vehicle.z - world.player.z,
    );
    if (dist < nearestDist) {
      nearestDist = dist;
      nearest = vehicle;
    }
  }

  if (!nearest || !Number.isFinite(nearestDist)) {
    return INACTIVE_SIREN_TELEMETRY;
  }

  const attenuation = 1 / (1 + nearestDist / SIREN_ATTENUATION_SCALE_METERS);
  const mode: 'wail' | 'yelp' = nearestDist < SIREN_YELP_THRESHOLD_METERS ? 'yelp' : 'wail';

  const dx = nearest.x - world.player.x;
  const dz = nearest.z - world.player.z;
  const planarDist = Math.hypot(dx, dz);

  let dopplerRatio = 1;
  if (planarDist > 0.001) {
    const policeVx = Math.sin(nearest.heading) * nearest.speedMps;
    const policeVz = Math.cos(nearest.heading) * nearest.speedMps;
    const playerVx = Math.sin(world.player.heading) * world.player.speedMps;
    const playerVz = Math.cos(world.player.heading) * world.player.speedMps;
    const relVx = policeVx - playerVx;
    const relVz = policeVz - playerVz;
    const closingVelocityMps = -((relVx * dx + relVz * dz) / planarDist);
    dopplerRatio = clampNumber(
      1 + closingVelocityMps / SPEED_OF_SOUND_MPS,
      DOPPLER_MIN,
      DOPPLER_MAX,
    );
  }

  return {
    active: true,
    distanceMeters: nearestDist,
    mode,
    attenuation,
    dopplerRatio,
  };
}

function createDefaultAudioContext(): AudioContextLike | null {
  const scope = globalThis as {
    AudioContext?: new () => AudioContextLike;
    webkitAudioContext?: new () => AudioContextLike;
  };
  const AudioCtor = scope.AudioContext ?? scope.webkitAudioContext;
  if (typeof AudioCtor !== 'function') {
    return null;
  }
  try {
    return new AudioCtor();
  } catch {
    return null;
  }
}

function fillWhiteNoise(channelData: Float32Array): void {
  let seed = 0x12345678;
  for (let i = 0; i < channelData.length; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    channelData[i] = (seed / 0xffffffff) * 2 - 1;
  }
}

function resolvePlayerVehicleKind(world: WorldSnapshot): VehicleKind {
  const activeId = world.player.vehicleId;
  if (!activeId) {
    return 'banshee';
  }
  const activeVehicle = world.vehicles.find((vehicle) => vehicle.id === activeId);
  return activeVehicle?.kind ?? 'banshee';
}

function countNearbyPedestrians(world: WorldSnapshot, radiusMeters: number): number {
  const pedestrians = world.pedestrians;
  if (!pedestrians || pedestrians.length === 0) {
    return 0;
  }
  const radiusSq = radiusMeters * radiusMeters;
  let count = 0;
  for (const ped of pedestrians) {
    const dx = ped.x - world.player.x;
    const dz = ped.z - world.player.z;
    if (dx * dx + dz * dz <= radiusSq) {
      count += 1;
    }
  }
  return count;
}

export class AudioEngine {
  private readonly contextFactory: AudioContextFactory;
  private context: AudioContextLike | null = null;
  private masterGain: GainNodeLike | null = null;
  private noiseBuffer: AudioBufferLike | null = null;

  // Continuous 5-speed multi-harmonic engine chain
  private enginePrimaryOsc: OscillatorNodeLike | null = null;
  private engineSubOsc: OscillatorNodeLike | null = null;
  private engineFilter: BiquadFilterNodeLike | null = null;
  private engineGain: GainNodeLike | null = null;
  private lastEngineGear: number | null = null;
  private lastVehicleId: string | null = null;

  // Continuous tire drift screech chain
  private driftNoiseSource: AudioBufferSourceNodeLike | null = null;
  private driftFilter: BiquadFilterNodeLike | null = null;
  private driftGain: GainNodeLike | null = null;
  private driftGainLevel = 0;

  // Continuous nitro turbo spool chain
  private turboOsc: OscillatorNodeLike | null = null;
  private turboGain: GainNodeLike | null = null;
  private turboSpoolNorm = 0;

  // Continuous distance/Doppler Wail/Yelp police siren chain
  private sirenOsc: OscillatorNodeLike | null = null;
  private sirenFilter: BiquadFilterNodeLike | null = null;
  private sirenGain: GainNodeLike | null = null;
  private sirenPhaseRad = 0;

  // Continuous Cali street crowd murmur chain
  private crowdNoiseSource: AudioBufferSourceNodeLike | null = null;
  private crowdFilter: BiquadFilterNodeLike | null = null;
  private crowdGain: GainNodeLike | null = null;

  private station: RadioStationId;
  private muted: boolean;
  private voicesEnabled: boolean;
  private readonly masterVolume = DEFAULT_MASTER_VOLUME;
  private unlocked = false;
  private disposed = false;

  private stepAccumulator = 0;
  private stepIndex = 0;
  private barIndex = 0;
  private lastCollisionTimeSec: number | null = null;

  public constructor(options: AudioEngineOptions = {}) {
    this.station = options.station ?? 'salsa_brava';
    this.muted = options.muted ?? false;
    this.voicesEnabled = options.initialVoicesEnabled ?? true;
    this.contextFactory = options.contextFactory ?? createDefaultAudioContext;
  }

  public unlock(): AudioState {
    if (this.disposed) {
      return this.getState();
    }

    if (!this.context) {
      const created = this.contextFactory();
      if (!created) {
        return this.getState();
      }
      this.context = created;
      this.masterGain = created.createGain();
      this.masterGain.gain.setValueAtTime(
        this.muted ? 0 : this.masterVolume,
        created.currentTime,
      );
      this.masterGain.connect(created.destination);
    }

    if (this.context.state === 'suspended') {
      void this.context.resume().catch(() => {
        this.unlocked = false;
      });
    }

    this.unlocked = true;
    return this.getState();
  }

  public cycleStation(): AudioState {
    const currentIndex = STATION_ORDER.indexOf(this.station);
    const nextStation = STATION_ORDER[(currentIndex + 1) % STATION_ORDER.length] ?? 'salsa_brava';
    return this.setStation(nextStation);
  }

  public setStation(station: RadioStationId): AudioState {
    if (this.station !== station) {
      this.station = station;
      this.stepAccumulator = 0;
      this.stepIndex = 0;
      this.barIndex = 0;
    }
    return this.getState();
  }

  public toggleMute(): AudioState {
    return this.setMuted(!this.muted);
  }

  public setMuted(muted: boolean): AudioState {
    this.muted = muted;
    if (this.context && this.masterGain) {
      const targetGain = this.muted ? 0 : this.masterVolume;
      this.masterGain.gain.setValueAtTime(targetGain, this.context.currentTime);
      this.masterGain.gain.value = targetGain;
    }
    if (this.muted) {
      this.silenceContinuousNodes();
    }
    return this.getState();
  }

  public setVoicesEnabled(enabled: boolean): void {
    this.voicesEnabled = enabled;
  }

  public toggleVoices(): boolean {
    this.voicesEnabled = !this.voicesEnabled;
    return this.voicesEnabled;
  }

  public update(world: WorldSnapshot, dt: number): void {
    if (!this.context || !this.masterGain || !this.unlocked || this.muted || this.disposed) {
      this.silenceContinuousNodes();
      return;
    }

    const safeDt = Number.isFinite(dt) && dt > 0 ? Math.min(dt, MAX_STEP_DT) : 0;
    this.updateRadioSequencer(safeDt);
    this.updateEngineSynth(world);
    this.updateDriftAndTurbo(world, safeDt);
    this.updatePoliceSiren(world, safeDt);
    this.updateStreetMurmur(world);
  }

  public playSfx(kind: SfxKind): void {
    if (!this.isPlayable()) {
      return;
    }
    const ctx = this.context;
    if (!ctx) {
      return;
    }

    const now = ctx.currentTime;
    switch (kind) {
      case 'checkpoint':
        this.scheduleTone('triangle', 587.33, 0.11, 0.14, now);
        this.scheduleTone('triangle', 880.0, 0.16, 0.16, now + 0.08);
        break;
      case 'mission_passed':
        this.scheduleTone('triangle', 523.25, 0.12, 0.15, now);
        this.scheduleTone('triangle', 659.25, 0.12, 0.15, now + 0.1);
        this.scheduleTone('triangle', 783.99, 0.14, 0.16, now + 0.2);
        this.scheduleTone('sine', 1046.5, 0.35, 0.18, now + 0.3);
        break;
      case 'busted':
        this.scheduleSweep('sawtooth', 392.0, 261.63, 0.18, 0.14, now);
        this.scheduleSweep('sawtooth', 261.63, 146.83, 0.32, 0.16, now + 0.18);
        break;
      case 'enter_car':
        // Heavy door slam thump + V8 starter ignition flare
        this.scheduleSweep('sine', 120.0, 42.0, 0.085, 0.14, now);
        this.scheduleFilteredNoiseBurst(0.05, 0.055, 'lowpass', 320, 1.0, now);
        this.scheduleSweep('sawtooth', 75.0, 195.0, 0.14, 0.1, now + 0.07);
        this.scheduleSweep('sawtooth', 195.0, 105.0, 0.18, 0.08, now + 0.2);
        break;
      case 'nitro':
        this.scheduleSweep('sawtooth', 210.0, 660.0, 0.24, 0.12, now);
        break;
    }
  }

  public playCollision(intensity: number): void {
    if (!this.isPlayable() || !this.context) {
      return;
    }
    const clamped = Number.isFinite(intensity) ? clampNumber(intensity, 0, 1) : 0;
    if (clamped <= 0) {
      return;
    }

    const now = this.context.currentTime;
    if (
      this.lastCollisionTimeSec !== null &&
      now >= this.lastCollisionTimeSec &&
      now - this.lastCollisionTimeSec < COLLISION_COOLDOWN_SECONDS
    ) {
      return;
    }
    this.lastCollisionTimeSec = now;

    // Low chassis impact thump (110 Hz -> 38 Hz)
    this.scheduleSweep('sine', 110, 38, 0.16 + clamped * 0.08, 0.08 + clamped * 0.18, now);
    // Brief metallic crunch noise burst
    this.scheduleFilteredNoiseBurst(
      0.09 + clamped * 0.07,
      0.05 + clamped * 0.12,
      'bandpass',
      950 + clamped * 600,
      2.2,
      now,
    );
  }

  public playRadioSquelch(): void {
    if (!this.isPlayable() || !this.context) {
      return;
    }
    const now = this.context.currentTime;
    this.scheduleFilteredNoiseBurst(0.09, 0.07, 'bandpass', 2200, 2.0, now);
    this.scheduleTone('sine', 1800, 0.055, 0.075, now + 0.065);
  }

  public getState(): Readonly<AudioState> {
    return {
      station: this.station,
      stationLabel: LOCALE_CALI.radio[this.station],
      muted: this.muted,
      voicesEnabled: this.voicesEnabled,
      masterVolume: this.masterVolume,
      unlocked: this.unlocked,
    };
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.unlocked = false;

    const stopTime = this.context?.currentTime ?? 0;

    this.stopAndDisconnect(this.enginePrimaryOsc, stopTime);
    this.enginePrimaryOsc = null;
    this.stopAndDisconnect(this.engineSubOsc, stopTime);
    this.engineSubOsc = null;
    this.disconnectNode(this.engineFilter);
    this.engineFilter = null;
    this.disconnectNode(this.engineGain);
    this.engineGain = null;

    this.stopAndDisconnect(this.driftNoiseSource, stopTime);
    this.driftNoiseSource = null;
    this.disconnectNode(this.driftFilter);
    this.driftFilter = null;
    this.disconnectNode(this.driftGain);
    this.driftGain = null;

    this.stopAndDisconnect(this.turboOsc, stopTime);
    this.turboOsc = null;
    this.disconnectNode(this.turboGain);
    this.turboGain = null;

    this.stopAndDisconnect(this.sirenOsc, stopTime);
    this.sirenOsc = null;
    this.disconnectNode(this.sirenFilter);
    this.sirenFilter = null;
    this.disconnectNode(this.sirenGain);
    this.sirenGain = null;

    this.stopAndDisconnect(this.crowdNoiseSource, stopTime);
    this.crowdNoiseSource = null;
    this.disconnectNode(this.crowdFilter);
    this.crowdFilter = null;
    this.disconnectNode(this.crowdGain);
    this.crowdGain = null;

    this.noiseBuffer = null;

    this.disconnectNode(this.masterGain);
    this.masterGain = null;

    if (this.context) {
      const ctx = this.context;
      this.context = null;
      void ctx.close().catch(() => {
        this.unlocked = false;
      });
    }
  }

  private isPlayable(): boolean {
    return Boolean(this.context && this.masterGain && this.unlocked && !this.muted && !this.disposed);
  }

  private updateRadioSequencer(dt: number): void {
    if (this.station === 'off' || !this.context) {
      return;
    }

    const stepDuration =
      this.station === 'salsa_brava' ? SALSA_STEP_SECONDS : SYNTH_STEP_SECONDS;
    this.stepAccumulator += dt;

    let stepsTriggered = 0;
    while (this.stepAccumulator >= stepDuration && stepsTriggered < 2) {
      this.stepAccumulator -= stepDuration;
      if (this.station === 'salsa_brava') {
        this.triggerSalsaStep(this.stepIndex, this.barIndex);
      } else {
        this.triggerSynthStep(this.stepIndex, this.barIndex);
      }
      this.stepIndex = (this.stepIndex + 1) % 16;
      if (this.stepIndex === 0) {
        this.barIndex = (this.barIndex + 1) % 4;
      }
      stepsTriggered += 1;
    }
  }

  private triggerSalsaStep(step: number, bar: number): void {
    if (!this.context) {
      return;
    }
    const now = this.context.currentTime;
    const isAltBar = bar % 2 === 1;

    // 2-3 Son Clave woodblock pulse
    if (SALSA_CLAVE_STEPS.has(step)) {
      this.scheduleSweep('triangle', 1480, 1120, 0.042, 0.11, now);
    }

    // Syncopated piano montuno chords
    const montunoMap = isAltBar ? SALSA_MONTUNO_G7 : SALSA_MONTUNO_CM;
    const chord = montunoMap[step];
    if (chord) {
      for (const freq of chord) {
        this.scheduleTone('triangle', freq, 0.095, 0.055, now);
      }
    }

    // Warm anticipated bass tumbao
    const bassMap = isAltBar ? SALSA_BASS_BAR_1 : SALSA_BASS_BAR_0;
    const bassFreq = bassMap[step];
    if (bassFreq !== undefined) {
      this.scheduleTone('sine', bassFreq, 0.22, 0.16, now);
    }
  }

  private triggerSynthStep(step: number, bar: number): void {
    if (!this.context) {
      return;
    }
    const now = this.context.currentTime;
    const chordIndex = bar % SYNTH_BASS_ROOTS.length;
    const bassRoot = SYNTH_BASS_ROOTS[chordIndex] ?? 55.0;
    const arpNotes = SYNTH_ARP_CHORDS[chordIndex] ?? SYNTH_ARP_CHORDS[0];

    // Driving retrowave 8th-note sawtooth bassline
    if (step % 2 === 0) {
      const octaveMultiplier = step % 4 === 2 ? 2 : 1;
      this.scheduleTone('sawtooth', bassRoot * octaveMultiplier, 0.12, 0.095, now);
    }

    // Neon shimmering arpeggio
    if (arpNotes && arpNotes.length > 0) {
      const arpFreq = arpNotes[step % arpNotes.length];
      if (arpFreq !== undefined) {
        this.scheduleTone('triangle', arpFreq * 2, 0.085, 0.048, now);
      }
    }

    // Snare backbeat on beats 2 and 4
    if (step === 4 || step === 12) {
      this.scheduleSweep('square', 280, 110, 0.09, 0.075, now);
    }
  }

  private updateEngineSynth(world: WorldSnapshot): void {
    if (!this.context || !this.masterGain) {
      return;
    }

    if (world.player.mode !== 'driving') {
      this.lastEngineGear = null;
      this.lastVehicleId = null;
      this.silenceEngineNodes();
      return;
    }

    const now = this.context.currentTime;
    this.ensureEngineNodes(now);
    if (!this.enginePrimaryOsc || !this.engineSubOsc || !this.engineGain) {
      return;
    }

    const vehicleKind = resolvePlayerVehicleKind(world);
    const telemetry = computeEngineTelemetry(world.player.speedKmh, vehicleKind);

    if (
      this.lastVehicleId === world.player.vehicleId &&
      this.lastEngineGear !== null &&
      telemetry.gear !== this.lastEngineGear
    ) {
      this.triggerExhaustPop(now);
    }
    this.lastEngineGear = telemetry.gear;
    this.lastVehicleId = world.player.vehicleId;

    const boostPitchMult = world.player.isBoosting ? 1.12 : 1.0;
    const primaryHz = telemetry.fundamentalHz * boostPitchMult;
    const subHz = primaryHz * 0.5;
    this.enginePrimaryOsc.frequency.setValueAtTime(primaryHz, now);
    this.engineSubOsc.frequency.setValueAtTime(subHz, now);

    if (this.engineFilter) {
      const rpmProgress = clampNumber(
        (telemetry.rpmNorm - MIN_RPM_NORM) / (MAX_RPM_NORM - MIN_RPM_NORM),
        0,
        1,
      );
      const boostLift = world.player.isBoosting ? 240 : 0;
      const cutoffHz = clampNumber(
        ENGINE_FILTER_MIN_HZ +
          rpmProgress * (ENGINE_FILTER_MAX_HZ - ENGINE_FILTER_MIN_HZ) +
          boostLift,
        ENGINE_FILTER_MIN_HZ,
        ENGINE_FILTER_MAX_HZ,
      );
      this.engineFilter.frequency.setValueAtTime(cutoffHz, now);
    }

    const engineGainVal =
      0.022 + telemetry.rpmNorm * 0.044 + (world.player.isBoosting ? 0.012 : 0);
    this.engineGain.gain.setValueAtTime(engineGainVal, now);
  }

  private ensureEngineNodes(now: number): void {
    if (!this.context || !this.masterGain) {
      return;
    }
    if (this.enginePrimaryOsc && this.engineSubOsc && this.engineGain) {
      return;
    }

    this.engineGain = this.context.createGain();
    this.engineGain.gain.setValueAtTime(0.0001, now);
    this.engineGain.connect(this.masterGain);

    let engineTarget: AudioNodeLike = this.engineGain;
    if (typeof this.context.createBiquadFilter === 'function') {
      this.engineFilter = this.context.createBiquadFilter();
      this.engineFilter.type = 'lowpass';
      this.engineFilter.frequency.setValueAtTime(ENGINE_FILTER_MIN_HZ, now);
      this.engineFilter.Q.setValueAtTime(1.8, now);
      this.engineFilter.connect(this.engineGain);
      engineTarget = this.engineFilter;
    }

    this.enginePrimaryOsc = this.context.createOscillator();
    this.enginePrimaryOsc.type = 'sawtooth';
    this.enginePrimaryOsc.frequency.setValueAtTime(64, now);
    this.enginePrimaryOsc.connect(engineTarget);
    this.enginePrimaryOsc.start(now);

    this.engineSubOsc = this.context.createOscillator();
    this.engineSubOsc.type = 'triangle';
    this.engineSubOsc.frequency.setValueAtTime(32, now);
    this.engineSubOsc.connect(engineTarget);
    this.engineSubOsc.start(now);
  }

  private triggerExhaustPop(now: number): void {
    this.scheduleSweep('triangle', 165, 52, 0.055, 0.055, now);
    this.scheduleFilteredNoiseBurst(0.06, 0.065, 'bandpass', 620, 1.8, now);
  }

  private updateDriftAndTurbo(world: WorldSnapshot, dt: number): void {
    if (!this.context || !this.masterGain) {
      return;
    }
    const now = this.context.currentTime;
    const isDriving = world.player.mode === 'driving';

    if (!isDriving) {
      this.driftGainLevel = 0;
      this.turboSpoolNorm = 0;
      this.driftGain?.gain.setValueAtTime(0.0001, now);
      this.turboGain?.gain.setValueAtTime(0.0001, now);
      return;
    }

    // Tire drift screech (bandpass ~1250 Hz, Q = 4.5)
    const driftActive = world.player.isDrifting && world.player.speedKmh > DRIFT_MIN_SPEED_KMH;
    const driftTarget = driftActive
      ? 0.03 + clampNumber((world.player.speedKmh - DRIFT_MIN_SPEED_KMH) / 100, 0, 1) * 0.065
      : 0;
    const blend = clampNumber(dt * 14, 0.18, 1);
    this.driftGainLevel += (driftTarget - this.driftGainLevel) * blend;

    if (driftActive || this.driftGain) {
      this.ensureDriftNodes(now);
      if (this.driftGain) {
        const clampedDriftGain = this.driftGainLevel > 0.001 ? this.driftGainLevel : 0.0001;
        this.driftGain.gain.setValueAtTime(clampedDriftGain, now);
      }
      if (this.driftFilter) {
        const speedShift = clampNumber((world.player.speedKmh - DRIFT_MIN_SPEED_KMH) * 1.4, 0, 140);
        this.driftFilter.frequency.setValueAtTime(DRIFT_FILTER_BASE_HZ + speedShift, now);
      }
    }

    // Nitro turbo spool whine
    if (world.player.isBoosting) {
      this.turboSpoolNorm = clampNumber(this.turboSpoolNorm + Math.max(dt, 0.016) * 2.4, 0, 1);
      this.ensureTurboNodes(now);
    } else {
      this.turboSpoolNorm = clampNumber(this.turboSpoolNorm - Math.max(dt, 0.016) * 3.0, 0, 1);
    }

    if (this.turboOsc && this.turboGain) {
      const turboHz = 1200 + this.turboSpoolNorm * 2400;
      const turboGainVal =
        this.turboSpoolNorm > 0.01 ? 0.006 + this.turboSpoolNorm * 0.022 : 0.0001;
      this.turboOsc.frequency.setValueAtTime(turboHz, now);
      this.turboGain.gain.setValueAtTime(turboGainVal, now);
    }
  }

  private ensureDriftNodes(now: number): void {
    if (!this.context || !this.masterGain || this.driftGain) {
      return;
    }
    const noise = this.getOrCreateNoiseBuffer();
    if (!noise || typeof this.context.createBufferSource !== 'function') {
      return;
    }

    this.driftGain = this.context.createGain();
    this.driftGain.gain.setValueAtTime(0.0001, now);
    this.driftGain.connect(this.masterGain);

    let driftTarget: AudioNodeLike = this.driftGain;
    if (typeof this.context.createBiquadFilter === 'function') {
      this.driftFilter = this.context.createBiquadFilter();
      this.driftFilter.type = 'bandpass';
      this.driftFilter.frequency.setValueAtTime(DRIFT_FILTER_BASE_HZ, now);
      this.driftFilter.Q.setValueAtTime(DRIFT_FILTER_Q, now);
      this.driftFilter.connect(this.driftGain);
      driftTarget = this.driftFilter;
    }

    this.driftNoiseSource = this.context.createBufferSource();
    this.driftNoiseSource.buffer = noise;
    this.driftNoiseSource.loop = true;
    this.driftNoiseSource.connect(driftTarget);
    this.driftNoiseSource.start(now);
  }

  private ensureTurboNodes(now: number): void {
    if (!this.context || !this.masterGain || (this.turboOsc && this.turboGain)) {
      return;
    }
    this.turboGain = this.context.createGain();
    this.turboGain.gain.setValueAtTime(0.0001, now);
    this.turboGain.connect(this.masterGain);

    this.turboOsc = this.context.createOscillator();
    this.turboOsc.type = 'sine';
    this.turboOsc.frequency.setValueAtTime(1200, now);
    this.turboOsc.connect(this.turboGain);
    this.turboOsc.start(now);
  }

  private updatePoliceSiren(world: WorldSnapshot, dt: number): void {
    if (!this.context || !this.masterGain) {
      return;
    }
    const now = this.context.currentTime;
    const siren = computeNearestPoliceSiren(world);

    if (!siren.active) {
      this.sirenPhaseRad = 0;
      if (this.sirenGain) {
        this.sirenGain.gain.setValueAtTime(0.0001, now);
      }
      return;
    }

    this.ensureSirenNodes(now);
    if (!this.sirenOsc || !this.sirenGain) {
      return;
    }

    const sweepRateHz = siren.mode === 'yelp' ? SIREN_YELP_RATE_HZ : SIREN_WAIL_RATE_HZ;
    this.sirenPhaseRad = (this.sirenPhaseRad + dt * sweepRateHz * Math.PI * 2) % (Math.PI * 2);

    const sweepNorm = 0.5 - 0.5 * Math.cos(this.sirenPhaseRad);
    const freqHz = (640 + sweepNorm * 720) * siren.dopplerRatio;
    const gainVal = Math.max(0.0001, 0.085 * siren.attenuation);

    this.sirenOsc.frequency.setValueAtTime(freqHz, now);
    this.sirenGain.gain.setValueAtTime(gainVal, now);
  }

  private ensureSirenNodes(now: number): void {
    if (!this.context || !this.masterGain || (this.sirenOsc && this.sirenGain)) {
      return;
    }
    this.sirenGain = this.context.createGain();
    this.sirenGain.gain.setValueAtTime(0.0001, now);
    this.sirenGain.connect(this.masterGain);

    let sirenTarget: AudioNodeLike = this.sirenGain;
    if (typeof this.context.createBiquadFilter === 'function') {
      this.sirenFilter = this.context.createBiquadFilter();
      this.sirenFilter.type = 'lowpass';
      this.sirenFilter.frequency.setValueAtTime(2000, now);
      this.sirenFilter.Q.setValueAtTime(1.0, now);
      this.sirenFilter.connect(this.sirenGain);
      sirenTarget = this.sirenFilter;
    }

    this.sirenOsc = this.context.createOscillator();
    this.sirenOsc.type = 'triangle';
    this.sirenOsc.frequency.setValueAtTime(640, now);
    this.sirenOsc.connect(sirenTarget);
    this.sirenOsc.start(now);
  }

  private updateStreetMurmur(world: WorldSnapshot): void {
    if (!this.context || !this.masterGain) {
      return;
    }
    const now = this.context.currentTime;
    const nearbyPeds = countNearbyPedestrians(world, CROWD_MURMUR_RADIUS_METERS);

    if (nearbyPeds <= 0) {
      if (this.crowdGain) {
        this.crowdGain.gain.setValueAtTime(0, now);
      }
      return;
    }

    this.ensureCrowdNodes(now);
    if (!this.crowdGain) {
      return;
    }

    const density = clampNumber(nearbyPeds / CROWD_MURMUR_SATURATION_PEDS, 0, 1);
    const targetGain = density * CROWD_MURMUR_MAX_GAIN;
    this.crowdGain.gain.setValueAtTime(targetGain, now);
  }

  private ensureCrowdNodes(now: number): void {
    if (!this.context || !this.masterGain || this.crowdGain) {
      return;
    }
    const noise = this.getOrCreateNoiseBuffer();
    if (!noise || typeof this.context.createBufferSource !== 'function') {
      return;
    }

    this.crowdGain = this.context.createGain();
    this.crowdGain.gain.setValueAtTime(0, now);
    this.crowdGain.connect(this.masterGain);

    let crowdTarget: AudioNodeLike = this.crowdGain;
    if (typeof this.context.createBiquadFilter === 'function') {
      this.crowdFilter = this.context.createBiquadFilter();
      this.crowdFilter.type = 'bandpass';
      this.crowdFilter.frequency.setValueAtTime(CROWD_MURMUR_FILTER_HZ, now);
      this.crowdFilter.Q.setValueAtTime(1.6, now);
      this.crowdFilter.connect(this.crowdGain);
      crowdTarget = this.crowdFilter;
    }

    this.crowdNoiseSource = this.context.createBufferSource();
    this.crowdNoiseSource.buffer = noise;
    this.crowdNoiseSource.loop = true;
    this.crowdNoiseSource.connect(crowdTarget);
    this.crowdNoiseSource.start(now);
  }

  private getOrCreateNoiseBuffer(): AudioBufferLike | null {
    if (this.noiseBuffer) {
      return this.noiseBuffer;
    }
    if (!this.context || typeof this.context.createBuffer !== 'function') {
      return null;
    }
    const sampleRate = this.context.sampleRate ?? DEFAULT_SAMPLE_RATE;
    const length = Math.max(1, Math.floor(sampleRate));
    const buffer = this.context.createBuffer(1, length, sampleRate);
    fillWhiteNoise(buffer.getChannelData(0));
    this.noiseBuffer = buffer;
    return buffer;
  }

  private scheduleFilteredNoiseBurst(
    duration: number,
    peakGain: number,
    filterType: BiquadFilterType,
    filterFreqHz: number,
    filterQ: number,
    startTime: number,
  ): void {
    if (!this.context || !this.masterGain || typeof this.context.createBufferSource !== 'function') {
      return;
    }
    const noise = this.getOrCreateNoiseBuffer();
    if (!noise) {
      return;
    }

    const source = this.context.createBufferSource();
    source.buffer = noise;
    source.loop = false;

    const gain = this.context.createGain();
    gain.gain.setValueAtTime(peakGain, startTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
    gain.connect(this.masterGain);

    if (typeof this.context.createBiquadFilter === 'function') {
      const filter = this.context.createBiquadFilter();
      filter.type = filterType;
      filter.frequency.setValueAtTime(filterFreqHz, startTime);
      filter.Q.setValueAtTime(filterQ, startTime);
      source.connect(filter);
      filter.connect(gain);
    } else {
      source.connect(gain);
    }

    source.start(startTime);
    source.stop(startTime + duration + 0.01);
  }

  private silenceEngineNodes(): void {
    if (this.engineGain && this.context) {
      this.engineGain.gain.setValueAtTime(0.0001, this.context.currentTime);
    }
  }

  private silenceContinuousNodes(): void {
    this.lastEngineGear = null;
    this.lastVehicleId = null;
    this.driftGainLevel = 0;
    this.turboSpoolNorm = 0;
    this.sirenPhaseRad = 0;

    if (!this.context) {
      return;
    }
    const now = this.context.currentTime;
    this.engineGain?.gain.setValueAtTime(0.0001, now);
    this.driftGain?.gain.setValueAtTime(0.0001, now);
    this.turboGain?.gain.setValueAtTime(0.0001, now);
    this.sirenGain?.gain.setValueAtTime(0.0001, now);
    this.crowdGain?.gain.setValueAtTime(0, now);
  }

  private stopAndDisconnect(node: StoppableAudioNode | null, stopTime: number): void {
    if (!node) {
      return;
    }
    try {
      node.stop(stopTime);
    } catch {
      // Safe no-op if oscillator or buffer source was already stopped.
    }
    node.disconnect?.();
  }

  private disconnectNode(node: AudioNodeLike | null): void {
    node?.disconnect?.();
  }

  private scheduleTone(
    type: OscillatorType,
    frequency: number,
    duration: number,
    peakGain: number,
    startTime: number,
  ): void {
    if (!this.context || !this.masterGain) {
      return;
    }
    const osc = this.context.createOscillator();
    const gain = this.context.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(frequency, startTime);

    gain.gain.setValueAtTime(peakGain, startTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start(startTime);
    osc.stop(startTime + duration + 0.01);
  }

  private scheduleSweep(
    type: OscillatorType,
    startFreq: number,
    endFreq: number,
    duration: number,
    peakGain: number,
    startTime: number,
  ): void {
    if (!this.context || !this.masterGain) {
      return;
    }
    const osc = this.context.createOscillator();
    const gain = this.context.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(startFreq, startTime);
    osc.frequency.linearRampToValueAtTime(endFreq, startTime + duration);

    gain.gain.setValueAtTime(peakGain, startTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start(startTime);
    osc.stop(startTime + duration + 0.01);
  }
}
