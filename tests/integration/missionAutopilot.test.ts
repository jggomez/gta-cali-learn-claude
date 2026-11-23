/**
 * Empirical "can the missions actually be beaten?" proof.
 *
 * Drives the REAL GameWorld + MissionDirector pipeline (mirroring GameApp.startMission and
 * GameApp.stepPlayingFrame at a fixed 1/60 s step) with an input-only autopilot: real physics,
 * AABB collisions, traffic, police pursuit/bust, rival racers and countdown timers. No teleports,
 * no cheats. The simulation has no RNG, so each seed is a deterministic replay; seeds vary the
 * autopilot's hesitation and cornering style to model different players.
 */

import { describe, expect, it } from 'vitest';
import { CALI_MAP } from '../../src/config/caliMap';
import { isPlausibleTime, MIN_PLAUSIBLE_SECONDS } from '../../src/missions/devhackChallenge';
import type { MissionId } from '../../src/types/game';
import { AUTOPILOT_DT, runMissionAutopilot, type AutopilotResult } from '../helpers/missionAutopilot';

const SEEDS = [0, 1, 2, 3, 4, 5, 6, 7];
const MAX_SIM_SECONDS = 600;
/** Busts by the police AI are legitimate difficulty; require a solid majority of clean runs. */
const MIN_PASS_RATE = 0.5;
/** Fastest car boost (~57 m/s) for one frame plus vehicle-bump pushes: anything larger is a teleport. */
const MAX_FRAME_STEP_METERS = 3;

const results = new Map<MissionId, AutopilotResult[]>();

function runAll(missionId: MissionId): AutopilotResult[] {
  const cached = results.get(missionId);
  if (cached) {
    return cached;
  }
  const runs = SEEDS.map((seed) =>
    runMissionAutopilot(missionId, {
      seed,
      maxSimSeconds: MAX_SIM_SECONDS,
      challengeRun: missionId === 'free_roam',
    }),
  );
  results.set(missionId, runs);
  printTable(missionId, runs);
  return runs;
}

function printTable(missionId: MissionId, runs: readonly AutopilotResult[]): void {
  const passed = runs.filter((run) => run.completed).length;
  const rows = runs.map((run, index) => {
    const time = run.completed ? `${run.lastCompletedTimeSeconds?.toFixed(2)}s` : `${run.simSeconds.toFixed(1)}s`;
    const m2 = run.countdownRemainingSeconds === null ? '-' : `${run.countdownRemainingSeconds.toFixed(1)}s`;
    const pos = run.racePosition === null ? '-' : `${run.racePosition}/3`;
    const where = run.completed
      ? ''
      : `${run.failureReason} at step ${run.lastStepIndex} (${run.lastObjectiveId}) x=${run.lastPosition.x.toFixed(0)} z=${run.lastPosition.z.toFixed(0)}`;
    return `  seed ${index} | ${run.completed ? 'PASS' : 'FAIL'} | ${run.finalMode.padEnd(14)} | ${time.padStart(8)} | M2 left ${m2.padStart(6)} | pos ${pos} | max★ ${run.maxWantedStars} | ${where}`;
  });
  console.log(`[autopilot] ${missionId}: ${passed}/${runs.length} completed\n${rows.join('\n')}`);
}

function expectRealCompletions(missionId: MissionId, expectedMode: 'mission_passed' | 'victory'): AutopilotResult[] {
  const runs = runAll(missionId);
  const completed = runs.filter((run) => run.completed);

  expect(completed.length, `${missionId} never completed`).toBeGreaterThan(0);
  expect(completed.length / runs.length).toBeGreaterThanOrEqual(MIN_PASS_RATE);

  for (const run of runs) {
    // Every outcome is a real game outcome: a pass, a bust, or the M2 clock; never a stall.
    expect(['mission_passed', 'victory', 'busted']).toContain(run.finalMode);
    expect(run.maxFrameStepMeters).toBeLessThan(MAX_FRAME_STEP_METERS);
  }
  for (const run of completed) {
    expect(run.finalMode).toBe(expectedMode);
    expect(run.lastCompletedTimeSeconds).not.toBeNull();
    expect(run.lastCompletedTimeSeconds!).toBeGreaterThanOrEqual(MIN_PLAUSIBLE_SECONDS[missionId]);
    expect(run.simSeconds).toBeGreaterThan(AUTOPILOT_DT);
  }
  return completed;
}

