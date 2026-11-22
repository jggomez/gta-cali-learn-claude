/**
 * Shared immutable domain contracts for GTA VI: Cali (La Sucursal del Cielo).
 * Zero external dependencies so simulation, missions, world, audio, and UI stay cleanly decoupled.
 */

export type GameMode =
  | 'title'
  | 'playing'
  | 'paused'
  | 'mission_passed'
  | 'busted'
  | 'victory';

export type MissionId =
  | 'mission_1_bulevar'
  | 'mission_2_cristo_rey'
  | 'mission_3_pique_bulevar'
  | 'free_roam';

export type RadioStationId = 'salsa_brava' | 'sucursal_synth' | 'off';

export type CameraMode = 'chase' | 'cinematic' | 'hood' | 'victory_orbit';

export type PlayerCarKind =
  | 'renault4_turbo'
  | 'spark_gt_turbo'
  | 'willys_v8'
  | 'banshee';

export type VehicleKind =
  | PlayerCarKind
  | 'taxi'
  | 'mio_bus'
  | 'chiva'
  | 'police';

export type VehicleRole = 'player' | 'traffic' | 'police' | 'racer';

export type CharacterAvatarId = 'valeria' | 'mateo';

export type CaliOutfitId =
  | 'urbano_cali'
  | 'escarlata'
  | 'azucarero'
  | 'tricolor'
  | 'guayabera';

export type TrafficLightPhase =
  | 'ns_green'
  | 'ns_yellow'
  | 'ew_green'
  | 'ew_yellow';

export interface GarageConfig {
  readonly carKind: PlayerCarKind;
  readonly paintHex: number;
  readonly neonHex: number;
  readonly avatar: CharacterAvatarId;
  readonly outfit: CaliOutfitId;
}

export interface StuntJumpDef {
  readonly id: string;
  readonly name: string;
  readonly x: number;
  readonly z: number;
  readonly heading: number;
  readonly length: number;
  readonly width: number;
  readonly minSpeedMps: number;
  readonly launchVy: number;
  readonly rewardCop: number;
}

export interface PayNSprayZone {
  readonly id: string;
  readonly name: string;
  readonly x: number;
  readonly z: number;
  readonly radius: number;
  readonly heading: number;
}

export interface RoadblockZone {
  readonly id: string;
  readonly name: string;
  readonly x: number;
  readonly z: number;
  readonly heading: number;
  readonly halfWidth: number;
}

export type PlayerMode = 'on_foot' | 'driving';

export type WantedLevel = 0 | 1 | 2 | 3;

export type TimeOfDay = 'golden_hour' | 'night';

export type FailureReason = 'busted' | 'time_up';

export type LandmarkId =
  | 'san_antonio'
  | 'torre_de_cali'
  | 'bulevar_del_rio'
  | 'la_ermita'
  | 'estadio_pascual'
  | 'cristo_rey';

export type ColliderKind = 'building' | 'landmark' | 'prop';

export type ObjectiveKind =
  | 'enter_vehicle'
  | 'reach_point'
  | 'escape_police'
  | 'explore';

export type ObjectivePropKind =
  | 'none'
  | 'vinyl_briefcase'
  | 'mateo_speakers'
  | 'summit_stage';

export type BannerAccent = 'gold' | 'cyan' | 'police' | 'emerald';

export type DialogueSpeaker = 'valeria' | 'mateo' | 'radio' | 'system';

export interface CheckpointBanner {
  readonly id: string;
  readonly title: string;
  readonly subtitle: string;
  readonly accent: BannerAccent;
  readonly remainingSeconds: number;
}

export interface PedestrianSnapshot {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly heading: number;
  readonly speedMps: number;
  readonly fleeing: boolean;
  readonly shirtColorHex: number;
  readonly pantsColorHex: number;
}

export interface Vec2 {
  readonly x: number;
  readonly z: number;
}

export interface SpawnPose {
  readonly x: number;
  readonly z: number;
  readonly heading: number;
}

export interface AabbCollider {
  readonly id: string;
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  readonly height: number;
  readonly kind: ColliderKind;
  readonly colorHex: number;
  readonly accentHex?: number;
  readonly label?: string;
}

export interface RoadSegment {
  readonly id: string;
  readonly name: string;
  readonly start: Vec2;
  readonly end: Vec2;
  readonly width: number;
  readonly hasMedian?: boolean;
  readonly isRamp?: boolean;
}

