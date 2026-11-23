import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { loadRealGlbForHeadlessTest } from '../../helpers/headlessGlb';
import type { LoadedCharacterAsset } from '../../../src/world/assetLoader';
import {
  createCalenoCharacterRig,
  createValeriaPlayerMesh,
  type RiggedCharacterRig,
} from '../../../src/world/vehicleMeshes';
import {
  LOCOMOTION_CLIP_GROUND_SPEED_MPS,
  resolveLocomotionPlayback,
} from '../../../src/world/calenoPeople';

interface GaitSample {
  readonly minFootY: number;
  readonly maxFootY: number;
  readonly minHipY: number;
  readonly minHeadMinusHip: number;
  readonly leftFootStrideZ: number;
  readonly plantedFootSpeed: number;
}

function findBone(root: THREE.Object3D, mixamoName: string): THREE.Object3D {
  let found: THREE.Object3D | undefined;
  root.traverse((node) => {
    if (!found && node.name.replace(/^mixamorig:?/, '') === mixamoName) {
      found = node;
    }
  });
  if (!found) {
    throw new Error(`Bone ${mixamoName} not found`);
  }
  return found;
}

/** Plays one full loop of a clip and samples world-space foot/hip/head positions. */
function sampleGait(rig: RiggedCharacterRig, clip: 'idle' | 'walk' | 'run'): GaitSample {
  const action = rig.actions[clip];
  if (!action) {
    throw new Error(`Missing ${clip} action`);
  }
  rig.mixer.stopAllAction();
  action.reset().play();
  const duration = action.getClip().duration;
  const steps = 48;
  const dt = duration / steps;
  const leftFoot = findBone(rig.group, 'LeftFoot');
  const rightFoot = findBone(rig.group, 'RightFoot');
  const hips = findBone(rig.group, 'Hips');
  const head = findBone(rig.group, 'Head');
  const l = new THREE.Vector3();
  const r = new THREE.Vector3();
  const h = new THREE.Vector3();
  const hd = new THREE.Vector3();

  let minFootY = Infinity;
  let maxFootY = -Infinity;
  let minHipY = Infinity;
  let minHeadMinusHip = Infinity;
  const leftRelZ: number[] = [];
  const leftY: number[] = [];
  rig.mixer.update(0);
  for (let i = 0; i <= steps; i += 1) {
    rig.group.updateMatrixWorld(true);
    leftFoot.getWorldPosition(l);
    rightFoot.getWorldPosition(r);
    hips.getWorldPosition(h);
    head.getWorldPosition(hd);
    minFootY = Math.min(minFootY, l.y, r.y);
    maxFootY = Math.max(maxFootY, l.y, r.y);
    minHipY = Math.min(minHipY, h.y);
    minHeadMinusHip = Math.min(minHeadMinusHip, hd.y - h.y);
    leftRelZ.push(l.z - h.z);
    leftY.push(l.y);
    rig.mixer.update(dt);
  }
  const plantedThreshold = Math.min(...leftY) + 0.03;
  const plantedSpeeds: number[] = [];
  for (let i = 1; i < leftRelZ.length; i += 1) {
    if ((leftY[i] ?? Infinity) < plantedThreshold) {
      plantedSpeeds.push(Math.abs(((leftRelZ[i] ?? 0) - (leftRelZ[i - 1] ?? 0)) / dt));
    }
  }
  plantedSpeeds.sort((a, b) => a - b);
  return {
    minFootY,
    maxFootY,
    minHipY,
    minHeadMinusHip,
    leftFootStrideZ: Math.max(...leftRelZ) - Math.min(...leftRelZ),
    plantedFootSpeed: plantedSpeeds[Math.floor(plantedSpeeds.length / 2)] ?? 0,
  };
}

