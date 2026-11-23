/**
 * English player-facing copy for GTA I - Cali - Colombia (La Sucursal del Cielo).
 * Same shape as `localeEs.ts`. City/advertising copy (billboards, #CaliViral, radio, street
 * shouts) is shared from `localeCity.ts` and intentionally stays in Español Caleño. Characters keep
 * speaking Caleño Spanish; these dialogue texts are the English subtitles.
 */

import type { GaragePaintPreset, LocaleCaliShape, LocaleDevhackShape } from './localeEs';
import { CITY_COPY } from './localeCity';

export const LOCALE_CALI_EN: LocaleCaliShape = {
  brand: {
    title: 'GTA I - Cali - Colombia',
    subtitle: 'La Sucursal del Cielo',
    tagline: 'Valle del Cauca sunsets, salsa brava and speed with no brakes.',
    cityName: 'Santiago de Cali',
  },

  devhackAds: CITY_COPY.devhackAds,

  learningWorld: CITY_COPY.learningWorld,

  languageToggle: {
    label: 'Language',
    es: 'ES',
    en: 'EN',
    esName: 'Español',
    enName: 'English',
    note: 'The city, radio and voices stay in Caleño Spanish',
  },

  titleScreen: {
    loading: 'Loading the streets of Cali...',
    noRecord: 'No record',
    emptyTime: '--:--',
    completedBadge: 'Completed',
    bestTimePrefix: 'Best time',
    controlsTitle: 'Cali controls',
    playCta: 'Start',
  },

  controls: [
    { keys: 'WASD / Arrows', action: 'Drive or walk' },
    { keys: 'Space', action: 'Drift / Handbrake' },
    { keys: 'Shift', action: 'Nitro / Sprint' },
    { keys: 'F', action: 'Get in or out of the car' },
    { keys: 'H', action: 'Horn' },
    { keys: 'G', action: 'Cali Garage' },
    { keys: 'R', action: 'Change FM station' },
    { keys: 'V', action: 'Voices on / off' },
    { keys: 'C', action: 'Change camera' },
    { keys: 'T', action: 'Toggle day / night' },
    { keys: 'Esc', action: 'Pause' },
  ],

  missions: {
    mission_1_bulevar: {
      title: 'Heist at the Tower',
      subtitle: 'Mission 01 · Downtown & Cali River',
      description:
        'Steal the master vinyl on foot in front of Torre de Cali, escape in your ride over the La Ermita bridge and hide out in San Antonio.',
      rewardCop: 250_000,
      badge: 'Mission 1',
    },
    mission_2_cristo_rey: {
      title: 'Salsa Night at Cristo Rey',
      subtitle: 'Mission 02 · Stadium & Cerro Los Cristales',
      description:
        'A 95-second night time trial from Estadio Pascual Guerrero through turbo rings, with the cops on your tail, up to the lit-up Cristo Rey.',
      rewardCop: 500_000,
      badge: 'Mission 2',
    },
    mission_3_pique_bulevar: {
      title: 'Street Race on the Bulevar',
      subtitle: 'Mission 03 · Cali Street Circuit',
      description:
        'Go wheel to wheel through 6 checkpoints from Bulevar del Río past La Ermita, Granada and Calle Quinta — with a police ambush.',
      rewardCop: 400_000,
      badge: 'Mission 3',
    },
    mission_5_golpe_prompt: {
      title: 'The Prompt Heist',
      subtitle: 'Mission 05 · Granada, Stadium, El Peñón & Downtown',
      description:
        'Build the perfect prompt: grab Role, Context, Task and Format all over Cali with the cops behind you, and hand it to the AI at Banco Sucursal IA.',
      rewardCop: 600_000,
      badge: 'Mission 5',
    },
    free_roam: {
      title: 'Free Roam in Cali',
      subtitle: 'Explore · 6 Cali Landmarks',
      description:
        'Cruise Santiago de Cali at your own pace, discover the 6 landmarks, pull some drifts and enjoy Cali radio.',
      rewardCop: 0,
      badge: 'Free Roam',
    },
  },

  objectives: {
    mission1: {
      enterVehicleLabel: 'Get in the Banshee in San Antonio',
      enterVehicleDetail: "Press [F] next to Valeria's neon sports car.",
      pickupLabel: 'Reach Torre de Cali',
      pickupDetail: 'Drive down from San Antonio to Avenida Las Américas.',
      bulevarLabel: 'Blast across Bulevar del Río',
      bulevarDetail: 'The cops launched an operation! Head down Avenida Colombia.',
      escapeLabel: 'Escape to La Ermita church',
      escapeDetail: 'Cross the La Ermita bridge, dodge the patrols and reach the church steps.',
      heistOnFootLabel: 'Steal the master vinyl on foot at Torre de Cali',
      heistOnFootDetail: 'Walk up to the golden briefcase on Avenida Las Américas, in front of the Tower.',
      boardGetawayLabel: 'Get in your getaway ride',
      boardGetawayDetail: 'The alarm went off! Run to the sports car on the corner and press [F] to escape.',
      crossBridgeLabel: 'Cross the La Ermita bridge',
      crossBridgeDetail: 'Go down Avenida Colombia, dodge the cops and cross the Cali River to La Ermita.',
      hideoutLabel: 'Hide out in Barrio San Antonio',
      hideoutDetail: 'Head back west with the vinyl and lie low at the San Antonio safe house.',
    },
    mission2: {
      enterVehicleLabel: 'Fire up the engine for the party',
      enterVehicleDetail: 'Press [F] to get in the sports car and arm the nitro.',
      stageLabel: 'Pick up Mateo at Estadio Pascual',
      stageDetail: 'Cross the south bridge to Calle 5, in front of Estadio Pascual Guerrero.',
      ringBridgeLabel: 'Fly through the turbo ring on Puente Bulevar Sur',
      ringBridgeDetail: 'Launch west on Calle 5 and cross the ring over the Cali River (+10s and Nitro).',
      ringBulevarLabel: 'Cross the turbo ring on Bulevar del Río',
      ringBulevarDetail: 'Floor it north on Avenida Colombia to the second ring (+10s and Nitro).',
      rampLabel: 'Take the ramp to Cristo Rey',
      rampDetail: 'Turn west on Av. Circunvalar (Calle 13) to climb Cerro Los Cristales.',
      summitLabel: 'Climb to the Cristo Rey lookout',
      summitDetail: 'Take the west ramp up Cerro Los Cristales to the summit.',
    },
    mission3: {
      raceLabel: 'Street race on the Bulevar',
      raceDetail: 'Beat the street racers through all 6 checkpoints to the finish.',
      checkpointLabel: (index: number, total: number) => `Checkpoint ${index}/${total}`,
      checkpointDetail: (district: string) => `Speed toward ${district} and keep the lead.`,
      ambushDetail: "The cops set up a roadblock in Granada! Don't lift off the gas until the finish.",
      finishLabel: 'Cross the finish line on Bulevar del Río',
      finishDetail: 'Final straight down Avenida Colombia! Hit the nitro and win the race.',
    },
    mission5: {
      pieceLabel: (piece: string, have: number) => `Grab the ${piece} piece (${have}/4)`,
      pieceDetail: (district: string) =>
        `Go to ${district}. A good prompt has 4 pieces: role, context, task and format.`,
      bankLabel: 'Deliver the prompt to Banco Sucursal IA',
      bankDetail: 'You have all 4 pieces. Take them downtown and let the bank AI work its magic.',
      pieces: { rol: 'ROLE', contexto: 'CONTEXT', tarea: 'TASK', formato: 'FORMAT' },
    },
    freeRoam: {
      exploreLabel: 'Explore La Sucursal del Cielo',
      exploreDetail: 'Discover the 6 Cali landmarks, pull drifts and turn up the volume.',
      allDiscoveredLabel: 'You know all of Cali, parce!',
      allDiscoveredDetail: 'Every landmark discovered. Keep burning nitro around the city.',
    },
  },

  speakers: {
    valeria: 'Valeria',
    mateo: 'Mateo',
    radio: 'Radio',
    system: 'System',
  },

  dialogues: {
    m1Intro: {
      speaker: 'valeria',
      text: "What's up, parce! Run to Torre de Cali on foot and grab the golden vinyl before the cops show up.",
    },
    m1Pickup: {
      speaker: 'mateo',
      text: 'We got it! But careful, the cops already have sirens going on Bulevar del Río. Hit the nitro!',
    },
    m1Bulevar: {
      speaker: 'valeria',
      text: 'What a crossing at La Ermita! Now floor it to the San Antonio safe house and we lose them.',
    },
    m1Passed: {
      speaker: 'mateo',
      text: 'We nailed it, parce! Nobody catches us in La Sucursal del Cielo. Next stop: Cristo Rey!',
    },
    m1Alarm: {
      speaker: 'valeria',
      text: 'I have the master vinyl! The Tower alarm went off — run to your ride before the cops arrive!',
    },
    m1EscapeCar: {
      speaker: 'mateo',
      text: "That's it! Floor it down Avenida Colombia, cross the La Ermita bridge and we hide in San Antonio.",
    },
    m2Intro: {
      speaker: 'mateo',
      text: 'Tonight all of Cali is shaking! Pick me up at Estadio Pascual Guerrero, the speakers are ready.',
    },
    m2Launch: {
      speaker: 'mateo',
      text: 'Clock is ticking! We leave the Pascual with the cops on us: fly through the turbo rings to Cristo Rey.',
    },
    m2Ring1: {
      speaker: 'valeria',
      text: 'What a run over Puente Bulevar Sur! Ten extra seconds and full nitro: head for Bulevar del Río.',
    },
    m2Ring2: {
      speaker: 'mateo',
      text: 'Second ring done, parce! Line up on Av. Circunvalar — the ramp to Cristo Rey is lit up.',
    },
    m2Stage: {
      speaker: 'mateo',
      text: 'Turn that sound up! The cops want to ruin the party: go west up the ramp to Cristo Rey!',
    },
    m2Ramp: {
      speaker: 'valeria',
      text: "That's the ramp to Cerro Los Cristales! Hit the nitro all the way to the Cristo Rey lookout.",
    },
    m2Passed: {
      speaker: 'valeria',
      text: 'Look at that view from Cristo Rey! Salsa brava at full blast and all of Cali at our feet.',
    },
    m5Intro: {
      speaker: 'valeria',
      text: 'The bank AI only obeys a perfect prompt: Role, Context, Task and Format. Grab all 4 pieces before the cops catch us!',
    },
    m5Piece: {
      speaker: 'mateo',
      text: 'Piece secured, parce! Without context Claude guesses; with all 4 pieces it gets you on the first try.',
    },
    m5Bank: {
      speaker: 'valeria',
      text: "Prompt complete! Role, context, task and format. Let's go downtown and hand it to the bank.",
    },
    m5Passed: {
      speaker: 'valeria',
      text: '"Act as a teller (role). We\'re from Cali and it\'s payday (context). Open the vault (task). Answer in one line (format)." And it opened! That\'s how you ask Claude.',
    },
    m3Intro: {
      speaker: 'valeria',
      text: "Warm up those tires, parce! The street race starts on the Bulevar, through La Ermita and Granada. Leave them eating smoke!",
    },
    m3Ambush: {
      speaker: 'mateo',
      text: 'Heads up, parce! The cops put patrols in Granada and on the bridges — floor it!',
    },
    m3Passed: {
      speaker: 'valeria',
      text: "We won the Bulevar race! Nobody in Cali beats this machine.",
    },
    payNSpray: {
      speaker: 'mateo',
      text: "Sick new paint job, parce! Zero stars and a fresh shine: the cops don't even recognize us.",
    },
    stuntJump: {
      speaker: 'valeria',
      text: 'What an epic jump! All of La Sucursal del Cielo was looking up.',
    },
    freeRoamIntro: {
      speaker: 'valeria',
      text: "Relax! All of Cali is yours: San Antonio, the Bulevar, La Ermita, the Pascual and Cristo Rey.",
    },
    freeRoamTourPassed: {
      speaker: 'valeria',
      text: 'You toured all of Cali! All 6 landmarks done — Reto AcaDevHack complete!',
    },
    freeRoamWanted: {
      speaker: 'mateo',
      text: 'Watch out! The cops are after you all over Cali. Speed up and lose them in the blocks!',
    },
    freeRoamEscaped: {
      speaker: 'valeria',
      text: 'We left them in the dust! Now you can cruise Cali in peace.',
    },
    landmarkDiscovered: (landmarkName: string) => ({
      speaker: 'system',
      text: `You discovered ${landmarkName}! Pure Caleño pride, parce.`,
    }),
    riverWarning: {
      speaker: 'mateo',
      text: "Careful! That's the Cali River: use the bridges, the car is not a boat.",
    },
  },

  banners: {
    m5Start: {
      title: 'THE PROMPT HEIST',
      subtitle: 'Grab Role, Context, Task and Format. The cops are already looking for you.',
    },
    m5Piece: {
      title: 'PROMPT PIECE!',
      subtitle: 'A 4-piece prompt: role, context, task and format.',
    },
    m5Order: {
      title: 'PROMPT IN ORDER! +$100.000',
      subtitle: 'Role → Context → Task → Format, just like the course.',
    },
    m1Start: {
      title: 'HEIST AT THE TOWER',
      subtitle: 'Run on foot for the golden vinyl in front of Torre de Cali.',
    },
    m1Pickup: {
      title: 'VINYL SECURED!',
      subtitle: 'The cops are behind you — cross Bulevar del Río.',
    },
    m1Bulevar: {
      title: 'BULEVAR CLEARED!',
      subtitle: 'Cross the La Ermita bridge to escape.',
    },
    m1HeistAlarm: {
      title: 'ALARM AT THE TOWER!',
      subtitle: 'Vinyl stolen! Run to your ride and lose the cops.',
    },
    m1Boarded: {
      title: 'RIDE ROLLING!',
      subtitle: 'Cross the La Ermita bridge at full speed.',
    },
    m1Bridge: {
      title: 'BRIDGE CLEARED!',
      subtitle: 'Hide the vinyl in Barrio San Antonio.',
    },
    m2Start: {
      title: 'SALSA NIGHT',
      subtitle: 'Pick up Mateo in front of Estadio Pascual Guerrero.',
    },
    m2Launch: {
      title: 'NIGHT TIME TRIAL!',
      subtitle: '95 seconds from the Pascual to Cristo Rey.',
    },
    m2RingBonus: {
      title: 'TURBO RING +10s!',
      subtitle: 'Nitro recharged — keep flying through Cali.',
    },
    m2Stage: {
      title: 'SPEAKERS ON BOARD!',
      subtitle: 'Escape toward the Av. Circunvalar ramp.',
    },
    m2Ramp: {
      title: 'HEADING TO CRISTO REY!',
      subtitle: 'Race up Cerro Los Cristales.',
    },
    m3Start: {
      title: 'BULEVAR STREET RACE',
      subtitle: "6 checkpoints against Cali's fastest.",
    },
    m3Ambush: {
      title: 'POLICE AMBUSH!',
      subtitle: "The cops showed up in Granada — don't lift off the gas!",
    },
    stuntJump: {
      title: 'STUNT JUMP!',
      subtitle: 'Epic flight over La Sucursal del Cielo.',
    },
    payNSpray: {
      title: 'FRESH PAINT!',
      subtitle: 'Stars wiped at the Cali body shop — clear road.',
    },
    roadblock: {
      title: 'ROADBLOCK ON THE BRIDGE!',
      subtitle: 'The National Police closed the crossing over the Cali River.',
    },
    driftCashout: {
      title: 'DRIFT CASHED!',
      subtitle: 'Street combo turned into Colombian pesos.',
    },
    timeChanged: {
      day: {
        title: 'SUNSET IN CALI',
        subtitle: 'Golden sky over La Sucursal del Cielo.',
      },
      night: {
        title: 'CALI NIGHT',
        subtitle: 'Neon lights, street lamps and salsa under the stars.',
      },
    },
    freeRoamWanted: {
      title: 'COPS ALERT!',
      subtitle: 'Lose them in the streets of Cali to drop your stars.',
    },
    freeRoamEscaped: {
      title: 'YOU ESCAPED THE COPS!',
      subtitle: 'Clear road in La Sucursal del Cielo.',
    },
  },

  viralTicker: CITY_COPY.viralTicker,

  radio: CITY_COPY.radio,

  cameraLabels: {
    chase: 'Camera: Chase',
    cinematic: 'Camera: Cinematic',
    hood: 'Camera: Hood',
    victory_orbit: 'Camera: Lookout',
  },

  qualityLabels: {
    low: 'Quality: Low',
    medium: 'Quality: Medium',
    high: 'Quality: High',
    ultra: 'Quality: Ultra',
  },

  timeOfDayLabels: {
    golden_hour: 'Sunset',
    night: 'Night',
  },

  landmarks: {
    san_antonio: 'Barrio San Antonio',
    torre_de_cali: 'Torre de Cali',
    bulevar_del_rio: 'Bulevar del Río',
    la_ermita: 'La Ermita Church',
    estadio_pascual: 'Estadio Pascual Guerrero',
    cristo_rey: 'Cristo Rey Lookout',
  },

  vehicleNames: {
    renault4_turbo: 'Renault 4 GT Turbo',
    spark_gt_turbo: 'Spark GT Turbo',
    willys_v8: 'Jeep Willys Yipao V8',
    banshee: 'Ferrari 458 Caleño',
    taxi: 'Zapatico Turbo Taxi',
    mio_bus: 'MIO Bus',
    chiva: 'Party Chiva',
    police: 'National Police Patrol Car',
    mazda_323_coupe: 'Mazda 323 Coupé',
    renault_18_gtx: 'Renault 18 GTX',
    chevrolet_sprint_turbo: 'Chevrolet Sprint Turbo',
    chevrolet_monza: 'Chevrolet Monza',
    nissan_sentra_b13: 'Nissan Sentra B13',
    chevette_turbo: 'Chevette Turbo',
    renault_twingo: 'Renault Twingo',
    yamaha_rx115: 'Yamaha RX 115',
    yamaha_dt125: 'Yamaha DT 125',
  },

  garage: {
    title: 'Cali Garage',
    subtitle: 'Customize your ride, paint, neon and look in Cali',
    cars: {
      renault4_turbo: 'Renault 4 GT Turbo',
      spark_gt_turbo: 'Spark GT Turbo',
      willys_v8: 'Jeep Willys Yipao V8',
      banshee: 'Ferrari 458 Caleño',
      mazda_323_coupe: 'Mazda 323 Coupé — the block racer',
      renault_18_gtx: "Renault 18 GTX — dad's ride",
      chevrolet_sprint_turbo: 'Sprint Turbo — small but spicy',
      chevrolet_monza: 'Chevrolet Monza — Calle Quinta class',
      nissan_sentra_b13: 'Sentra B13 — the indestructible',
      chevette_turbo: 'Chevette Turbo — rear-wheel drive, mijo',
      renault_twingo: 'Renault Twingo — the flying frog',
      yamaha_rx115: 'Yamaha RX 115 — the Cali bike, ring-ding!',
      yamaha_dt125: 'Yamaha DT 125 — trail bike for the hills',
    },
    paints: [
      { id: 'escarlata', label: 'Scarlet Red', paintHex: 0xe63946, neonHex: 0x00f0ff },
      { id: 'azucarero', label: 'Sugarcane Green', paintHex: 0x10b981, neonHex: 0xffb800 },
      { id: 'vice_rosa', label: 'Vice Fuchsia', paintHex: 0xff2e93, neonHex: 0x00f0ff },
      { id: 'amarillo_cali', label: 'Cali Yellow', paintHex: 0xffc400, neonHex: 0xff2e93 },
      { id: 'azul_cielo', label: 'Sucursal Blue', paintHex: 0x0284c7, neonHex: 0xffb800 },
      { id: 'blanco_perla', label: 'Pearl White', paintHex: 0xf8fafc, neonHex: 0x00e699 },
      {
        id: 'claude_naranja',
        label: 'Claude Orange ✦',
        paintHex: 0xd97757,
        neonHex: 0xfff4e6,
        requiresClaudeAlbum: true,
      },
    ] as readonly GaragePaintPreset[],
    avatars: {
      valeria: 'Valeria (Caleña)',
      mateo: 'Mateo (Caleño)',
    },
    outfits: {
      urbano_cali: 'Bulevar Streetwear',
      escarlata: 'Scarlet Jersey',
      azucarero: 'Sugarcane Jersey',
      tricolor: 'Colombia Tricolor',
      guayabera: 'Cali Guayabera',
      camiseta_seleccion: 'National Team Jersey',
      esqueleto_blanco: 'White Tank Top',
      camisa_salsera: 'Salsa Shirt',
    },
    applyCta: 'Apply and Ride',
    closeCta: 'Close [G]',
  },

  hud: {
    objectiveTag: 'OBJECTIVE',
    tickerTag: 'CALIVIRAL',
    wantedLabel: 'WANTED',
    bustWarning: 'THE COPS ARE CLOSING IN!',
    evadingPoliceLabel: 'EVADING THE COPS',
    speedUnit: 'km/h',
    metersUnit: 'm',
    nitroLabel: 'NITRO',
    cashCurrency: 'COP',
    stepProgress: (current: number, total: number) => `STEP ${current} OF ${total}`,
    enterVehiclePrompt: '[F] Get in the car',
    enterNamedVehicle: (name: string) => `[F] Get in the ${name}`,
    hijackNamedVehicle: (name: string) => `[F] Take the ${name}`,
    exitVehiclePrompt: '[F] Get out of the car',
    exitMotorcyclePrompt: '[F] Get off the bike',
    directionStraight: 'Go straight',
    directionLeft: 'Turn left',
    directionRight: 'Turn right',
    directionBack: 'Turn around',
    driftLabel: 'DRIFT',
    driftComboLabel: (mult: number) => `DRIFT x${mult}`,
    racePosLabel: (pos: number, total: number) => `POS ${pos}/${total}`,
    landmarksLabel: 'Landmarks',
    audioMutedBadge: 'Muted',
    voicesOnLabel: '[V] Voices: ON',
    voicesOffLabel: '[V] Voices: OFF',
    voicesHint: '[V] Voices',
    radioHint: '[R] Radio',
    garageHint: '[G] Garage',
    hornHint: '[H] Horn',
    pauseHint: '[Esc] Pause',
    cameraHint: '[C] Camera',
    timeToggleHint: '[T] Day/Night',
    qualityHint: '[Q] Graphics quality',
  },

  voiceLines: CITY_COPY.voiceLines,

  overlays: {
    pause: {
      title: 'Game Paused',
      subtitle: 'Grab a cholado and get back behind the wheel.',
      resume: 'Resume',
      restart: 'Restart Mission',
      toggleMute: 'Mute Audio',
      toggleUnmute: 'Unmute Audio',
      cycleRadio: 'Change Station',
      backToTitle: 'Back to Menu',
    },
    missionPassed: {
      title: 'MISSION PASSED!',
      subtitle: 'Qué chimba, parce! You left your mark on Cali.',
      rewardLabel: 'Reward',
      timeLabel: 'Time',
      newRecordBadge: 'New Record!',
      nextMission: 'Next Mission',
      freeRoam: 'Go to Free Roam',
      backToTitle: 'Main Menu',
    },
    busted: {
      title: 'BUSTED!',
      subtitle: 'The patrols boxed you in on the streets of Cali. Try again!',
      retry: 'Retry Mission',
      backToTitle: 'Back to Menu',
    },
    timeUp: {
      title: "Time's up!",
      subtitle: 'The clock hit zero before you made it to the party at Cristo Rey. More nitro!',
      retry: 'Retry Race',
      backToTitle: 'Back to Menu',
    },
    victory: {
      title: 'CALI LEGEND!',
      subtitle: 'You conquered La Sucursal del Cielo from Bulevar del Río all the way to Cristo Rey.',
      totalCashLabel: 'Total Loot',
      bestTimesLabel: 'Best Times',
      landmarksLabel: 'Landmarks Discovered',
      freeRoamCta: 'Explore in Free Roam',
      replayCta: 'Play Again',
      backToTitle: 'Main Menu',
    },
    webglError: {
      title: 'WebGL not available',
      message:
        "Your browser couldn't start Cali's 3D engine. Turn on hardware acceleration or try another compatible browser.",
      retry: 'Retry',
    },
  },
};

