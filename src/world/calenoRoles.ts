/**
 * Static ambient Caleño role NPCs rendered by the world (no simulation state): cholado vendors
 * behind their carts, a salsa group dancing on Bulevar del Río, a tinto seller with his thermos,
 * and people resting on promenade benches. Animation is throttled by distance (LOD).
 */

import * as THREE from 'three';
import type { LoadedCharacterAsset } from './assetLoader';
import {
  resolveCharacterLod,
  type AmbientRoleSpot,
  type CharacterLod,
} from './calenoPeople';
import { applySeatedPose, attachTintoThermos } from './calenoWardrobe';
import {
  createCalenoCharacterRig,
  createValeriaPlayerMesh,
  retargetMixamoClips,
  type CalenoCharacterOptions,
  type RiggedCharacterRig,
} from './vehicleMeshes';

export interface AmbientRoleAssets {
  readonly valeria: LoadedCharacterAsset | null;
  readonly caleno: LoadedCharacterAsset | null;
  readonly donor: LoadedCharacterAsset | null;
}

export interface AmbientRoleMember {
  readonly spot: AmbientRoleSpot;
  readonly group: THREE.Group;
  /** Null for static poses (bench sitters) that never need mixer updates. */
  readonly mixer: THREE.AnimationMixer | null;
  readonly danceAction: THREE.AnimationAction | null;
  readonly meshes: readonly THREE.Mesh[];
  pendingDt: number;
  castShadow: boolean;
}

const BENCH_HIP_HEIGHT_METERS = 0.6;

const CALENO_ROLE_LOOKS: readonly CalenoCharacterOptions[] = [
  { outfit: 'esqueleto_blanco', headAccessory: 'gorra', skinToneHex: 0x8c5a3c, pantsHex: 0x2a3b56, headwearHex: 0xc8102e },
  { outfit: 'guayabera', headAccessory: 'none', skinToneHex: 0xa86f4c, pantsHex: 0xb8a27a, showBeard: true },
  { outfit: 'azucarero', headAccessory: 'gorra_reversa', skinToneHex: 0x6e4630, pantsHex: 0x1e1e24, headwearHex: 0x0b7a3e, sunglasses: true },
  { outfit: 'camisa_salsera', headAccessory: 'none', skinToneHex: 0xc48b66, pantsHex: 0x1e1e24, showBeard: false },
];

function collectMeshes(root: THREE.Object3D): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  root.traverse((node) => {
    if (node instanceof THREE.Mesh && node.name !== 'contact_shadow') {
      meshes.push(node);
    }
  });
  return meshes;
}

interface BonePoseEntry {
  readonly bone: THREE.Bone;
  readonly position: THREE.Vector3;
  readonly quaternion: THREE.Quaternion;
}

function snapshotBonePose(root: THREE.Object3D): BonePoseEntry[] {
  const pose: BonePoseEntry[] = [];
  root.traverse((node) => {
    if (node instanceof THREE.Bone) {
      pose.push({ bone: node, position: node.position.clone(), quaternion: node.quaternion.clone() });
    }
  });
  return pose;
}

function restoreBonePose(pose: readonly BonePoseEntry[]): void {
  for (const entry of pose) {
    entry.bone.position.copy(entry.position);
    entry.bone.quaternion.copy(entry.quaternion);
  }
}

function playLooping(action: THREE.AnimationAction | undefined, startTime: number): THREE.AnimationAction | null {
  if (!action) {
    return null;
  }
  action.reset().setLoop(THREE.LoopRepeat, Infinity).play();
  action.time = startTime % Math.max(action.getClip().duration, 0.01);
  return action;
}

export class AmbientRoleCast {
  readonly group = new THREE.Group();
  private readonly cast: AmbientRoleMember[] = [];
  private frameParity = 0;

  constructor(
    private readonly assets: AmbientRoleAssets,
    spots: readonly AmbientRoleSpot[],
    groundHeight: (x: number, z: number) => number,
  ) {
    this.group.name = 'ambient_caleno_roles';
    spots.forEach((spot, index) => {
      const member = this.createMember(spot, index);
      if (!member) {
        return;
      }
      member.group.position.set(spot.x, groundHeight(spot.x, spot.z), spot.z);
      member.group.rotation.y = spot.heading;
      member.group.userData.ambientRole = spot.role;
      this.group.add(member.group);
      this.cast.push(member);
    });
  }

  get members(): readonly AmbientRoleMember[] {
    return this.cast;
  }

  private buildCaleno(index: number): RiggedCharacterRig | null {
    const { caleno, donor } = this.assets;
    if (!caleno) {
      return null;
    }
    const look = CALENO_ROLE_LOOKS[index % CALENO_ROLE_LOOKS.length] ?? {};
    return createCalenoCharacterRig(caleno, donor, { ...look, showHeadwear: false });
  }