export interface BridgeSpan {
  readonly id: string;
  readonly name: string;
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  readonly deckElevation: number;
}

export interface RiverCorridor {
  readonly id: string;
  readonly name: string;
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  readonly waterLevel: number;
  readonly bridges: readonly BridgeSpan[];
}

export interface LandmarkDef {
  readonly id: LandmarkId;
  readonly name: string;
  readonly district: string;
  readonly position: Vec2;
  readonly elevation: number;
  readonly discoveryRadius: number;
  readonly colorHex: number;
  readonly accentHex: number;
  readonly footprintHalfX: number;
  readonly footprintHalfZ: number;
}

export interface TrafficRoute {
  readonly id: string;
  readonly vehicleKind: Exclude<VehicleKind, 'police'>;
  readonly speedMps: number;
  readonly colorHex: number;
  readonly accentHex?: number;
  readonly waypoints: readonly Vec2[];
}

export interface MissionWaypoint {
  readonly id: string;
  readonly landmarkId: LandmarkId;
  readonly x: number;
  readonly z: number;
  readonly radius: number;
  readonly district: string;
}

export interface MissionStartConfig {
  readonly playerSpawn: SpawnPose;
  readonly carSpawn: SpawnPose;
  readonly startInVehicle: boolean;
  readonly initialWantedStars: WantedLevel;
  readonly defaultTimeOfDay: TimeOfDay;
}

export interface MissionWaypointsConfig {
  readonly mission1Pickup: MissionWaypoint;
  readonly mission1Escape: MissionWaypoint;
  readonly mission1Finish: MissionWaypoint;
  readonly mission1Hideout: MissionWaypoint;
  readonly mission2Stage: MissionWaypoint;
  readonly mission2RingBridge: MissionWaypoint;
  readonly mission2RingBulevar: MissionWaypoint;
  readonly mission2RampEntry: MissionWaypoint;
  readonly mission2Summit: MissionWaypoint;
  readonly mission3Checkpoints?: readonly MissionWaypoint[];
}

export interface CaliMapConfig {
  readonly worldHalfSize: number;
  readonly river: RiverCorridor;
  readonly landmarks: readonly LandmarkDef[];
  readonly roads: readonly RoadSegment[];
  readonly buildingColliders: readonly AabbCollider[];
  readonly playerStart: SpawnPose;
  readonly playerCarSpawn: SpawnPose;
  readonly missionStarts: Readonly<Record<MissionId, MissionStartConfig>>;
  readonly missionWaypoints: MissionWaypointsConfig;
  readonly policeSpawns: readonly SpawnPose[];
  readonly trafficRoutes: readonly TrafficRoute[];
  readonly stuntJumps?: readonly StuntJumpDef[];
  readonly payNSprayZones?: readonly PayNSprayZone[];
  readonly roadblockZones?: readonly RoadblockZone[];
}

export interface InputState {
  readonly forward: boolean;
  readonly backward: boolean;
  readonly left: boolean;
  readonly right: boolean;
  readonly handbrake: boolean;
  readonly boost: boolean;
  readonly interactPressed: boolean;
  readonly hornPressed?: boolean;
}

export interface CameraLookInput {
  readonly yawDelta: number;
  readonly pitchDelta: number;
  readonly zoomDelta: number;
}

export interface VehicleSnapshot {
  readonly id: string;
  readonly kind: VehicleKind;
  readonly role: VehicleRole;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly heading: number;
  readonly speedMps: number;
  readonly speedKmh: number;
  readonly steerAngle: number;
  readonly isDrifting: boolean;
  readonly isBoosting: boolean;
  /** Nitro charge percentage (0..100). */
  readonly nitro: number;
  readonly sirenActive: boolean;
  readonly colorHex: number;
  readonly accentHex?: number;
  readonly neonHex?: number;
  readonly airborneHeight?: number;
  readonly halfWidth: number;
  readonly halfLength: number;
}