/** Reto AcaDevHack: challenge run, leaderboard, prize, and free-course promo copy (English). */
export const LOCALE_DEVHACK_EN: LocaleDevhackShape = {
  school: 'AcaDevHack AI school',
  whatsappPhone: '573174498336',
  links: {
    home: 'https://devhack.co/',
    subscription: 'https://devhack.co/academy-ai/suscripcion',
  },
  freeCourses: [
    {
      title: 'Claude Code from scratch',
      detail: 'Free course · 10 lessons + certificate (Spanish)',
      url: 'https://devhack.co/academy-ai/claude-code-desde-cero/',
    },
    {
      title: 'Claude for everyone',
      detail: 'Free course · no coding (Spanish)',
      url: 'https://devhack.co/academy-ai/claude-para-todos/',
    },
  ],
  titleCard: {
    badge: 'Reto AcaDevHack',
    title: '🏆 Reto AcaDevHack',
    subtitle: '5 missions in a row · live leaderboard',
    description:
      'Play Missions 1, 2, 3, 5 and the Cali Tour without failing one. Your time goes on the leaderboard, and if you finish all 5 you win 3 free months of the AcaDevHack Virtual Subscription.',
    cta: 'Accept the challenge',
    rankingCta: 'View leaderboard',
  },
  coursesTitle: 'Learn AI for free with AcaDevHack',
  stageLabels: {
    mission_1_bulevar: 'Mission 1',
    mission_2_cristo_rey: 'Mission 2',
    mission_3_pique_bulevar: 'Mission 3',
    mission_5_golpe_prompt: 'Mission 5',
    free_roam: 'Cali Tour',
  },
  hudChip: (stage: number, total: number, time: string): string => `Reto ${stage}/${total} · ${time}`,
  nickname: {
    title: 'Pick your nickname',
    help: '3 to 16 letters, numbers or _. This is how you show up on the leaderboard.',
    label: 'Nickname',
    placeholder: 'e.g. Parce_23',
    start: 'Start the challenge',
    cancel: 'Cancel',
    checking: 'Checking nickname…',
    rules:
      'Rules: the 5 missions are back to back. If you get busted or run out of time, the challenge restarts from Mission 1.',
    errors: {
      too_short: 'Too short: at least 3 characters.',
      too_long: 'Too long: at most 16 characters.',
      invalid_chars: 'Only letters, numbers and _ (no spaces).',
      nickname_taken: 'Another player already has that nickname. Try another one.',
      offline: "No connection to the leaderboard. You can play the challenge, but your times won't be saved.",
      auth_unavailable:
        "The leaderboard isn't available right now. You can play, but your times won't be saved.",
      permission_denied: 'The leaderboard rejected that nickname. Try another one.',
      unknown: 'Something went wrong with the leaderboard. Try again.',
    },
    playOffline: 'Play without leaderboard',
  },
  stagePassed: {
    title: 'Stage cleared!',
    timeLabel: 'Your time',
    bestLabel: 'Your best',
    personalBest: 'New personal best on the leaderboard!',
    saving: 'Saving to the leaderboard…',
    saved: 'Time saved to the leaderboard.',
    offline: "Leaderboard offline: this time wasn't saved.",
    next: 'Next mission',
    ranking: 'View leaderboard',
    quit: 'Quit the challenge',
    progress: (done: number, total: number): string => `${done} of ${total} missions done`,
  },
  failed: {
    title: 'Challenge lost',
    subtitle: 'No second chances in the Reto AcaDevHack: start again from Mission 1.',
    implausible: "That time doesn't add up for this mission. The challenge restarts from Mission 1.",
    retry: 'Retry from Mission 1',
    quit: 'Back to start',
  },
  winner: {
    title: 'You won the Reto AcaDevHack!',
    subtitle:
      'You finished all 5 missions in a row. You won 3 free months of the AcaDevHack Virtual Subscription.',
    codeLabel: 'Your prize code',
    totalLabel: 'Total time',
    registering: 'Registering your prize…',
    offline:
      "Offline: your code couldn't be registered yet. Take a screenshot of this screen and message us on WhatsApp.",
    note: 'Keep your code. DevHack verifies every code before activating the prize.',
    claim: 'Claim on WhatsApp',
    subscription: 'See the subscription',
    backToTitle: 'Back to start',
    whatsappMessage: (nickname: string, code: string, total: string): string =>
      `Hi DevHack 👋 I won the Reto AcaDevHack in GTA I - Cali - Colombia. Nickname: ${nickname}. Code: ${code}. Total time: ${total}. I'd like to claim my 3 free months of the AcaDevHack Virtual Subscription.`,
  },
  ranking: {
    title: 'Reto AcaDevHack Leaderboard',
    subtitle: 'Top 10 per mission · fastest wins',
    loading: 'Loading leaderboard…',
    empty: 'Nobody has set a time yet. Be the first!',
    offline: "We couldn't load the leaderboard (offline).",
    you: '(you)',
    position: '#',
    player: 'Player',
    time: 'Time',
    close: 'Close',
  },
  learning: {
    showcase: {
      badge: 'NEW · LEARN BY PLAYING',
      title: 'Learn Claude while you play',
      subtitle:
        'Every power in the game is a real Claude Code command. You play, you outrun the cops… and before you know it, you can use AI.',
      features: [
        {
          id: 'plan',
          command: '/plan',
          title: 'Plan Mode',
          detail: 'Review and approve the route before you start, just like in Claude Code.',
          lesson: 'Lesson 4',
        },
        {
          id: 'rewind',
          command: '/rewind',
          title: 'Rewind time [Z]',
          detail: 'Crashed? Take the last 5 seconds back. The command really exists.',
          lesson: 'Lesson 5',
        },
        {
          id: 'hack',
          command: '$ hack',
          title: 'Hack the cops',
          detail: 'Cornered? Answer fast with [1][2][3] and shake off a star.',
          lesson: '24 challenges',
        },
        {
          id: 'cards',
          command: '✦ 10',
          title: 'Claude Cards',
          detail: 'Hidden all over Cali. Collect them all to unlock the Claude Orange paint.',
          lesson: 'Album',
        },
        {
          id: 'prompt',
          command: 'R·C·T·F',
          title: 'The Prompt Heist',
          detail: 'Mission 5: steal Role, Context, Task and Format and fool the bank AI.',
          lesson: 'Claude for everyone',
        },
      ],
      playCta: 'Play The Prompt Heist',
      albumCta: 'Open Claude Album',
      albumProgress: (have: number, total: number): string => `${have}/${total} cards`,
      footnote: "Based on AcaDevHack's free courses (in Spanish): Claude Code from scratch and Claude for everyone.",
    },
    madeBy: {
      prefix: 'Made by',
      brand: 'DevHack',
      detail: 'AI school · devhack.co',
      url: 'https://devhack.co/',
      ariaLabel: 'Made by DevHack — visit devhack.co',
    },
    lessonCta: 'Free lesson',
    courseCta: 'Free course',
    dismiss: 'Close',
    courseNames: {
      'claude-code-desde-cero': 'Claude Code from scratch',
      'claude-para-todos': 'Claude for everyone',
    },
    lessonLabel: (course: string, lesson: number): string => `${course} · Lesson ${lesson}`,
    rewindPill: (charges: number): string => `[Z] /rewind ×${charges}`,
    rewindUsed: '⏪ /rewind: you went 5 seconds back',
    rewindEmpty: '/rewind was already used this mission',
    tips: {
      tip_rewind: {
        title: '/rewind is real',
        body: "In Claude Code, /rewind undoes Claude's edits and takes you back to an earlier point.",
      },
      tip_clear_spray: {
        title: 'Like /clear in Claude Code',
        body: 'The body shop wiped you clean. In Claude Code, /clear starts a fresh conversation without dragging old context.',
      },
      tip_hook_nitro: {
        title: "That's a hook",
        body: 'Every checkpoint refills your nitro automatically. A Claude Code hook always runs something, like your tests after every edit.',
      },
      tip_plan_mode: {
        title: 'Plan Mode',
        body: 'In Claude Code, Plan mode proposes what it will do without touching files. You correct it and approve it.',
      },
      tip_first_card: {
        title: 'Claude Card 1 of 10!',
        body: 'There are 10 cards hidden around Cali, one per lesson. See them in the Claude Album (pause).',
      },
      tip_all_cards: {
        title: 'Claude Album complete!',
        body: 'You unlocked the Claude Orange paint in the Garage [G]. You know the whole course now: go practice it!',
      },
      tip_hack: {
        title: 'Hack the cops',
        body: 'When the cops corner you, answer fast with [1] [2] [3]: get it right and you lose a star.',
      },
    },
    cards: {
      card_agentic_loop: {
        title: 'The agentic loop',
        body: 'Claude Code gathers context, acts and verifies. If a test fails, it reads the error and tries again.',
      },
      card_claude_md: {
        title: 'CLAUDE.md',
        body: 'What Claude should always know about your project goes in CLAUDE.md. /init creates one for you.',
      },
      card_plan_mode: {
        title: 'Plan Mode',
        body: 'Claude analyzes and proposes a plan without editing anything. You fix it in one line and approve it.',
      },
      card_context: {
        title: '/compact · /clear · /rewind',
        body: '/compact summarizes a long chat, /clear starts fresh and /rewind undoes edits.',
      },
      card_hooks: {
        title: 'Permissions and hooks',
        body: 'A deny rule blocks files like .env. A hook always runs your tests after every edit.',
      },
      card_mcp: {
        title: 'MCP',
        body: 'With the Playwright MCP, Claude uses a real browser to test your app. Review every server before approving it.',
      },
      card_subagents: {
        title: 'Subagents',
        body: 'A team of agents works in parallel and a judge agent decides, with evidence, when it is done.',
      },
      card_skills: {
        title: 'Skills',
        body: 'Whatever you repeat every week goes in a skill, which Claude loads only when it is needed.',
      },
      card_prompt_4: {
        title: 'Ask well: 4 pieces',
        body: 'Role, context, task and format. With those 4 pieces Claude gets you on the first try.',
      },
      card_artifacts: {
        title: 'Artifacts',
        body: 'An artifact is a document or tool you see and refine by chatting with Claude.',
      },
    },
    album: {
      open: 'Claude Album',
      title: 'Claude Album',
      subtitle: (have: number, total: number): string => `${have} of ${total} cards · hidden all over Cali`,
      locked: '???',
      lockedHint: 'Keep exploring Cali…',
      reward: 'Collect all 10 to unlock the Claude Orange paint in the Garage.',
      close: 'Back',
    },
    cardToast: (have: number, total: number): string => `Claude Card ${have}/${total}`,
    hack: {
      title: '> HACK THE COPS',
      subtitle: 'Answer fast with [1] [2] [3]. Get it right and you lose a star.',
      correct: '✔ Hack successful! −1 star',
      wrong: '✖ Hack failed: +1 star',
      timeout: '⌛ Time ran out',
    },
    plan: {
      title: '> PLAN MODE',
      subtitle: 'Just like Claude Code: review the plan, correct it and approve it.',
      approve: 'Approve plan',
      steps: {
        mission_1_bulevar: ['Walk to the briefcase', 'Steal the car', 'Escape along Bulevar del Río'],
        mission_2_cristo_rey: ['Cross the bridge', 'Climb up to Cristo Rey', 'Beat the clock'],
        mission_3_pique_bulevar: ['Launch from the grid', 'Hit every checkpoint', 'Win the race'],
        mission_5_golpe_prompt: ['Grab Role, Context, Task and Format', 'Dodge the cops', 'Deliver the prompt to the bank'],
        free_roam: ['Cruise around Cali', 'Discover the landmarks', 'Hunt for Claude cards'],
      },
      options: {
        turbo: { label: 'Turbo Plan', detail: 'You start with full nitro.' },
        stealth: { label: 'Stealth Plan', detail: 'You start with one less star.' },
      },
    },
    phone: {
      from: 'Profe JG · AcaDevHack',
      messages: [
        'Did you know Claude Code can run your tests by itself after every edit? It is called a hook.',
        'Tip: give Claude the role, the context, the task and the format. It answers way better.',
        'Before Claude touches your code, ask it for a plan with Plan mode and correct it.',
        'If Claude gives you a fact without a source, ask for it and check it. Always.',
        'Whatever your project needs Claude to know, put it in CLAUDE.md.',
      ],
    },
    radioAds: CITY_COPY.radioAds,
  },
};
