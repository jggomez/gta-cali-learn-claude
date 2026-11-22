/**
 * Profile-driven sculpted PBR builder for the classic (80s-90s) fast Cali street fleet:
 * Mazda 323 Coupé, Renault 18 GTX, Chevrolet Sprint Turbo, Chevrolet Monza, Nissan Sentra B13,
 * Chevette Turbo, and Renault Twingo. One parameterized builder keeps every silhouette DRY while
 * the body profile (length, width, wheelbase, roof/belt heights, hood/trunk lengths, hatch |
 * sedan | coupe greenhouse, headlight/grille style, spoiler, rally lights) makes each car
 * instantly recognizable. Honors the shared vehicle userData contract (wheels, frontWheels,
 * nitroFlames, headlightCones, brakeLightMaterials, underglowMaterial).
 */

import * as THREE from 'three';
import type { ClassicCarKind } from '../types/game';
import {
  addMesh,
  attachCabinInterior,
  attachClosedCabinPillars,
  attachContactShadow,
  attachDoorHandles,
  attachHeadlightCones,
  attachPlayerNitroFlames,
  attachSideMirrors,
  attachUnderglow,
  attachVehicleLicensePlates,
  attachWheels,
  createBrakeLightMaterial,
  createCarPaintMaterial,
  createCarbonMaterial,
  createChromeMaterial,
  createCurvedSideExtrude,
  createFlaredWheelArchGeometry,
  createRoundedPodGeometry,
  createSmokedCabinGlassMaterial,
  createXenonHeadlightMaterial,
} from './vehicleMeshes';

export type ClassicBodyStyle = 'hatch' | 'sedan' | 'coupe';
export type ClassicHeadlightStyle = 'popup' | 'rect' | 'quad_rect' | 'round' | 'frog_oval';
export type ClassicGrilleStyle = 'slats' | 'mesh' | 'badge_bar';
export type ClassicSpoilerStyle = 'none' | 'trunk_lip' | 'trunk_wing' | 'roof';

export interface ClassicCarProfile {
  readonly bodyStyle: ClassicBodyStyle;
  readonly length: number;
  readonly width: number;
  readonly wheelbase: number;
  readonly wheelRadius: number;
  readonly wheelWidth: number;
  /** Top of the lower hull (beltline) in meters. */
  readonly beltY: number;
  readonly roofY: number;
  /** Nose to windshield base. */
  readonly hoodLength: number;
  /** Tail to rear-glass base (small for hatchbacks). */
  readonly trunkLength: number;
  /** Wedge drop of the hood leading edge below the beltline. */
  readonly noseDrop: number;
  readonly headlights: ClassicHeadlightStyle;
  readonly grille: ClassicGrilleStyle;
  readonly spoiler: ClassicSpoilerStyle;
  readonly chromeBumpers: boolean;
  readonly rallyLights: 0 | 2 | 4;
  readonly hoodScoop: boolean;
  readonly sideStripe: boolean;
  readonly tailLights: 'pair' | 'bar';
  readonly dualExhaust: boolean;
  readonly rimHex: number;
  readonly caliperHex: number;
  readonly plateCode: string;
}