describe('retargeted on-foot locomotion (real GLBs)', () => {
  let assets: { valeria: LoadedCharacterAsset; caleno: LoadedCharacterAsset; donor: LoadedCharacterAsset } | null =
    null;
  const load = async () => {
    if (!assets) {
      const [valeria, caleno, donor] = await Promise.all([
        loadRealGlbForHeadlessTest('public/models/valeria.glb'),
        loadRealGlbForHeadlessTest('public/models/caleno.glb'),
        loadRealGlbForHeadlessTest('public/models/character.glb'),
      ]);
      assets = { valeria, caleno, donor };
    }
    return assets;
  };

  const builders = {
    valeria: (a: NonNullable<typeof assets>) => createValeriaPlayerMesh(a.valeria, a.donor),
    caleno: (a: NonNullable<typeof assets>) => createCalenoCharacterRig(a.caleno, a.donor),
  } as const;

  for (const [label, build] of Object.entries(builders)) {
    for (const clip of ['idle', 'walk', 'run'] as const) {
      it(`${label} ${clip}: stays upright with feet grounded below the hips`, async () => {
        const rig = build(await load());
        const gait = sampleGait(rig, clip);
        expect(gait.minFootY).toBeGreaterThan(-0.05);
        expect(gait.minFootY).toBeLessThan(0.2);
        expect(gait.maxFootY).toBeLessThan(gait.minHipY);
        expect(gait.minHipY).toBeGreaterThan(0.7);
        // Rest pose head-to-hip bone distance is ~0.34 m (Valeria) to ~0.55 m (Caleño).
        expect(gait.minHeadMinusHip).toBeGreaterThan(0.25);
      }, 30000);
    }

    for (const clip of ['walk', 'run'] as const) {
      it(`${label} ${clip}: animates the leg bones with a real stride matching the playback constant`, async () => {
        const rig = build(await load());
        const gait = sampleGait(rig, clip);
        expect(gait.leftFootStrideZ).toBeGreaterThan(0.6);
        const expected = LOCOMOTION_CLIP_GROUND_SPEED_MPS[clip];
        expect(gait.plantedFootSpeed).toBeGreaterThan(expected * 0.7);
        expect(gait.plantedFootSpeed).toBeLessThan(expected * 1.3);
      }, 30000);
    }
  }
});

describe('resolveLocomotionPlayback', () => {
  it('idles at rest with normal time scale', () => {
    expect(resolveLocomotionPlayback(0, false)).toEqual({ state: 'idle', timeScale: 1 });
    expect(resolveLocomotionPlayback(0.2, false).state).toBe('idle');
  });

  it('walks slowly and runs fast, scaling playback to ground speed so feet do not slide', () => {
    const walk = resolveLocomotionPlayback(LOCOMOTION_CLIP_GROUND_SPEED_MPS.walk, false);
    expect(walk).toEqual({ state: 'walk', timeScale: 1 });
    const run = resolveLocomotionPlayback(6.5, false);
    expect(run.state).toBe('run');
    expect(run.timeScale).toBeCloseTo(6.5 / LOCOMOTION_CLIP_GROUND_SPEED_MPS.run, 5);
  });

  it('forces the run clip while sprinting and clamps extreme playback rates', () => {
    const sprint = resolveLocomotionPlayback(10.5, true);
    expect(sprint.state).toBe('run');
    expect(sprint.timeScale).toBeLessThanOrEqual(2.4);
    expect(sprint.timeScale).toBeGreaterThan(1.5);
  });

  it('plays the gait in reverse when backing up', () => {
    const back = resolveLocomotionPlayback(-4.5, false);
    expect(back.state).toBe('run');
    expect(back.timeScale).toBeLessThan(0);
    expect(Math.abs(back.timeScale)).toBeCloseTo(4.5 / LOCOMOTION_CLIP_GROUND_SPEED_MPS.run, 5);
  });

  it('is safe for non-finite speeds', () => {
    expect(resolveLocomotionPlayback(Number.NaN, false)).toEqual({ state: 'idle', timeScale: 1 });
  });
});
