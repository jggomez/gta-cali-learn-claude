/**
 * Procedural Web Audio API radio sequencer and sound effects engine for GTA VI: Cali.
 * 100% offline synthesis with injectable AudioContext factory and safe headless no-op behavior.
 */

import { LOCALE_CALI } from '../config/localeCali';
import type { AudioState, RadioStationId, WorldSnapshot } from '../types/game';

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

export interface AudioContextLike {
  readonly currentTime: number;
  readonly state: string;
  readonly destination: AudioNodeLike;
  resume(): Promise<void>;
  close(): Promise<void>;
  createOscillator(): OscillatorNodeLike;
  createGain(): GainNodeLike;
}

export type AudioContextFactory = () => AudioContextLike | null;

export type SfxKind = 'checkpoint' | 'mission_passed' | 'busted' | 'enter_car' | 'nitro';

export interface AudioEngineOptions {
  readonly station?: RadioStationId;
  readonly muted?: boolean;
  readonly contextFactory?: AudioContextFactory;
}

const STATION_ORDER: readonly RadioStationId[] = ['salsa_brava', 'sucursal_synth', 'off'];
const DEFAULT_MASTER_VOLUME = 0.55;
const SALSA_STEP_SECONDS = 60 / 116 / 4; // 116 BPM 16th note
const SYNTH_STEP_SECONDS = 60 / 108 / 4; // 108 BPM 16th note
const SIREN_INTERVAL_SECONDS = 0.42;
const MAX_STEP_DT = 0.1;

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

export class AudioEngine {
  private readonly contextFactory: AudioContextFactory;
  private context: AudioContextLike | null = null;
  private masterGain: GainNodeLike | null = null;
  private engineOsc: OscillatorNodeLike | null = null;
  private engineGain: GainNodeLike | null = null;

  private station: RadioStationId;
  private muted: boolean;
  private readonly masterVolume = DEFAULT_MASTER_VOLUME;
  private unlocked = false;
  private disposed = false;

  private stepAccumulator = 0;
  private stepIndex = 0;
  private barIndex = 0;
  private sirenAccumulator = 0;
  private sirenHighPhase = false;

  public constructor(options: AudioEngineOptions = {}) {
    this.station = options.station ?? 'salsa_brava';
    this.muted = options.muted ?? false;
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
      this.silenceEngineHum();
    }
    return this.getState();
  }

  public update(world: WorldSnapshot, dt: number): void {
    if (!this.context || !this.masterGain || !this.unlocked || this.muted || this.disposed) {
      this.silenceEngineHum();
      return;
    }

    const safeDt = Number.isFinite(dt) && dt > 0 ? Math.min(dt, MAX_STEP_DT) : 0;
    this.updateRadioSequencer(safeDt);
    this.updateEngineHum(world);
    this.updatePoliceSiren(world, safeDt);
  }

  public playSfx(kind: SfxKind): void {
    if (!this.context || !this.masterGain || !this.unlocked || this.muted || this.disposed) {
      return;
    }

    const now = this.context.currentTime;
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
        this.scheduleSweep('sawtooth', 95.0, 220.0, 0.16, 0.11, now);
        break;
      case 'nitro':
        this.scheduleSweep('sawtooth', 210.0, 660.0, 0.24, 0.12, now);
        break;
    }
  }

  public getState(): Readonly<AudioState> {
    return {
      station: this.station,
      stationLabel: LOCALE_CALI.radio[this.station],
      muted: this.muted,
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

    if (this.engineOsc && this.context) {
      const osc = this.engineOsc;
      this.engineOsc = null;
      try {
        osc.stop(this.context.currentTime);
      } catch {
        this.engineGain?.disconnect?.();
      }
    }
    if (this.engineGain) {
      this.engineGain.disconnect?.();
      this.engineGain = null;
    }
    if (this.masterGain) {
      this.masterGain.disconnect?.();
      this.masterGain = null;
    }
    if (this.context) {
      const ctx = this.context;
      this.context = null;
      void ctx.close().catch(() => {
        this.unlocked = false;
      });
    }
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

  private updateEngineHum(world: WorldSnapshot): void {
    if (!this.context || !this.masterGain) {
      return;
    }

    if (world.player.mode !== 'driving') {
      this.silenceEngineHum();
      return;
    }

    const now = this.context.currentTime;
    if (!this.engineOsc || !this.engineGain) {
      this.engineGain = this.context.createGain();
      this.engineGain.gain.setValueAtTime(0.0001, now);
      this.engineGain.connect(this.masterGain);

      this.engineOsc = this.context.createOscillator();
      this.engineOsc.type = 'sawtooth';
      this.engineOsc.frequency.setValueAtTime(56, now);
      this.engineOsc.connect(this.engineGain);
      this.engineOsc.start(now);
    }

    const clampedSpeed = Math.max(0, Math.min(world.player.speedKmh, 220));
    const rpmFreq = 54 + clampedSpeed * 1.05 + (world.player.isBoosting ? 24 : 0);
    const humGain = 0.024 + (clampedSpeed / 220) * 0.042;
    this.engineOsc.frequency.setValueAtTime(rpmFreq, now);
    this.engineGain.gain.setValueAtTime(humGain, now);
  }

  private silenceEngineHum(): void {
    if (this.engineGain && this.context) {
      this.engineGain.gain.setValueAtTime(0.0001, this.context.currentTime);
    }
  }

  private updatePoliceSiren(world: WorldSnapshot, dt: number): void {
    if (!this.context || world.wantedStars <= 0) {
      this.sirenAccumulator = 0;
      return;
    }

    this.sirenAccumulator += dt;
    if (this.sirenAccumulator >= SIREN_INTERVAL_SECONDS) {
      this.sirenAccumulator -= SIREN_INTERVAL_SECONDS;
      const startFreq = this.sirenHighPhase ? 940 : 660;
      const endFreq = this.sirenHighPhase ? 660 : 940;
      this.sirenHighPhase = !this.sirenHighPhase;
      this.scheduleSweep(
        'triangle',
        startFreq,
        endFreq,
        SIREN_INTERVAL_SECONDS * 0.92,
        0.048,
        this.context.currentTime,
      );
    }
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