export const CLASSIC_CAR_PROFILES: Readonly<Record<ClassicCarKind, ClassicCarProfile>> = {
  mazda_323_coupe: {
    bodyStyle: 'coupe',
    length: 4.2,
    width: 1.66,
    wheelbase: 2.45,
    wheelRadius: 0.31,
    wheelWidth: 0.22,
    beltY: 0.86,
    roofY: 1.32,
    hoodLength: 1.15,
    trunkLength: 0.55,
    noseDrop: 0.14,
    headlights: 'popup',
    grille: 'mesh',
    spoiler: 'trunk_lip',
    chromeBumpers: false,
    rallyLights: 0,
    hoodScoop: false,
    sideStripe: true,
    tailLights: 'bar',
    dualExhaust: true,
    rimHex: 0xd9e1f2,
    caliperHex: 0xe11d38,
    plateCode: 'MZD · 323',
  },
  renault_18_gtx: {
    bodyStyle: 'sedan',
    length: 4.4,
    width: 1.7,
    wheelbase: 2.44,
    wheelRadius: 0.32,
    wheelWidth: 0.21,
    beltY: 0.9,
    roofY: 1.4,
    hoodLength: 1.1,
    trunkLength: 0.95,
    noseDrop: 0.06,
    headlights: 'quad_rect',
    grille: 'slats',
    spoiler: 'trunk_lip',
    chromeBumpers: true,
    rallyLights: 0,
    hoodScoop: false,
    sideStripe: false,
    tailLights: 'pair',
    dualExhaust: false,
    rimHex: 0xc0c7d4,
    caliperHex: 0x2b2f3a,
    plateCode: 'RGT · 018',
  },
  chevrolet_sprint_turbo: {
    bodyStyle: 'hatch',
    length: 3.6,
    width: 1.56,
    wheelbase: 2.25,
    wheelRadius: 0.29,
    wheelWidth: 0.2,
    beltY: 0.84,
    roofY: 1.36,
    hoodLength: 0.85,
    trunkLength: 0.18,
    noseDrop: 0.08,
    headlights: 'rect',
    grille: 'mesh',
    spoiler: 'roof',
    chromeBumpers: false,
    rallyLights: 4,
    hoodScoop: true,
    sideStripe: true,
    tailLights: 'pair',
    dualExhaust: false,
    rimHex: 0xc89a4b,
    caliperHex: 0xe11d38,
    plateCode: 'SPT · 101',
  },
  chevrolet_monza: {
    bodyStyle: 'sedan',
    length: 4.36,
    width: 1.68,
    wheelbase: 2.57,
    wheelRadius: 0.31,
    wheelWidth: 0.21,
    beltY: 0.88,
    roofY: 1.38,
    hoodLength: 1.12,
    trunkLength: 0.9,
    noseDrop: 0.1,
    headlights: 'rect',
    grille: 'slats',
    spoiler: 'none',
    chromeBumpers: true,
    rallyLights: 0,
    hoodScoop: false,
    sideStripe: true,
    tailLights: 'bar',
    dualExhaust: false,
    rimHex: 0xe6edf8,
    caliperHex: 0x2b2f3a,
    plateCode: 'MNZ · 486',
  },
  nissan_sentra_b13: {
    bodyStyle: 'sedan',
    length: 4.3,
    width: 1.66,
    wheelbase: 2.43,
    wheelRadius: 0.31,
    wheelWidth: 0.22,
    beltY: 0.88,
    roofY: 1.4,
    hoodLength: 1.05,
    trunkLength: 0.85,
    noseDrop: 0.08,
    headlights: 'rect',
    grille: 'badge_bar',
    spoiler: 'trunk_wing',
    chromeBumpers: false,
    rallyLights: 2,
    hoodScoop: false,
    sideStripe: false,
    tailLights: 'pair',
    dualExhaust: true,
    rimHex: 0x2b2f3a,
    caliperHex: 0xe11d38,
    plateCode: 'SNT · 913',
  },
  chevette_turbo: {
    bodyStyle: 'coupe',
    length: 4.16,
    width: 1.58,
    wheelbase: 2.39,
    wheelRadius: 0.3,
    wheelWidth: 0.22,
    beltY: 0.86,
    roofY: 1.34,
    hoodLength: 1.2,
    trunkLength: 0.7,
    noseDrop: 0.1,
    headlights: 'round',
    grille: 'slats',
    spoiler: 'trunk_wing',
    chromeBumpers: false,
    rallyLights: 2,
    hoodScoop: true,
    sideStripe: true,
    tailLights: 'pair',
    dualExhaust: true,
    rimHex: 0xf5c542,
    caliperHex: 0xe11d38,
    plateCode: 'CHV · 160',
  },
  renault_twingo: {
    bodyStyle: 'hatch',
    length: 3.43,
    width: 1.63,
    wheelbase: 2.35,
    wheelRadius: 0.29,
    wheelWidth: 0.19,
    beltY: 0.86,
    roofY: 1.42,
    hoodLength: 0.7,
    trunkLength: 0.12,
    noseDrop: 0.18,
    headlights: 'frog_oval',
    grille: 'badge_bar',
    spoiler: 'roof',
    chromeBumpers: false,
    rallyLights: 0,
    hoodScoop: false,
    sideStripe: false,
    tailLights: 'pair',
    dualExhaust: false,
    rimHex: 0xd9e1f2,
    caliperHex: 0x2b2f3a,
    plateCode: 'TWG · 093',
  },
};