export interface PlayerSnapshot {
  readonly mode: PlayerMode;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly heading: number;
  readonly speedMps: number;
  readonly speedKmh: number;
  readonly vehicleId: string | null;
  readonly nearbyVehicleId: string | null;
  readonly nearbyVehicleKind?: VehicleKind | null;
  readonly canEnterVehicle: boolean;
  /** Nitro charge percentage (0..100). */
  readonly nitro: number;
  readonly isDrifting: boolean;
  readonly isBoosting: boolean;
  readonly isSprinting: boolean;
  readonly inRiverHazard: boolean;
}

export interface WorldSnapshot {
  readonly timeSeconds: number;
  readonly player: PlayerSnapshot;
  readonly vehicles: readonly VehicleSnapshot[];
  readonly pedestrians?: readonly PedestrianSnapshot[];
  readonly wantedStars: WantedLevel;
  readonly bustProgress: number;
  readonly policeEvadeProgress?: number;
  readonly isBusted: boolean;
  readonly driftScore: number;
  readonly topSpeedKmh: number;
  readonly currentDistrict: string;
  readonly collisionImpact: number;
  readonly driftComboMultiplier?: number;
  readonly driftBankPendingCop?: number;
  readonly lastDriftCashoutCop?: number;
  readonly airborneSeconds?: number;
  readonly lastStuntJumpName?: string | null;
  readonly lastStuntJumpCop?: number;
  readonly lastStuntJumpAt?: number;
  readonly lastPayNSprayAt?: number;
  readonly lastPayNSprayName?: string | null;
  readonly roadblockActive?: boolean;
  readonly racePosition?: number | null;
  readonly raceTotalRacers?: number;
  readonly hornActive?: boolean;
  readonly trafficLightPhase?: TrafficLightPhase;
}

export interface ObjectiveSnapshot {
  readonly id: string;
  readonly kind: ObjectiveKind;
  readonly label: string;
  readonly detail: string;
  readonly target: Vec2 | null;
  readonly radius: number;
  readonly landmarkId: LandmarkId | null;
  readonly stepIndex: number;
  readonly totalSteps: number;
  readonly beaconColorHex: number;
  readonly distanceMeters?: number | null;
  readonly bearingDeltaRad?: number | null;
  readonly gpsRoute?: readonly Vec2[];
  readonly propKind?: ObjectivePropKind;
  readonly requiresOnFoot?: boolean;
}

export interface DialogueToast {
  readonly id: string;
  readonly speaker: DialogueSpeaker;
  readonly text: string;
  readonly remainingSeconds: number;
}

export type BestTimesMap = Readonly<Partial<Record<MissionId, number>>>;

export interface MissionSnapshot {
  readonly mode: GameMode;
  readonly activeMission: MissionId;
  readonly missionTitle: string;
  readonly activeObjective: ObjectiveSnapshot | null;
  readonly targetWantedStars: WantedLevel;
  readonly completedMissions: readonly MissionId[];
  readonly bestTimes: BestTimesMap;
  readonly discoveredLandmarks: readonly LandmarkId[];
  readonly dialogue: DialogueToast | null;
  readonly banner?: CheckpointBanner | null;
  readonly viralTicker: string;
  readonly rewardCop: number;
  readonly cashCop: number;
  readonly timerSeconds: number;
  readonly elapsedSeconds: number;
  readonly lastCompletedTimeSeconds: number | null;
  readonly isNewRecord: boolean;
  readonly timeOfDay?: TimeOfDay;
  readonly isCountdown?: boolean;
  readonly failureReason?: FailureReason | null;
}

export interface AudioState {
  readonly station: RadioStationId;
  readonly stationLabel: string;
  readonly muted: boolean;
  readonly voicesEnabled?: boolean;
  readonly masterVolume: number;
  readonly unlocked: boolean;
}

export interface StorageRecords {
  readonly version: 1;
  readonly bestTimes: Partial<Record<MissionId, number>>;
  readonly completedMissions: MissionId[];
  readonly discoveredLandmarks: LandmarkId[];
  readonly totalCashCop: number;
  readonly preferredStation: RadioStationId;
  readonly muted: boolean;
  readonly voicesEnabled?: boolean;
  readonly garage?: GarageConfig;
}

export interface GameDebugSnapshot {
  readonly mode: GameMode;
  readonly cameraMode: CameraMode;
  readonly world: WorldSnapshot;
  readonly mission: MissionSnapshot;
  readonly audio: AudioState;
  readonly fps: number;
  readonly assetsLoaded?: boolean;
  readonly garage?: GarageConfig;
}
