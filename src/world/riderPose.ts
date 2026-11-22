/**
 * Seated moto-rider pose for the player avatar (Valeria / Mateo GLB rigs or the procedural
 * fallback). Axis-agnostic: each limb bone is aimed in world space toward a target direction
 * expressed in the rider's local frame (thighs forward, shins to the pegs, arms to the bars), so
 * it works across Mixamo-style rigs without knowing their bone roll conventions. Call it after
 * the animation mixer update each frame; the mixer overwrites the override on the next update.
 */

import * as THREE from 'three';

const FALLBACK_HIP_HEIGHT_METERS = 0.92;
const FALLBACK_THIGH_PITCH_RAD = -1.35;
const FALLBACK_ARM_PITCH_RAD = -0.95;

interface LimbAim {
  readonly suffix: string;
  /** Target direction in rider space for the LEFT limb (+X); mirrored on X for the right side. */
  readonly direction: THREE.Vector3;
}

// Parents before children so each child aims from its already-posed parent.
const SEATED_LIMB_AIMS: readonly LimbAim[] = [
  { suffix: 'UpLeg', direction: new THREE.Vector3(0.15, -0.2, 1).normalize() },
  { suffix: 'Leg', direction: new THREE.Vector3(0, -1, -0.35).normalize() },
  { suffix: 'Arm', direction: new THREE.Vector3(0.25, -0.55, 1).normalize() },
  { suffix: 'ForeArm', direction: new THREE.Vector3(0.1, -0.3, 1).normalize() },
];

interface PosedBone {
  readonly bone: THREE.Bone;
  readonly child: THREE.Object3D;
  readonly direction: THREE.Vector3;
}

const scratchBonePos = new THREE.Vector3();
const scratchChildPos = new THREE.Vector3();
const scratchCurrentDir = new THREE.Vector3();
const scratchTargetDir = new THREE.Vector3();
const scratchRootQuat = new THREE.Quaternion();
const scratchBoneQuat = new THREE.Quaternion();
const scratchParentQuat = new THREE.Quaternion();
const scratchAimQuat = new THREE.Quaternion();

function findBoneBySuffix(root: THREE.Object3D, side: 'Left' | 'Right', suffix: string): THREE.Bone | null {
  const pattern = new RegExp(`${side}${suffix}$`);
  let found: THREE.Bone | null = null;
  root.traverse((node) => {
    if (!found && node instanceof THREE.Bone && pattern.test(node.name)) {
      found = node;
    }
  });
  return found;
}

function collectPosedBones(root: THREE.Object3D): readonly PosedBone[] {
  const cached = root.userData.seatedRiderBones as readonly PosedBone[] | undefined;
  if (cached) {
    return cached;
  }
  const posed: PosedBone[] = [];
  for (const aim of SEATED_LIMB_AIMS) {
    for (const side of ['Left', 'Right'] as const) {
      const bone = findBoneBySuffix(root, side, aim.suffix);
      const child = bone?.children.find((c) => c instanceof THREE.Bone);
      if (bone && child) {
        const direction = aim.direction.clone();
        if (side === 'Right') {
          direction.x = -direction.x;
        }
        posed.push({ bone, child, direction });
      }
    }
  }
  root.userData.seatedRiderBones = posed;
  return posed;
}

function aimBone(posed: PosedBone, rootQuat: THREE.Quaternion): void {
  const { bone, child, direction } = posed;
  bone.updateWorldMatrix(true, true);
  bone.getWorldPosition(scratchBonePos);
  child.getWorldPosition(scratchChildPos);
  scratchCurrentDir.subVectors(scratchChildPos, scratchBonePos);
  if (scratchCurrentDir.lengthSq() < 1e-10) {
    return;
  }
  scratchCurrentDir.normalize();
  scratchTargetDir.copy(direction).applyQuaternion(rootQuat);

  scratchAimQuat.setFromUnitVectors(scratchCurrentDir, scratchTargetDir);
  bone.getWorldQuaternion(scratchBoneQuat);
  scratchBoneQuat.premultiply(scratchAimQuat);
  if (bone.parent) {
    bone.parent.getWorldQuaternion(scratchParentQuat);
    scratchBoneQuat.premultiply(scratchParentQuat.invert());
  }
  bone.quaternion.copy(scratchBoneQuat);
  bone.updateWorldMatrix(false, true);
}

/** Bends the rider into a seated, bars-reaching pose (rigged bones or procedural limb pivots). */
export function applySeatedRiderPose(root: THREE.Object3D): void {
  const posedBones = collectPosedBones(root);
  if (posedBones.length === 0) {
    const legs = [root.userData.leftLeg, root.userData.rightLeg];
    const arms = [root.userData.leftArm, root.userData.rightArm];
    for (const leg of legs) {
      if (leg instanceof THREE.Object3D) leg.rotation.x = FALLBACK_THIGH_PITCH_RAD;
    }
    for (const arm of arms) {
      if (arm instanceof THREE.Object3D) arm.rotation.x = FALLBACK_ARM_PITCH_RAD;
    }
    return;
  }

  root.updateWorldMatrix(true, false);
  root.getWorldQuaternion(scratchRootQuat);
  for (const posed of posedBones) {
    aimBone(posed, scratchRootQuat);
  }
}

/** Hip height above the rider's feet origin (used to sit the hips on the moto seat). */
export function resolveRiderHipHeight(root: THREE.Object3D): number {
  const cached = root.userData.riderHipHeight as number | undefined;
  if (typeof cached === 'number') {
    return cached;
  }
  let hips: THREE.Bone | null = null;
  root.traverse((node) => {
    if (!hips && node instanceof THREE.Bone && /Hips$/.test(node.name)) {
      hips = node;
    }
  });
  let height = FALLBACK_HIP_HEIGHT_METERS;
  if (hips) {
    // World-space meters along the rider's up axis (independent of rig scale and lean)
    root.updateWorldMatrix(true, true);
    const hipsWorld = (hips as THREE.Bone).getWorldPosition(new THREE.Vector3());
    const rootWorld = root.getWorldPosition(new THREE.Vector3());
    const upWorld = new THREE.Vector3(0, 1, 0).applyQuaternion(
      root.getWorldQuaternion(new THREE.Quaternion()),
    );
    height = hipsWorld.sub(rootWorld).dot(upWorld);
  }
  root.userData.riderHipHeight = height;
  return height;
}