const SILL_Y = 0.28;
const HULL_BEVEL = 0.06;
const WINDSHIELD_RAKE: Readonly<Record<ClassicBodyStyle, number>> = {
  hatch: 1.0,
  sedan: 1.15,
  coupe: 1.6,
};
const REAR_GLASS_RAKE: Readonly<Record<ClassicBodyStyle, number>> = {
  hatch: 0.35,
  sedan: 0.9,
  coupe: 1.7,
};

interface ClassicMaterials {
  readonly body: THREE.MeshPhysicalMaterial;
  readonly accent: THREE.MeshPhysicalMaterial;
  readonly carbon: THREE.MeshStandardMaterial;
  readonly chrome: THREE.MeshPhysicalMaterial;
  readonly glass: THREE.MeshPhysicalMaterial;
  readonly headlight: THREE.MeshStandardMaterial;
  readonly brake: THREE.MeshStandardMaterial;
  readonly rally: THREE.MeshStandardMaterial;
  readonly bumper: THREE.Material;
}

/** Derived greenhouse stations along Z (front to back). */
interface CabinStations {
  readonly halfLength: number;
  readonly windshieldBaseZ: number;
  readonly windshieldTopZ: number;
  readonly rearGlassTopZ: number;
  readonly rearGlassBaseZ: number;
}

function createClassicMaterials(colorHex: number, accentHex: number, chromeBumpers: boolean): ClassicMaterials {
  const chrome = createChromeMaterial();
  const carbon = createCarbonMaterial();
  return {
    body: createCarPaintMaterial(colorHex, { metalness: 0.5, roughness: 0.26 }),
    accent: createCarPaintMaterial(accentHex, { metalness: 0.4, roughness: 0.32, clearcoat: 0.7 }),
    carbon,
    chrome,
    glass: createSmokedCabinGlassMaterial(),
    headlight: createXenonHeadlightMaterial(),
    brake: createBrakeLightMaterial(),
    rally: new THREE.MeshStandardMaterial({
      color: 0xfff4d6,
      emissive: 0xffd27a,
      emissiveIntensity: 1.6,
      roughness: 0.14,
    }),
    bumper: chromeBumpers ? chrome : carbon,
  };
}

function computeCabinStations(profile: ClassicCarProfile): CabinStations {
  const halfLength = profile.length * 0.5;
  const glassHeight = profile.roofY - profile.beltY;
  const windshieldBaseZ = halfLength - profile.hoodLength;
  const rearGlassBaseZ = -halfLength + profile.trunkLength;
  return {
    halfLength,
    windshieldBaseZ,
    windshieldTopZ: windshieldBaseZ - glassHeight * WINDSHIELD_RAKE[profile.bodyStyle],
    rearGlassBaseZ,
    rearGlassTopZ: rearGlassBaseZ + glassHeight * REAR_GLASS_RAKE[profile.bodyStyle],
  };
}

function resolveHeadlightY(profile: ClassicCarProfile): number {
  const hoodFrontY = profile.beltY - profile.noseDrop;
  if (profile.headlights === 'popup') return hoodFrontY + 0.08;
  if (profile.headlights === 'frog_oval') return hoodFrontY + 0.01;
  return hoodFrontY - 0.14;
}

/** Boxy 80s lower hull: flat sills, upright bumper faces, wedge hood, flat (or hatch) deck. */
function attachLowerHull(group: THREE.Group, kind: ClassicCarKind, profile: ClassicCarProfile, stations: CabinStations, mats: ClassicMaterials): void {
  const hl = stations.halfLength;
  const belt = profile.beltY;
  const hoodFrontY = belt - profile.noseDrop;
  const deckRearY = profile.bodyStyle === 'hatch' ? belt : belt - 0.03;
  const hullGeo = createCurvedSideExtrude(
    (shape) => {
      shape.moveTo(-hl + 0.1, SILL_Y);
      shape.lineTo(hl - 0.1, SILL_Y);
      shape.quadraticCurveTo(hl, SILL_Y, hl, SILL_Y + 0.12);
      shape.lineTo(hl, hoodFrontY - 0.08);
      shape.quadraticCurveTo(hl, hoodFrontY, hl - 0.12, hoodFrontY);
      shape.lineTo(stations.windshieldBaseZ, belt);
      shape.lineTo(stations.rearGlassBaseZ, belt);
      shape.lineTo(-hl + 0.1, deckRearY);
      shape.quadraticCurveTo(-hl, deckRearY, -hl, deckRearY - 0.1);
      shape.lineTo(-hl, SILL_Y + 0.12);
      shape.quadraticCurveTo(-hl, SILL_Y, -hl + 0.1, SILL_Y);
      shape.closePath();
    },
    profile.width - HULL_BEVEL,
    HULL_BEVEL,
  );
  addMesh(group, hullGeo, mats.body, { name: `${kind}_hull` });
}

