import { describe, expect, it } from 'vitest';
import {
  computeEngineTelemetry,
  isTurbochargedVehicle,
  resolveEngineVoice,
} from '../../../src/audio/audioEngine';
import type { VehicleKind } from '../../../src/types/game';

const CLASSIC_KINDS: readonly VehicleKind[] = [
  'mazda_323_coupe',
  'renault_18_gtx',
  'chevrolet_sprint_turbo',
  'chevrolet_monza',
  'nissan_sentra_b13',
  'chevette_turbo',
  'renault_twingo',
];

describe('audio engine voices for the classic Cali fleet and 2-stroke motos', () => {
  it('rings the Yamaha RX115 / DT125 two-strokes far higher than any car', () => {
    for (const bike of ['yamaha_rx115', 'yamaha_dt125'] as const) {
      const bikeIdle = computeEngineTelemetry(0, bike);
      const bikeCruise = computeEngineTelemetry(60, bike);
      expect(bikeIdle.fundamentalHz).toBeGreaterThan(
        computeEngineTelemetry(0, 'spark_gt_turbo').fundamentalHz * 1.4,
      );
      expect(bikeCruise.fundamentalHz).toBeGreaterThan(
        computeEngineTelemetry(60, 'renault4_turbo').fundamentalHz,
      );
      expect(Number.isFinite(bikeCruise.fundamentalHz)).toBe(true);
    }
  });

  it('uses a square-wave "ring-ding" voice with an upper harmonic for two-strokes', () => {
    const rx = resolveEngineVoice('yamaha_rx115');
    const dt = resolveEngineVoice('yamaha_dt125');
    const car = resolveEngineVoice('renault_18_gtx');

    expect(rx.isTwoStroke).toBe(true);
    expect(dt.isTwoStroke).toBe(true);
    expect(rx.primaryWaveform).toBe('square');
    expect(rx.harmonicRatio).toBeGreaterThan(1);
    expect(car.isTwoStroke).toBe(false);
    expect(car.primaryWaveform).toBe('sawtooth');
    expect(car.harmonicRatio).toBeLessThan(1);
  });

  it('defines finite, distinct engine curves for every classic car and flags turbo kits', () => {
    const fundamentals = new Set<number>();
    for (const kind of CLASSIC_KINDS) {
      const telemetry = computeEngineTelemetry(90, kind);
      expect(Number.isFinite(telemetry.fundamentalHz)).toBe(true);
      fundamentals.add(Math.round(telemetry.fundamentalHz));
    }
    expect(fundamentals.size).toBe(CLASSIC_KINDS.length);

    expect(isTurbochargedVehicle('chevrolet_sprint_turbo')).toBe(true);
    expect(isTurbochargedVehicle('chevette_turbo')).toBe(true);
    expect(isTurbochargedVehicle('renault4_turbo')).toBe(true);
    expect(isTurbochargedVehicle('renault_twingo')).toBe(false);
    expect(isTurbochargedVehicle('yamaha_rx115')).toBe(false);
  });
});