  private buildCalena(index: number, outfitOverride?: 'camisa_salsera' | 'escarlata'): RiggedCharacterRig | null {
    const { valeria, donor } = this.assets;
    if (!valeria) {
      return null;
    }
    const outfits = ['urbano_cali', 'camisa_salsera', 'camiseta_seleccion', 'escarlata'] as const;
    return createValeriaPlayerMesh(valeria, donor, {
      outfit: outfitOverride ?? outfits[index % outfits.length],
      ...(index % 3 === 1 ? { skinToneHex: 0xa86f4c } : {}),
    });
  }

  /** Retargets Valeria's native SambaDance onto a Caleño so salsa couples dance together. */
  private calenoDanceAction(rig: RiggedCharacterRig): THREE.AnimationAction | undefined {
    const { valeria, caleno } = this.assets;
    if (!valeria || !caleno) {
      return undefined;
    }
    const clip = retargetMixamoClips(valeria, caleno.scene).find((c) => c.name === 'SambaDance');
    const modelRoot = rig.group.getObjectByName('caleno_model_root')?.children[0];
    return clip && modelRoot ? rig.mixer.clipAction(clip, modelRoot) : undefined;
  }

  private createMember(spot: AmbientRoleSpot, index: number): AmbientRoleMember | null {
    const preferCaleno = index % 2 === 0;
    let rig: RiggedCharacterRig | null = null;
    let danceAction: THREE.AnimationAction | null = null;
    let mixer: THREE.AnimationMixer | null = null;
    const phase = index * 0.37;

    switch (spot.role) {
      case 'salsa_dancer': {
        const dancerIsCaleno = index % 2 === 1;
        rig = dancerIsCaleno
          ? (this.buildCaleno(3) ?? this.buildCalena(index, 'camisa_salsera'))
          : (this.buildCalena(index, index % 4 === 0 ? 'camisa_salsera' : 'escarlata') ?? this.buildCaleno(3));
        if (rig) {
          rig.mixer.stopAllAction();
          const dance = rig.actions.dance ?? (dancerIsCaleno ? this.calenoDanceAction(rig) : undefined);
          danceAction = playLooping(dance ?? rig.actions.idle, phase);
          mixer = rig.mixer;
        }
        break;
      }
      case 'tinto_vendor': {
        rig = this.buildCaleno(0) ?? this.buildCalena(index);
        if (rig) {
          attachTintoThermos(rig.group);
          mixer = rig.mixer;
        }
        break;
      }
      case 'bench_sitter': {
        rig = preferCaleno ? (this.buildCaleno(index) ?? this.buildCalena(index)) : (this.buildCalena(index) ?? this.buildCaleno(index));
        if (rig) {
          // Freeze an idle frame (arms relaxed). Stopping the mixer restores the bind pose, so
          // snapshot the idle pose first and reapply it before bending into the seated pose.
          rig.mixer.update(phase);
          const idlePose = snapshotBonePose(rig.group);
          rig.mixer.stopAllAction();
          rig.mixer.uncacheRoot(rig.mixer.getRoot());
          restoreBonePose(idlePose);
          const modelRoot = rig.group.children.find((child) => child.name.endsWith('_model_root'));
          if (modelRoot) {
            applySeatedPose(rig.group, modelRoot, BENCH_HIP_HEIGHT_METERS);
          }
        }
        break;
      }
      case 'cholado_vendor': {
        rig = preferCaleno ? (this.buildCaleno(index) ?? this.buildCalena(index)) : (this.buildCalena(index) ?? this.buildCaleno(index));
        if (rig) {
          mixer = rig.mixer;
        }
        break;
      }
    }

    if (!rig) {
      return null;
    }
    rig.group.name = `role_${spot.id}`;
    mixer?.update(phase);
    return {
      spot,
      group: rig.group,
      mixer,
      danceAction,
      meshes: collectMeshes(rig.group),
      pendingDt: 0,
      castShadow: true,
    };
  }

  /** Distance LOD: full-rate animation up close, half rate mid-range, frozen far, hidden beyond 95 m. */
  update(dt: number, focusX: number, focusZ: number, reducedMotion: boolean): void {
    this.frameParity = (this.frameParity + 1) % 2;
    for (const [index, member] of this.cast.entries()) {
      const dx = member.spot.x - focusX;
      const dz = member.spot.z - focusZ;
      const lod: CharacterLod = resolveCharacterLod(dx * dx + dz * dz);
      member.group.visible = lod.visible;
      if (member.castShadow !== lod.castShadow) {
        member.castShadow = lod.castShadow;
        for (const mesh of member.meshes) {
          mesh.castShadow = lod.castShadow;
        }
      }
      if (!member.mixer || reducedMotion || lod.updateInterval === 0) {
        member.pendingDt = 0;
        continue;
      }
      member.pendingDt += dt;
      if (lod.updateInterval === 1 || index % 2 === this.frameParity) {
        member.mixer.update(member.pendingDt);
        member.pendingDt = 0;
      }
    }
  }

  dispose(): void {
    for (const member of this.cast) {
      member.mixer?.stopAllAction();
      member.mixer?.uncacheRoot(member.mixer.getRoot());
    }
    this.cast.length = 0;
    this.group.parent?.remove(this.group);
    this.group.clear();
  }
}