/** Upright, flat-glass 80s greenhouse with painted roof cap and solid A/B/C pillars. */
function attachGreenhouse(group: THREE.Group, kind: ClassicCarKind, profile: ClassicCarProfile, stations: CabinStations, mats: ClassicMaterials): void {
  const glassWidth = profile.width - 0.24;
  const bottomY = profile.beltY - 0.04;
  const glassGeo = createCurvedSideExtrude(
    (shape) => {
      shape.moveTo(stations.rearGlassBaseZ, bottomY);
      shape.lineTo(stations.windshieldBaseZ, bottomY);
      shape.lineTo(stations.windshieldTopZ, profile.roofY);
      shape.lineTo(stations.rearGlassTopZ, profile.roofY);
      shape.closePath();
    },
    glassWidth,
    0.03,
  );
  addMesh(group, glassGeo, mats.glass, { name: `${kind}_cabin_glass`, castShadow: false });

  const roofLength = stations.windshieldTopZ - stations.rearGlassTopZ + 0.08;
  addMesh(
    group,
    createRoundedPodGeometry(glassWidth + 0.08, 0.09, roofLength, 0.03, 0.015),
    mats.body,
    {
      y: profile.roofY + 0.01,
      z: (stations.windshieldTopZ + stations.rearGlassTopZ) * 0.5,
      name: `${kind}_roof`,
    },
  );

  const midZ = (stations.windshieldTopZ + stations.rearGlassTopZ) * 0.5;
  attachClosedCabinPillars(group, mats.body, {
    groupName: `${kind}_pillars`,
    glassWidth,
    bottomY,
    topY: profile.roofY,
    frontBottomZ: stations.windshieldBaseZ,
    frontCtrlZ: (stations.windshieldBaseZ + stations.windshieldTopZ) * 0.5,
    frontCtrlY: (bottomY + profile.roofY) * 0.5,
    frontTopZ: stations.windshieldTopZ,
    rearTopZ: stations.rearGlassTopZ,
    rearCtrlZ: (stations.rearGlassTopZ + stations.rearGlassBaseZ) * 0.5,
    rearCtrlY: (bottomY + profile.roofY) * 0.5,
    rearBottomZ: stations.rearGlassBaseZ,
    midPillarZs: profile.bodyStyle === 'sedan' ? [midZ + 0.05, midZ - 0.55] : [midZ - 0.12],
    pillarWidthX: 0.12,
    rearThicknessZ: profile.bodyStyle === 'hatch' ? 0.16 : 0.22,
  });
}

