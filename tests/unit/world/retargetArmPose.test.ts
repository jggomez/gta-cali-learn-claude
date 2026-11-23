import * as THREE from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { beforeAll, describe, expect, it } from 'vitest';
import type { LoadedCharacterAsset } from '../../../src/world/assetLoader';
import { retargetMixamoClips } from '../../../src/world/vehicleMeshes';
import { loadRealGlbForHeadlessTest } from '../../helpers/headlessGlb';

/**
 * caleno.glb (Ready Player Me) rests in an A-pose while the Mixamo locomotion source
 * (character.glb) and valeria.glb rest in a T-pose. Retargeted clips must land the arms in the
 * same body-relative pose on both rigs (no arms crossed through the torso).
 */

interface ArmPose {
  /** Angle (deg) between the upper arm and the spine's up direction. */
  readonly upperArmFromSpine: number;
  /** Angle (deg) between the forearm and the spine's up direction. */
  readonly foreArmFromSpine: number;
  /** Signed lateral offset of each hand from the hips along the body's left axis (meters, rig-normalized). */
  readonly leftHandLateral: number;
  readonly rightHandLateral: number;
}

function findBone(root: THREE.Object3D, name: string): THREE.Bone {
  let hit: THREE.Bone | null = null;
  root.traverse((node) => {
    if (!hit && (node as THREE.Bone).isBone && node.name.replace(/^mixamorig:?/, '') === name) {
      hit = node as THREE.Bone;
    }
  });
  if (!hit) throw new Error(`bone ${name} missing`);
  return hit;
}

function worldPos(bone: THREE.Bone): THREE.Vector3 {
  return bone.getWorldPosition(new THREE.Vector3());
}

function samplePose(asset: LoadedCharacterAsset, clip: THREE.AnimationClip, time: number): ArmPose {
  const root = SkeletonUtils.clone(asset.scene);
  const mixer = new THREE.AnimationMixer(root);
  mixer.clipAction(clip).play();
  mixer.update(time);
  root.updateMatrixWorld(true);

  const hips = worldPos(findBone(root, 'Hips'));
  const neck = worldPos(findBone(root, 'Neck'));
  const up = neck.clone().sub(hips).normalize();
  const leftAxis = worldPos(findBone(root, 'LeftUpLeg')).sub(worldPos(findBone(root, 'RightUpLeg')));
  const legSpan = leftAxis.length();
  leftAxis.normalize();

  const arm = worldPos(findBone(root, 'LeftArm'));
  const fore = worldPos(findBone(root, 'LeftForeArm'));
  const hand = worldPos(findBone(root, 'LeftHand'));
  const rightHand = worldPos(findBone(root, 'RightHand'));
  const deg = (v: THREE.Vector3) => THREE.MathUtils.radToDeg(v.normalize().angleTo(up));

  return {
    upperArmFromSpine: deg(fore.clone().sub(arm)),
    foreArmFromSpine: deg(hand.clone().sub(fore)),
    leftHandLateral: hand.clone().sub(hips).dot(leftAxis) / legSpan,
    rightHandLateral: rightHand.clone().sub(hips).dot(leftAxis) / legSpan,
  };
}

describe('retargetMixamoClips arm pose across T-pose and A-pose rigs', () => {
  let soldier: LoadedCharacterAsset;
  let caleno: LoadedCharacterAsset;
  let valeria: LoadedCharacterAsset;

  beforeAll(async () => {
    [soldier, caleno, valeria] = await Promise.all([
      loadRealGlbForHeadlessTest('public/models/character.glb'),
      loadRealGlbForHeadlessTest('public/models/caleno.glb'),
      loadRealGlbForHeadlessTest('public/models/valeria.glb'),
    ]);
  });

  for (const clipName of ['Idle', 'Walk', 'Run'] as const) {
    it(`keeps caleno.glb arms beside the body like valeria.glb in ${clipName}`, () => {
      const calenoClip = retargetMixamoClips(soldier, caleno.scene).find((c) => c.name === clipName);
      const valeriaClip = retargetMixamoClips(soldier, valeria.scene).find((c) => c.name === clipName);
      expect(calenoClip).toBeDefined();
      expect(valeriaClip).toBeDefined();

      for (const fraction of [0.1, 0.35, 0.6, 0.85]) {
        const t = calenoClip!.duration * fraction;
        const male = samplePose(caleno, calenoClip!, t);
        const female = samplePose(valeria, valeriaClip!, t);

        // Arms hang down (well below horizontal) and match the reference rig's swing.
        expect(male.upperArmFromSpine).toBeGreaterThan(120);
        expect(Math.abs(male.upperArmFromSpine - female.upperArmFromSpine)).toBeLessThan(20);
        expect(Math.abs(male.foreArmFromSpine - female.foreArmFromSpine)).toBeLessThan(30);
        // Hands track the reference rig and stay on their own side (never crossed over the torso).
        expect(Math.abs(male.leftHandLateral - female.leftHandLateral)).toBeLessThan(0.35);
        expect(Math.abs(male.rightHandLateral - female.rightHandLateral)).toBeLessThan(0.35);
        if (clipName !== 'Run') {
          // Running pumps the hands toward the chest midline; idle/walk keep them at the sides.
          expect(male.leftHandLateral).toBeGreaterThan(0.4);
          expect(male.rightHandLateral).toBeLessThan(-0.4);
        }
      }
    });
  }
});
