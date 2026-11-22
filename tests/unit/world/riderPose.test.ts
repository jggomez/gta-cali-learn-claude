import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { computeMotorcycleBodyPose } from '../../../src/world/motorcycleMeshes';
import { applySeatedRiderPose, resolveRiderHipHeight } from '../../../src/world/riderPose';

function bone(name: string, y: number, x = 0): THREE.Bone {
  const b = new THREE.Bone();
  b.name = name;
  b.position.set(x, y, 0);
  return b;
}

/** Minimal Mixamo-like skeleton standing at the origin facing +Z. */
function createMixamoLikeRig(): { root: THREE.Group; bones: Record<string, THREE.Bone> } {
  const root = new THREE.Group();
  const hips = bone('mixamorigHips', 0.95);
  const spine = bone('mixamorigSpine', 0.2);
  hips.add(spine);
  const bones: Record<string, THREE.Bone> = { hips, spine };
  for (const side of ['Left', 'Right'] as const) {
    const sx = side === 'Left' ? 0.1 : -0.1;
    const upLeg = bone(`mixamorig${side}UpLeg`, -0.05, sx);
    const leg = bone(`mixamorig${side}Leg`, -0.45);
    const foot = bone(`mixamorig${side}Foot`, -0.42);
    hips.add(upLeg);
    upLeg.add(leg);
    leg.add(foot);
    const arm = bone(`mixamorig${side}Arm`, 0.3, sx * 1.6);
    const foreArm = bone(`mixamorig${side}ForeArm`, -0.28);
    const hand = bone(`mixamorig${side}Hand`, -0.25);
    spine.add(arm);
    arm.add(foreArm);
    foreArm.add(hand);
    bones[`${side}UpLeg`] = upLeg;
    bones[`${side}Leg`] = leg;
    bones[`${side}Arm`] = arm;
    bones[`${side}ForeArm`] = foreArm;
  }
  root.add(hips);
  root.updateMatrixWorld(true);
  return { root, bones };
}

function worldDirection(from: THREE.Object3D, to: THREE.Object3D): THREE.Vector3 {
  const a = from.getWorldPosition(new THREE.Vector3());
  const b = to.getWorldPosition(new THREE.Vector3());
  return b.sub(a).normalize();
}

describe('world/riderPose seated moto rider', () => {
  it('bends thighs forward, shins down, and reaches arms toward the bars', () => {
    const { root, bones } = createMixamoLikeRig();
    root.rotation.y = 0.7;
    root.updateMatrixWorld(true);
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(root.quaternion);

    applySeatedRiderPose(root);
    root.updateMatrixWorld(true);

    for (const side of ['Left', 'Right'] as const) {
      const thigh = worldDirection(bones[`${side}UpLeg`]!, bones[`${side}Leg`]!);
      expect(thigh.dot(forward)).toBeGreaterThan(0.75);
      const shin = worldDirection(bones[`${side}Leg`]!, bones[`${side}Leg`]!.children[0]!);
      expect(shin.y).toBeLessThan(-0.75);
      const upperArm = worldDirection(bones[`${side}Arm`]!, bones[`${side}ForeArm`]!);
      expect(upperArm.dot(forward)).toBeGreaterThan(0.4);
    }
  });

  it('measures hip height from the rig and falls back for procedural meshes', () => {
    const { root } = createMixamoLikeRig();
    expect(resolveRiderHipHeight(root)).toBeCloseTo(0.95, 3);
    expect(resolveRiderHipHeight(new THREE.Group())).toBeCloseTo(0.92, 3);
  });

  it('poses procedural fallback meshes through their userData limb pivots', () => {
    const root = new THREE.Group();
    const leftLeg = new THREE.Group();
    const rightArm = new THREE.Group();
    root.userData.leftLeg = leftLeg;
    root.userData.rightArm = rightArm;
    applySeatedRiderPose(root);
    expect(leftLeg.rotation.x).toBeLessThan(-1);
    expect(rightArm.rotation.x).toBeLessThan(-0.6);
  });
});

describe('world/motorcycleMeshes body pose', () => {
  it('rolls opposite to Three.js Z for a left lean and pivots wheelies on the rear tire', () => {
    const upright = computeMotorcycleBodyPose('yamaha_rx115', 0, 0);
    expect(upright).toEqual({ roll: 0, pitch: 0, lift: 0 });

    const leanLeft = computeMotorcycleBodyPose('yamaha_rx115', 0.5, 0);
    expect(leanLeft.roll).toBeCloseTo(-0.5, 6);

    const wheelie = computeMotorcycleBodyPose('yamaha_dt125', 0, 0.4);
    expect(wheelie.pitch).toBeCloseTo(-0.4, 6);
    expect(wheelie.lift).toBeGreaterThan(0.2);
    expect(wheelie.lift).toBeLessThan(0.4);
  });
});