function attachHeadlights(group: THREE.Group, profile: ClassicCarProfile, stations: CabinStations, mats: ClassicMaterials): void {
  const hl = stations.halfLength;
  const lampY = resolveHeadlightY(profile);
  const faceZ = hl + HULL_BEVEL + 0.01;
  const lampX = profile.width * 0.32;

  for (const side of [-1, 1] as const) {
    switch (profile.headlights) {
      case 'popup': {
        // Iconic raised pop-up pods (body colored) with forward lenses
        addMesh(group, createRoundedPodGeometry(0.38, 0.15, 0.24, 0.03, 0.012), mats.body, {
          x: side * lampX,
          y: lampY,
          z: hl - 0.22,
        });
        addMesh(group, new THREE.BoxGeometry(0.32, 0.1, 0.03), mats.headlight, {
          x: side * lampX,
          y: lampY,
          z: hl - 0.09,
          castShadow: false,
        });
        addMesh(group, new THREE.BoxGeometry(0.22, 0.05, 0.04), mats.rally, {
          x: side * (lampX + 0.08),
          y: 0.5,
          z: faceZ + 0.06,
          castShadow: false,
        });
        break;
      }
      case 'rect':
      case 'quad_rect': {
        const lamps = profile.headlights === 'quad_rect'
          ? [profile.width * 0.22, profile.width * 0.37]
          : [lampX];
        const lensWidth = profile.headlights === 'quad_rect' ? 0.17 : 0.34;
        for (const lx of lamps) {
          addMesh(group, new THREE.BoxGeometry(lensWidth + 0.04, 0.17, 0.05), mats.chrome, {
            x: side * lx,
            y: lampY,
            z: faceZ,
            castShadow: false,
          });
          addMesh(group, new THREE.BoxGeometry(lensWidth, 0.13, 0.04), mats.headlight, {
            x: side * lx,
            y: lampY,
            z: faceZ + 0.02,
            castShadow: false,
          });
        }
        break;
      }
      case 'round': {
        const bezelGeo = new THREE.CylinderGeometry(0.11, 0.11, 0.05, 18);
        bezelGeo.rotateX(Math.PI / 2);
        const lensGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.04, 18);
        lensGeo.rotateX(Math.PI / 2);
        addMesh(group, bezelGeo, mats.chrome, { x: side * lampX, y: lampY, z: faceZ, castShadow: false });
        addMesh(group, lensGeo, mats.headlight, { x: side * lampX, y: lampY, z: faceZ + 0.02, castShadow: false });
        break;
      }
      case 'frog_oval': {
        // Twingo "frog-eye" ovals sitting on the hood leading edge
        const lensGeo = new THREE.SphereGeometry(0.12, 14, 10);
        addMesh(group, lensGeo, mats.headlight, {
          x: side * profile.width * 0.3,
          y: lampY,
          z: hl - 0.06,
          sx: 1.25,
          sy: 0.7,
          sz: 0.6,
          castShadow: false,
        });
        break;
      }
    }
  }
}

function attachFrontFascia(group: THREE.Group, profile: ClassicCarProfile, stations: CabinStations, mats: ClassicMaterials): void {
  const hl = stations.halfLength;
  const faceZ = hl + HULL_BEVEL;
  const hoodFrontY = profile.beltY - profile.noseDrop;
  const grilleY = profile.headlights === 'popup' || profile.headlights === 'frog_oval'
    ? 0.58
    : hoodFrontY - 0.14;

  const grilleWidth = profile.grille === 'badge_bar' ? profile.width * 0.3 : profile.width * 0.36;
  addMesh(group, createRoundedPodGeometry(grilleWidth, 0.14, 0.06, 0.03, 0.01), mats.carbon, {
    y: grilleY,
    z: faceZ,
    name: 'classic_grille',
  });
  const slatCount = profile.grille === 'slats' ? 3 : profile.grille === 'mesh' ? 5 : 1;
  for (let i = 0; i < slatCount; i += 1) {
    addMesh(group, new THREE.BoxGeometry(grilleWidth * 0.92, 0.012, 0.02), mats.chrome, {
      y: grilleY - 0.05 + (i * 0.1) / Math.max(1, slatCount - 1),
      z: faceZ + 0.035,
      castShadow: false,
    });
  }

  attachHeadlights(group, profile, stations, mats);

  // Full-width bumper (chrome for the older sedans, matte black for the tuned "pique" cars)
  addMesh(group, createRoundedPodGeometry(profile.width + 0.04, 0.16, 0.18, 0.05, 0.02), mats.bumper, {
    y: 0.42,
    z: hl + 0.04,
    name: 'classic_front_bumper',
  });

  if (profile.rallyLights === 2) {
    const rallyGeo = new THREE.CylinderGeometry(0.075, 0.075, 0.06, 16);
    rallyGeo.rotateX(Math.PI / 2);
    for (const side of [-1, 1] as const) {
      addMesh(group, rallyGeo, mats.rally, {
        x: side * profile.width * 0.18,
        y: 0.56,
        z: hl + 0.14,
        castShadow: false,
      });
    }
  }
}

function attachRallyRoofBar(group: THREE.Group, profile: ClassicCarProfile, stations: CabinStations, mats: ClassicMaterials): void {
  if (profile.rallyLights !== 4) {
    return;
  }
  const barZ = stations.windshieldTopZ - 0.1;
  const barY = profile.roofY + 0.12;
  addMesh(group, new THREE.BoxGeometry(profile.width * 0.8, 0.04, 0.05), mats.carbon, { y: barY - 0.06, z: barZ });
  const podGeo = new THREE.CylinderGeometry(0.085, 0.085, 0.08, 16);
  podGeo.rotateX(Math.PI / 2);
  const lensGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.02, 16);
  lensGeo.rotateX(Math.PI / 2);
  for (const fraction of [-0.3, -0.1, 0.1, 0.3] as const) {
    const x = profile.width * fraction;
    addMesh(group, podGeo, mats.carbon, { x, y: barY, z: barZ });
    addMesh(group, lensGeo, mats.rally, { x, y: barY, z: barZ + 0.05, castShadow: false });
  }
}