/** Each case replays 8 full-length missions at 60 Hz; allow for slow or busy CI machines. */
const AUTOPILOT_TEST_TIMEOUT_MS = 120_000;

describe('Mission autopilot: every mission is beatable through the real simulation', { timeout: AUTOPILOT_TEST_TIMEOUT_MS }, () => {
  it('Mission 1 "Golpe en la Torre": on-foot heist, getaway car, La Ermita, San Antonio hideout', () => {
    const completed = expectRealCompletions('mission_1_bulevar', 'mission_passed');
    for (const run of completed) {
      expect(run.maxWantedStars).toBeGreaterThanOrEqual(2);
    }
  });

  it('Mission 2 "Noche de Salsa en Cristo Rey": beats the 95 s countdown under a 3-star pursuit', () => {
    const completed = expectRealCompletions('mission_2_cristo_rey', 'victory');
    for (const run of completed) {
      expect(run.countdownRemainingSeconds).not.toBeNull();
      expect(run.countdownRemainingSeconds!).toBeGreaterThan(0);
    }
  });

  it('Mission 3 "Pique Callejero": clears all 6 checkpoints against the rival racers', () => {
    const completed = expectRealCompletions('mission_3_pique_bulevar', 'mission_passed');
    for (const run of completed) {
      expect(run.racePosition).not.toBeNull();
      expect(run.racePosition!).toBeGreaterThanOrEqual(1);
      expect(run.racePosition!).toBeLessThanOrEqual(3);
    }
  });

  it('Mission 5 "El Golpe del Prompt": collects Rol, Contexto, Tarea, Formato and reaches the bank', () => {
    const completed = expectRealCompletions('mission_5_golpe_prompt', 'mission_passed');
    for (const run of completed) {
      expect(run.lastStepIndex).toBe(4);
      expect(run.maxWantedStars).toBeGreaterThanOrEqual(2);
    }
  });

  it('Reto Free Roam tour: reaches all 6 Cali landmarks and passes the timed stage', () => {
    const completed = expectRealCompletions('free_roam', 'mission_passed');
    for (const run of completed) {
      expect(run.discoveredLandmarkCount).toBe(CALI_MAP.landmarks.length);
    }
  });

  it('accepts the fastest expert-driver completions as plausible Reto times', () => {
    // Aggressive cornering in the quickest Garaje car: the fastest real runs found while
    // calibrating MIN_PLAUSIBLE_SECONDS. A legit time must never be rejected by the Reto.
    const expertRuns: readonly { readonly missionId: MissionId; readonly speedScale: number }[] = [
      { missionId: 'mission_1_bulevar', speedScale: 4 },
      { missionId: 'mission_2_cristo_rey', speedScale: 6 },
      { missionId: 'mission_5_golpe_prompt', speedScale: 4 },
    ];
    const rows: string[] = [];
    for (const { missionId, speedScale } of expertRuns) {
      const run = runMissionAutopilot(missionId, {
        seed: 3,
        speedScale,
        carKind: 'chevrolet_sprint_turbo',
        maxSimSeconds: MAX_SIM_SECONDS,
      });
      rows.push(`  ${missionId}: ${run.finalMode} in ${run.lastCompletedTimeSeconds?.toFixed(2)}s (min ${MIN_PLAUSIBLE_SECONDS[missionId]}s)`);
      expect(run.completed).toBe(true);
      expect(run.maxFrameStepMeters).toBeLessThan(MAX_FRAME_STEP_METERS);
      expect(isPlausibleTime(missionId, run.lastCompletedTimeSeconds!)).toBe(true);
    }
    console.log(`[autopilot] expert driver (chevrolet_sprint_turbo)\n${rows.join('\n')}`);
  });
});