function attachRearFascia(group: THREE.Group, profile: ClassicCarProfile, stations: CabinStations, mats: ClassicMaterials): void {
  const hl = stations.halfLength;
  const faceZ = -hl - HULL_BEVEL;
  const tailY = profile.beltY - 0.17;

  if (profile.tailLights === 'bar') {
    addMesh(group, createRoundedPodGeometry(profile.width * 0.86, 0.12, 0.05, 0.03, 0.01), mats.brake, {
      y: tailY,
      z: faceZ - 0.01,
      castShadow: false,
      name: 'classic_tail_bar',
    });
  } else {
    for (const side of [-1, 1] as const) {
      addMesh(group, createRoundedPodGeometry(profile.width * 0.24, 0.16, 0.05, 0.03, 0.01), mats.brake, {
        x: side * profile.width * 0.33,
        y: tailY,
        z: faceZ - 0.01,
        castShadow: false,
      });
    }
  }

  addMesh(group, createRoundedPodGeometry(profile.width + 0.04, 0.16, 0.18, 0.05, 0.02), mats.bumper, {
    y: 0.42,
    z: -hl - 0.04,
    name: 'classic_rear_bumper',
  });
}

function attachSpoiler(group: THREE.Group, profile: ClassicCarProfile, stations: CabinStations, mats: ClassicMaterials): void {
  const hl = stations.halfLength;
  switch (profile.spoiler) {
    case 'none':
      return;
    case 'trunk_lip':
      addMesh(group, createRoundedPodGeometry(profile.width * 0.86, 0.05, 0.14, 0.02, 0.01), mats.carbon, {
        y: profile.beltY + 0.02,
        z: -hl + 0.12,
        rx: -0.12,
        name: 'classic_spoiler',
      });
      return;
    case 'trunk_wing':
      for (const side of [-1, 1] as const) {
        addMesh(group, new THREE.BoxGeometry(0.05, 0.2, 0.12), mats.carbon, {
          x: side * profile.width * 0.36,
          y: profile.beltY + 0.1,
          z: -hl + 0.2,
        });
      }
      addMesh(group, createRoundedPodGeometry(profile.width * 0.9, 0.05, 0.26, 0.02, 0.01), mats.accent, {
        y: profile.beltY + 0.22,
        z: -hl + 0.18,
        rx: 0.1,
        name: 'classic_spoiler',
      });
      return;
    case 'roof':
      addMesh(group, createRoundedPodGeometry(profile.width * 0.82, 0.05, 0.22, 0.02, 0.01), mats.carbon, {
        y: profile.roofY + 0.04,
        z: stations.rearGlassTopZ - 0.06,
        rx: 0.18,
        name: 'classic_spoiler',
      });
      return;
  }
}

function attachBodyDetails(group: THREE.Group, profile: ClassicCarProfile, stations: CabinStations, mats: ClassicMaterials): void {
  const hullHalfWidth = (profile.width - HULL_BEVEL) * 0.5 + HULL_BEVEL * 0.5;

  if (profile.hoodScoop) {
    addMesh(group, createRoundedPodGeometry(0.52, 0.08, 0.5, 0.03, 0.015), mats.carbon, {
      y: profile.beltY - profile.noseDrop * 0.5 + 0.04,
      z: (stations.halfLength + stations.windshieldBaseZ) * 0.5,
      rx: Math.atan2(profile.noseDrop, profile.hoodLength),
      name: 'classic_hood_scoop',
    });
  }

  if (profile.sideStripe) {
    for (const side of [-1, 1] as const) {
      addMesh(group, new THREE.BoxGeometry(0.02, 0.06, profile.length * 0.78), mats.accent, {
        x: side * (hullHalfWidth + 0.01),
        y: profile.beltY - 0.14,
        castShadow: false,
        name: 'classic_side_stripe',
      });
    }
  }

  // Body-colored wheel-arch lips
  const archGeo = createFlaredWheelArchGeometry(profile.wheelRadius + 0.04, 0.07, 0.12);
  for (const side of [-1, 1] as const) {
    for (const wz of [profile.wheelbase * 0.5, -profile.wheelbase * 0.5] as const) {
      addMesh(group, archGeo, mats.body, {
        x: side * (hullHalfWidth - 0.02),
        y: profile.wheelRadius,
        z: wz,
      });
    }
  }

  attachSideMirrors(
    group,
    profile.width * 0.5 - 0.04,
    profile.beltY + 0.08,
    stations.windshieldBaseZ - 0.12,
    mats.body,
    mats.carbon,
    0.85,
  );
  const frontDoorZ = (stations.windshieldBaseZ + stations.windshieldTopZ) * 0.5 - 0.45;
  attachDoorHandles(
    group,
    hullHalfWidth + 0.01,
    profile.beltY - 0.07,
    frontDoorZ,
    profile.bodyStyle === 'sedan' ? frontDoorZ - 0.95 : undefined,
    mats.chrome,
  );
}

/**
 * Builds a classic Cali fast car from its body profile. `neonHex` adds player underglow.
 */
export function buildClassicCarMesh(
  kind: ClassicCarKind,
  colorHex: number,
  accentHex: number,
  neonHex?: number,
): THREE.Group {
  const profile = CLASSIC_CAR_PROFILES[kind];
  const stations = computeCabinStations(profile);
  const mats = createClassicMaterials(colorHex, accentHex, profile.chromeBumpers);
  const group = new THREE.Group();
  group.name = `vehicle_${kind}`;

  attachLowerHull(group, kind, profile, stations, mats);
  attachGreenhouse(group, kind, profile, stations, mats);
  attachFrontFascia(group, profile, stations, mats);
  attachRallyRoofBar(group, profile, stations, mats);
  attachRearFascia(group, profile, stations, mats);
  attachSpoiler(group, profile, stations, mats);
  attachBodyDetails(group, profile, stations, mats);

  const midCabinZ = (stations.windshieldTopZ + stations.rearGlassTopZ) * 0.5;
  attachCabinInterior(group, {
    seatY: 0.5,
    seatZ: midCabinZ - 0.05,
    dashZ: stations.windshieldBaseZ - 0.25,
    width: profile.width - 0.42,
  });

  const hl = stations.halfLength;
  attachVehicleLicensePlates(
    group,
    profile.plateCode,
    'private_yellow',
    { y: 0.42, z: hl + 0.16 },
    { y: 0.6, z: -hl - 0.08 },
  );

  const exhaustOffsets = profile.dualExhaust
    ? [-profile.width * 0.26, profile.width * 0.26]
    : [profile.width * 0.26];
  const nitroFlames = attachPlayerNitroFlames(group, exhaustOffsets, 0.3, -hl - 0.1, mats.chrome);
  const headlightCones = attachHeadlightCones(
    group,
    profile.width * 0.32,
    resolveHeadlightY(profile),
    hl + 0.12,
    4.6,
    0.9,
  );
  attachContactShadow(group, profile.width + 0.35, profile.length + 0.25, 0.6, 0.03);
  attachUnderglow(group, profile.width + 0.3, profile.length + 0.1, neonHex);

  const wheelX = profile.width * 0.5 - profile.wheelWidth * 0.3;
  const axleZ = profile.wheelbase * 0.5;
  const rig = attachWheels(
    group,
    [
      { x: -wheelX, z: axleZ, isFront: true },
      { x: wheelX, z: axleZ, isFront: true },
      { x: -wheelX, z: -axleZ, isFront: false },
      { x: wheelX, z: -axleZ, isFront: false },
    ],
    profile.wheelRadius,
    profile.wheelWidth,
    profile.caliperHex,
    profile.rimHex,
  );

  group.userData.nitroFlames = nitroFlames;
  group.userData.headlightCones = headlightCones;
  group.userData.brakeLightMaterials = [mats.brake];
  group.userData.wheels = rig.wheels;
  group.userData.frontWheels = rig.frontWheels;
  return group;
}

/** Headlight emitter height (meters) used by the renderer's player spotlight. */
export function getClassicHeadlightHeight(kind: ClassicCarKind): number {
  return resolveHeadlightY(CLASSIC_CAR_PROFILES[kind]);
}
