/**
 * Authentic Español Caleño player-facing copy for GTA I - Cali - Colombia (La Sucursal del Cielo).
 * All UI labels, mission copy, radio labels, dialogues, and news tickers live exclusively here.
 */

import type {
  CaliOutfitId,
  CameraMode,
  CharacterAvatarId,
  DialogueSpeaker,
  LandmarkId,
  MissionId,
  PlayerCarKind,
  QualityLevel,
  RadioStationId,
  TimeOfDay,
  VehicleKind,
} from '../types/game';

export interface ControlHintItem {
  readonly keys: string;
  readonly action: string;
}

export interface MissionCopy {
  readonly title: string;
  readonly subtitle: string;
  readonly description: string;
  readonly rewardCop: number;
  readonly badge: string;
}

export interface GaragePaintPreset {
  readonly id: string;
  readonly label: string;
  readonly paintHex: number;
  readonly neonHex: number;
}

export const LOCALE_CALI = {
  brand: {
    title: 'GTA I - Cali - Colombia',
    subtitle: 'La Sucursal del Cielo',
    tagline: 'Atardecer vallecaucano, salsa brava y velocidad sin frenos.',
    cityName: 'Santiago de Cali',
  },

  devhackAds: {
    footer: 'devhack.co',
    brandTag: 'AcaDevHack de IA',
    messages: {
      school: { headline: 'AcaDevHack de IA', tagline: 'Escuela de IA aplicada' },
      claude_code_course: { headline: 'Curso GRATIS', tagline: 'Claude Code desde cero' },
      claude_for_all: { headline: 'Claude para todos', tagline: 'Curso gratis · sin programar' },
      subscription: { headline: 'Suscripción AcaDevHack', tagline: '$13 USD/mes · devhack.co' },
      future: { headline: 'Arquitectando el Futuro con IA', tagline: 'DevHack' },
      reto: { headline: 'Reto AcaDevHack', tagline: '4 misiones · gana 3 meses gratis' },
    },
  },

  titleScreen: {
    loading: 'Cargando calles de Cali...',
    noRecord: 'Sin récord',
    emptyTime: '--:--',
    completedBadge: 'Completada',
    bestTimePrefix: 'Mejor tiempo',
    controlsTitle: 'Controles de Cali',
    playCta: 'Arrancar',
  },

  controls: [
    { keys: 'WASD / Flechas', action: 'Conducir o caminar' },
    { keys: 'Espacio', action: 'Derrape / Freno de mano' },
    { keys: 'Shift', action: 'Nitro / Correr' },
    { keys: 'F', action: 'Subir o bajar del carro' },
    { keys: 'H', action: 'Pito / Bocina Caleña' },
    { keys: 'G', action: 'Garaje Caleño' },
    { keys: 'R', action: 'Cambiar emisora FM' },
    { keys: 'V', action: 'Activar / silenciar voces' },
    { keys: 'C', action: 'Cambiar cámara' },
    { keys: 'T', action: 'Cambiar Día / Noche' },
    { keys: 'Esc', action: 'Pausa' },
  ] as readonly ControlHintItem[],

  missions: {
    mission_1_bulevar: {
      title: 'Golpe en la Torre',
      subtitle: 'Misión 01 · Centro & Río Cali',
      description:
        'Roba a pie el vinilo maestro frente a la Torre de Cali, escapa en tu nave por el Puente de La Ermita y escóndete en San Antonio.',
      rewardCop: 250_000,
      badge: 'Misión 1',
    },
    mission_2_cristo_rey: {
      title: 'Noche de Salsa en Cristo Rey',
      subtitle: 'Misión 02 · Estadio & Cerro Los Cristales',
      description:
        'Carrera nocturna contrarreloj (95s) desde el Estadio Pascual Guerrero con anillos de turbo y persecución hasta Cristo Rey iluminado.',
      rewardCop: 500_000,
      badge: 'Misión 2',
    },
    mission_3_pique_bulevar: {
      title: 'Pique Callejero en el Bulevar',
      subtitle: 'Misión 03 · Circuito Urbano de Cali',
      description:
        'Compite rueda a rueda en 6 puntos de control desde el Bulevar del Río por La Ermita, Granada y Calle Quinta con emboscada policial.',
      rewardCop: 400_000,
      badge: 'Misión 3',
    },
    free_roam: {
      title: 'Modo Libre en Cali',
      subtitle: 'Exploración · 6 Íconos de Cali',
      description:
        'Recorre Santiago de Cali sin afán, descubre los 6 monumentos, tira derrapes y goza la radio caleña.',
      rewardCop: 0,
      badge: 'Modo Libre',
    },
  } as Readonly<Record<MissionId, MissionCopy>>,

  objectives: {
    mission1: {
      enterVehicleLabel: 'Súbete al Banshee en San Antonio',
      enterVehicleDetail: 'Presiona [F] junto al deportivo neón de Valeria.',
      pickupLabel: 'Llega a la Torre de Cali',
      pickupDetail: 'Baja desde San Antonio hasta la Avenida Las Américas.',
      bulevarLabel: 'Cruza el Bulevar del Río a toda mecha',
      bulevarDetail: '¡La tomba activó el operativo! Baja por la Avenida Colombia.',
      escapeLabel: 'Escapa hacia la Iglesia La Ermita',
      escapeDetail: 'Cruza el Puente de La Ermita, esquiva las patrullas y llega al atrio.',
      heistOnFootLabel: 'Roba a pie el vinilo maestro en la Torre de Cali',
      heistOnFootDetail:
        'Acércate a pie al maletín dorado en Avenida Las Américas frente a la Torre.',
      boardGetawayLabel: 'Súbete a tu nave de escape',
      boardGetawayDetail:
        '¡Sonó la alarma! Corre al deportivo en la esquina y presiona [F] para escapar.',
      crossBridgeLabel: 'Cruza el Puente de La Ermita',
      crossBridgeDetail:
        'Baja por Avenida Colombia, esquiva la tomba y cruza el Río Cali rumbo a La Ermita.',
      hideoutLabel: 'Escóndete en Barrio San Antonio',
      hideoutDetail:
        'Regresa al oeste con el vinilo y resguárdate en la casa segura de San Antonio.',
    },
    mission2: {
      enterVehicleLabel: 'Prende motores para la rumba',
      enterVehicleDetail: 'Presiona [F] para subirte al deportivo y activar el nitro.',
      stageLabel: 'Recoge a Mateo en el Estadio Pascual',
      stageDetail: 'Cruza el puente sur hacia la Calle 5 frente al Estadio Pascual Guerrero.',
      ringBridgeLabel: 'Atraviesa el anillo de turbo en Puente Bulevar Sur',
      ringBridgeDetail:
        'Lánzate al oeste por Calle 5 y cruza el anillo sobre el Río Cali (+10s y Nitro).',
      ringBulevarLabel: 'Cruza el anillo de turbo en el Bulevar del Río',
      ringBulevarDetail:
        'Acelera al norte por Avenida Colombia hacia el segundo anillo (+10s y Nitro).',
      rampLabel: 'Toma la rampa hacia Cristo Rey',
      rampDetail:
        'Gira al oeste en Av. Circunvalar (Calle 13) para subir al Cerro Los Cristales.',
      summitLabel: 'Sube al Mirador de Cristo Rey',
      summitDetail: 'Toma la rampa oeste hacia el Cerro Los Cristales hasta la cima.',
    },
    mission3: {
      raceLabel: 'Pique callejero por el Bulevar',
      raceDetail: 'Supera a los rivales callejeros por los 6 puntos de control hasta la meta.',
      checkpointLabel: (index: number, total: number) => `Punto de control ${index}/${total}`,
      checkpointDetail: (district: string) =>
        `Acelera hacia ${district} y mantén la punta del pique.`,
      ambushDetail: '¡La tomba armó operativo en Granada! No sueltes el acelerador hasta la meta.',
      finishLabel: 'Cruza la meta en el Bulevar del Río',
      finishDetail: '¡Última recta por Avenida Colombia! Mete nitro y corona el pique.',
    },
    freeRoam: {
      exploreLabel: 'Explora La Sucursal del Cielo',
      exploreDetail: 'Descubre los 6 íconos de Cali, haz derrapes y sube el volumen.',
      allDiscoveredLabel: '¡Conoces toda Cali, parce!',
      allDiscoveredDetail: 'Todos los monumentos descubiertos. Sigue tirando nitro por la ciudad.',
    },
  },

  speakers: {
    valeria: 'Valeria',
    mateo: 'Mateo',
    radio: 'Radio',
    system: 'Sistema',
  } as Readonly<Record<DialogueSpeaker, string>>,

  dialogues: {
    m1Intro: {
      speaker: 'valeria' as const,
      text: '¡Quiubo, parce! Corre a pie hasta la Torre de Cali y agarra el vinilo dorado antes de que llegue la tomba.',
    },
    m1Pickup: {
      speaker: 'mateo' as const,
      text: '¡Lo tenemos, ve! Pero ojito que la tomba ya prendió sirenas por el Bulevar del Río. ¡Métele nitro!',
    },
    m1Bulevar: {
      speaker: 'valeria' as const,
      text: '¡Qué chimba de cruce por La Ermita, ve! Ahora dale duro hasta la casa segura de Barrio San Antonio y los perdemos.',
    },
    m1Passed: {
      speaker: 'mateo' as const,
      text: '¡Coronamos, parce! Nadie nos alcanza en la Sucursal del Cielo. ¡Ahora vamos por Cristo Rey!',
    },
    m1Alarm: {
      speaker: 'valeria' as const,
      text: '¡Tengo el vinilo maestro, parce! Saltó la alarma de la Torre: ¡corre a tu nave antes de que llegue la tomba!',
    },
    m1EscapeCar: {
      speaker: 'mateo' as const,
      text: '¡Eso es, ve! Písalo por Avenida Colombia, cruza el Puente de La Ermita y nos escondemos en San Antonio.',
    },
    m2Intro: {
      speaker: 'mateo' as const,
      text: '¡Esta noche retumba toda Cali! Pasa por mí al Estadio Pascual Guerrero que tengo los parlantes listos.',
    },
    m2Launch: {
      speaker: 'mateo' as const,
      text: '¡Reloj corriendo, oís! Salimos del Pascual con la tomba encima: atraviesa los anillos de turbo hasta Cristo Rey.',
    },
    m2Ring1: {
      speaker: 'valeria' as const,
      text: '¡Qué chimba de pique por el Puente Bulevar Sur! Diez segundos extra y nitro lleno: dale al Bulevar del Río.',
    },
    m2Ring2: {
      speaker: 'mateo' as const,
      text: '¡Segundo anillo coronado, parce! Enfila por Av. Circunvalar que la rampa a Cristo Rey está iluminada.',
    },
    m2Stage: {
      speaker: 'mateo' as const,
      text: '¡Arriba ese sonido, ve! La tomba quiere dañar la rumba: ¡dale oeste por la rampa hasta Cristo Rey!',
    },
    m2Ramp: {
      speaker: 'valeria' as const,
      text: '¡Esa es la rampa al Cerro Los Cristales, parce! Métele nitro hasta el Mirador de Cristo Rey.',
    },
    m2Passed: {
      speaker: 'valeria' as const,
      text: '¡Mirá esa vista desde Cristo Rey! Salsa brava a todo taco y toda Santiago de Cali a nuestros pies.',
    },
    m3Intro: {
      speaker: 'valeria' as const,
      text: '¡A calentar llanta, parce! Arranca el pique callejero por el Bulevar, La Ermita y Granada. ¡A dejarlos comiendo humo!',
    },
    m3Ambush: {
      speaker: 'mateo' as const,
      text: '¡Pilas, parce! La tomba prendió patrullas por Granada y los puentes — ¡písalo a fondo!',
    },
    m3Passed: {
      speaker: 'valeria' as const,
      text: '¡Coronamos el pique del Bulevar, oís! En Cali no hay quien le gane a esta máquina.',
    },
    payNSpray: {
      speaker: 'mateo' as const,
      text: '¡Qué pinta nueva tan brava, parce! Cero estrellas y carro recién brillado: la tomba ya ni nos reconoce.',
    },
    stuntJump: {
      speaker: 'valeria' as const,
      text: '¡Qué vuelazo tan épico, ve! Toda La Sucursal del Cielo quedó mirando pa’ arriba.',
    },
    freeRoamIntro: {
      speaker: 'valeria' as const,
      text: '¡Relájate, oís! Tienes toda Cali pa’ vos: San Antonio, el Bulevar, La Ermita, el Pascual y Cristo Rey.',
    },
    freeRoamTourPassed: {
      speaker: 'valeria' as const,
      text: '¡Le diste la vuelta a toda Cali, oís! Los 6 íconos coronados — ¡Reto AcaDevHack superado!',
    },
    freeRoamWanted: {
      speaker: 'mateo' as const,
      text: '¡Ojo, ve! Se prendió la tomba por toda Cali. ¡Acelera y piérdelos entre las cuadras!',
    },
    freeRoamEscaped: {
      speaker: 'valeria' as const,
      text: '¡Los dejamos viendo un chispero, oís! Ya puedes rumbear tranquilo por Cali.',
    },
    landmarkDiscovered: (landmarkName: string) => ({
      speaker: 'system' as const,
      text: `¡Descubriste ${landmarkName}! Qué orgullo caleño, parce.`,
    }),
    riverWarning: {
      speaker: 'mateo' as const,
      text: '¡Pilas, ve! Ese es el Río Cali: usa los puentes que el carro no es lancha.',
    },
  },

  banners: {
    m1Start: {
      title: 'GOLPE EN LA TORRE',
      subtitle: 'Corre a pie por el vinilo dorado frente a la Torre de Cali.',
    },
    m1Pickup: {
      title: '¡VINILO ASEGURADO!',
      subtitle: 'La tomba viene detrás — cruza el Bulevar del Río.',
    },
    m1Bulevar: {
      title: '¡BULEVAR SUPERADO!',
      subtitle: 'Cruza el Puente de La Ermita para escapar.',
    },
    m1HeistAlarm: {
      title: '¡ALARMA EN LA TORRE!',
      subtitle: '¡Vinilo robado! Corre a tu nave y escapa de la tomba.',
    },
    m1Boarded: {
      title: '¡NAVE EN MARCHA!',
      subtitle: 'Cruza el Puente de La Ermita a toda mecha.',
    },
    m1Bridge: {
      title: '¡PUENTE SUPERADO!',
      subtitle: 'Escóndete con el vinilo en Barrio San Antonio.',
    },
    m2Start: {
      title: 'NOCHE DE SALSA',
      subtitle: 'Recoge a Mateo frente al Estadio Pascual Guerrero.',
    },
    m2Launch: {
      title: '¡CONTRARRELOJ NOCTURNA!',
      subtitle: '95 segundos desde el Pascual hasta Cristo Rey.',
    },
    m2RingBonus: {
      title: '¡ANILLO DE TURBO +10s!',
      subtitle: 'Nitro recargado — sigue a toda mecha por Cali.',
    },
    m2Stage: {
      title: '¡PARLANTES A BORDO!',
      subtitle: 'Escapa hacia la rampa de Av. Circunvalar.',
    },
    m2Ramp: {
      title: '¡RUMBO A CRISTO REY!',
      subtitle: 'Sube a toda mecha por el Cerro Los Cristales.',
    },
    m3Start: {
      title: 'PIQUE EN EL BULEVAR',
      subtitle: '6 puntos de control contra los más rápidos de Cali.',
    },
    m3Ambush: {
      title: '¡OPERATIVO EN EL PIQUE!',
      subtitle: 'La tomba cayó en Granada — ¡no sueltes el acelerador!',
    },
    stuntJump: {
      title: '¡SALTO ACROBÁTICO!',
      subtitle: 'Vuelo épico en La Sucursal del Cielo.',
    },
    payNSpray: {
      title: '¡PINTURA NUEVA!',
      subtitle: 'Estrellas borradas en el taller caleño — camino limpio.',
    },
    roadblock: {
      title: '¡RETÉN EN EL PUENTE!',
      subtitle: 'La Policía Nacional cerró el paso sobre el Río Cali.',
    },
    driftCashout: {
      title: '¡DERRAPE COBRADO!',
      subtitle: 'Combo callejero convertido en pesos colombianos.',
    },
    timeChanged: {
      day: {
        title: 'ATARDECER EN CALI',
        subtitle: 'Cielo dorado sobre La Sucursal del Cielo.',
      },
      night: {
        title: 'NOCHE CALEÑA',
        subtitle: 'Luces neón, farolas y salsa bajo las estrellas.',
      },
    },
    freeRoamWanted: {
      title: '¡ALERTA DE LA TOMBA!',
      subtitle: 'Piérdelos en las calles de Cali para bajar estrellas.',
    },
    freeRoamEscaped: {
      title: '¡ESCAPASTE DE LA TOMBA!',
      subtitle: 'Camino despejado en La Sucursal del Cielo.',
    },
  },

  viralTicker: [
    '#CaliViral: Deportivo neón rompe el radar frente a la Torre de Cali, ¡oís!',
    '#BulevarDelRío: Caleños graban derrape épico al ritmo de Salsa Brava.',
    '#LaSucursalDelCielo: Atardecer de lujo sobre el Cerro Los Cristales.',
    '#EstadioPascual: Rumba salsera prendida en la Calle 5 antes del amanecer.',
    '#AlertaTomba: Patrullas desplegadas en los puentes del Río Cali.',
    '#MiradorCristoRey: Fiesta inolvidable con vista a toda Santiago de Cali.',
  ] as readonly string[],

  radio: {
    salsa_brava: '98.5 FM — Salsa Brava Cali',
    sucursal_synth: '104.3 FM — Sucursal Synth',
    off: 'Radio Apagada',
  } as Readonly<Record<RadioStationId, string>>,

  cameraLabels: {
    chase: 'Cámara: Persecución',
    cinematic: 'Cámara: Cinemática',
    hood: 'Cámara: Capó',
    victory_orbit: 'Cámara: Mirador',
  } as Readonly<Record<CameraMode, string>>,

  qualityLabels: {
    low: 'Calidad: Baja',
    medium: 'Calidad: Media',
    high: 'Calidad: Alta',
    ultra: 'Calidad: Ultra',
  } as Readonly<Record<QualityLevel, string>>,

  timeOfDayLabels: {
    golden_hour: 'Atardecer',
    night: 'Noche',
  } as Readonly<Record<TimeOfDay, string>>,

  landmarks: {
    san_antonio: 'Barrio San Antonio',
    torre_de_cali: 'Torre de Cali',
    bulevar_del_rio: 'Bulevar del Río',
    la_ermita: 'Iglesia La Ermita',
    estadio_pascual: 'Estadio Pascual Guerrero',
    cristo_rey: 'Mirador de Cristo Rey',
  } as Readonly<Record<LandmarkId, string>>,

  vehicleNames: {
    renault4_turbo: 'Renault 4 GT Turbo',
    spark_gt_turbo: 'Spark GT Turbo',
    willys_v8: 'Jeep Willys Yipao V8',
    banshee: 'Ferrari 458 Caleño',
    taxi: 'Taxi Zapatico Turbo',
    mio_bus: 'Bus MIO',
    chiva: 'Chiva Rumbera',
    police: 'Patrulla Policía Nacional',
    mazda_323_coupe: 'Mazda 323 Coupé',
    renault_18_gtx: 'Renault 18 GTX',
    chevrolet_sprint_turbo: 'Chevrolet Sprint Turbo',
    chevrolet_monza: 'Chevrolet Monza',
    nissan_sentra_b13: 'Nissan Sentra B13',
    chevette_turbo: 'Chevette Turbo',
    renault_twingo: 'Renault Twingo',
    yamaha_rx115: 'Yamaha RX 115',
    yamaha_dt125: 'Yamaha DT 125',
  } satisfies Readonly<Record<VehicleKind, string>>,

  garage: {
    title: 'Garaje Caleño',
    subtitle: 'Personaliza tu nave, pintura, neón y pinta en Cali',
    cars: {
      renault4_turbo: 'Renault 4 GT Turbo',
      spark_gt_turbo: 'Spark GT Turbo',
      willys_v8: 'Jeep Willys Yipao V8',
      banshee: 'Ferrari 458 Caleño',
      mazda_323_coupe: 'Mazda 323 Coupé — el pique del barrio',
      renault_18_gtx: 'Renault 18 GTX — la nave del cucho',
      chevrolet_sprint_turbo: 'Sprint Turbo — chiquito pero picante',
      chevrolet_monza: 'Chevrolet Monza — elegancia de la Quinta',
      nissan_sentra_b13: 'Sentra B13 — el indestructible caleño',
      chevette_turbo: 'Chevette Turbo — tracción trasera, mijo',
      renault_twingo: 'Renault Twingo — la ranita voladora',
      yamaha_rx115: 'Yamaha RX 115 — la moto caleña, ¡ring-ding!',
      yamaha_dt125: 'Yamaha DT 125 — trochera pa\' la loma',
    } satisfies Readonly<Record<PlayerCarKind, string>>,
    paints: [
      { id: 'escarlata', label: 'Rojo Escarlata', paintHex: 0xe63946, neonHex: 0x00f0ff },
      { id: 'azucarero', label: 'Verde Azucarero', paintHex: 0x10b981, neonHex: 0xffb800 },
      { id: 'vice_rosa', label: 'Fucsia Vice', paintHex: 0xff2e93, neonHex: 0x00f0ff },
      { id: 'amarillo_cali', label: 'Amarillo Caleño', paintHex: 0xffc400, neonHex: 0xff2e93 },
      { id: 'azul_cielo', label: 'Azul Sucursal', paintHex: 0x0284c7, neonHex: 0xffb800 },
      { id: 'blanco_perla', label: 'Blanco Perla', paintHex: 0xf8fafc, neonHex: 0x00e699 },
    ] as readonly GaragePaintPreset[],
    avatars: {
      valeria: 'Valeria (Morena Caleña)',
      mateo: 'Mateo (Parcero Caleño)',
    } as Readonly<Record<CharacterAvatarId, string>>,
    outfits: {
      urbano_cali: 'Urbano Bulevar',
      escarlata: 'Camiseta Escarlata',
      azucarero: 'Camiseta Azucarera',
      tricolor: 'Tricolor Colombia',
      guayabera: 'Guayabera Caleña',
      camiseta_seleccion: 'Camiseta de la Selección',
      esqueleto_blanco: 'Esqueleto Blanco',
      camisa_salsera: 'Camisa Salsera',
    } as Readonly<Record<CaliOutfitId, string>>,
    applyCta: 'Aplicar y Rodar',
    closeCta: 'Cerrar [G]',
  },

  hud: {
    objectiveTag: 'OBJETIVO',
    tickerTag: 'CALIVIRAL',
    wantedLabel: 'SE BUSCA',
    bustWarning: '¡LA TOMBA TE CIERRA EL PASO!',
    evadingPoliceLabel: 'ESCAPANDO DE LA TOMBA',
    speedUnit: 'km/h',
    metersUnit: 'm',
    nitroLabel: 'NITRO',
    cashCurrency: 'COP',
    stepProgress: (current: number, total: number) => `PASO ${current} DE ${total}`,
    enterVehiclePrompt: '[F] Subir al carro',
    enterNamedVehicle: (name: string) => `[F] Subir a ${name}`,
    hijackNamedVehicle: (name: string) => `[F] Tomar ${name}`,
    exitVehiclePrompt: '[F] Bajar del carro',
    exitMotorcyclePrompt: '[F] Bajarse de la moto',
    directionStraight: 'Sigue derecho',
    directionLeft: 'Gira a la izquierda',
    directionRight: 'Gira a la derecha',
    directionBack: 'Da la vuelta',
    driftLabel: 'DERRAPE',
    driftComboLabel: (mult: number) => `DERRAPE x${mult}`,
    racePosLabel: (pos: number, total: number) => `POS ${pos}/${total}`,
    landmarksLabel: 'Íconos',
    audioMutedBadge: 'Silencio',
    voicesOnLabel: '[V] Voces: ON',
    voicesOffLabel: '[V] Voces: OFF',
    voicesHint: '[V] Voces',
    radioHint: '[R] Radio',
    garageHint: '[G] Garaje',
    hornHint: '[H] Pito',
    pauseHint: '[Esc] Pausa',
    cameraHint: '[C] Cámara',
    timeToggleHint: '[T] Día/Noche',
    qualityHint: '[Q] Calidad gráfica',
  },

  voiceLines: {
    pedestrianFlee: [
      '¡Oís, ve, cuidado!',
      '¡Epa, mirá por dónde vas!',
      '¡Frena pues, parce!',
      '¡Ave María, casi me levantas!',
      '¡Pilas que voy pasando!',
    ] as readonly string[],
    pedestrianAdmire: [
      '¡Qué chimba de carro, ve!',
      '¡Písalo pues, parcera!',
      '¡Mirá esa máquina en Cali!',
      '¡Qué nave tan brava, oís!',
    ] as readonly string[],
    pedestrianHorn: [
      '¡Hágale pues, qué afán, ve!',
      '¡Ya voy, ya voy, no pite tanto, parce!',
      '¡Epa, tranquilo que no es ambulancia, oís!',
      '¡Pite suave que estamos en el Bulevar!',
    ] as readonly string[],
    payNSpray: [
      '¡Quedó como recién salido de vitrina, parce!',
      '¡Pintura lista y cero estrellas, hágale tranquilo!',
      '¡Nadie te reconoce en toda Santiago de Cali, ve!',
    ] as readonly string[],
    policeMegaphone: [
      '¡Alto ahí, Policía Nacional! ¡Orille el vehículo!',
      '¡Central, sospechoso en fuga por las calles de Cali!',
      '¡Deténgase de inmediato, no tiene salida!',
      '¡Atención unidades, cierren los puentes del Río Cali!',
    ] as readonly string[],
  },

  overlays: {
    pause: {
      title: 'Juego en Pausa',
      subtitle: 'Tómate un cholado y vuelve al volante.',
      resume: 'Reanudar',
      restart: 'Reiniciar Misión',
      toggleMute: 'Silenciar Audio',
      toggleUnmute: 'Activar Audio',
      cycleRadio: 'Cambiar Emisora',
      backToTitle: 'Volver al Menú',
    },
    missionPassed: {
      title: '¡MISIÓN CUMPLIDA!',
      subtitle: '¡Qué chimba, parce! Dejaste huella en Cali.',
      rewardLabel: 'Recompensa',
      timeLabel: 'Tiempo',
      newRecordBadge: '¡Nuevo Récord!',
      nextMission: 'Siguiente Misión',
      freeRoam: 'Ir a Modo Libre',
      backToTitle: 'Menú Principal',
    },
    busted: {
      title: '¡Te agarró la tomba!',
      subtitle: 'Las patrullas te cerraron el paso en las calles de Cali. ¡Inténtalo otra vez, ve!',
      retry: 'Reintentar Misión',
      backToTitle: 'Volver al Menú',
    },
    timeUp: {
      title: '¡Se acabó el tiempo!',
      subtitle:
        'El reloj llegó a cero antes de coronar la fiesta en Cristo Rey. ¡Métele más nitro, ve!',
      retry: 'Reintentar Carrera',
      backToTitle: 'Volver al Menú',
    },
    victory: {
      title: '¡LEYENDA DE CALI!',
      subtitle: 'Conquistaste La Sucursal del Cielo desde el Bulevar del Río hasta Cristo Rey.',
      totalCashLabel: 'Botín Total',
      bestTimesLabel: 'Mejores Tiempos',
      landmarksLabel: 'Íconos Descubiertos',
      freeRoamCta: 'Explorar en Modo Libre',
      replayCta: 'Jugar de Nuevo',
      backToTitle: 'Menú Principal',
    },
    webglError: {
      title: 'WebGL no disponible',
      message:
        'Tu navegador no pudo iniciar el motor 3D de Cali. Activa la aceleración de hardware o prueba otro navegador compatible.',
      retry: 'Reintentar',
    },
  },
} as const;

export type LocaleCali = typeof LOCALE_CALI;

/** Reto AcaDevHack: challenge run, leaderboard, prize, and free-course promo copy. */
export const LOCALE_DEVHACK = {
  school: 'AcaDevHack de IA',
  whatsappPhone: '573174498336',
  links: {
    home: 'https://devhack.co/',
    subscription: 'https://devhack.co/academy-ai/suscripcion',
  },
  freeCourses: [
    {
      title: 'Claude Code desde cero',
      detail: 'Curso gratis · 10 lecciones + certificado',
      url: 'https://devhack.co/academy-ai/claude-code-desde-cero/',
    },
    {
      title: 'Claude para todos',
      detail: 'Curso gratis · sin programar',
      url: 'https://devhack.co/academy-ai/claude-para-todos/',
    },
  ],
  titleCard: {
    badge: 'Reto AcaDevHack',
    title: '🏆 Reto AcaDevHack',
    subtitle: '4 misiones seguidas · ranking en vivo',
    description:
      'Juega la Misión 1, 2, 3 y el Tour de Cali sin perder ni una. Tu tiempo sube al ranking y si completas las 4 te ganas 3 meses gratis de la Suscripción AcaDevHack Virtual.',
    cta: 'Aceptar el reto',
    rankingCta: 'Ver ranking',
  },
  coursesTitle: 'Aprende IA gratis con AcaDevHack',
  stageLabels: {
    mission_1_bulevar: 'Misión 1',
    mission_2_cristo_rey: 'Misión 2',
    mission_3_pique_bulevar: 'Misión 3',
    free_roam: 'Tour de Cali',
  },
  hudChip: (stage: number, total: number, time: string): string =>
    `Reto ${stage}/${total} · ${time}`,
  nickname: {
    title: 'Elige tu nickname',
    help: 'De 3 a 16 letras, números o _. Así apareces en el ranking.',
    label: 'Nickname',
    placeholder: 'ej. Parce_23',
    start: 'Arrancar el reto',
    cancel: 'Cancelar',
    checking: 'Verificando nickname…',
    rules:
      'Reglas: las 4 misiones van seguidas. Si te pillan o se acaba el tiempo, el reto arranca otra vez desde la Misión 1.',
    errors: {
      too_short: 'Muy corto: mínimo 3 caracteres.',
      too_long: 'Muy largo: máximo 16 caracteres.',
      invalid_chars: 'Solo letras, números y _ (sin espacios).',
      nickname_taken: 'Ese nickname ya lo tiene otro parce. Prueba otro.',
      offline:
        'Sin conexión con el ranking. Puedes jugar el reto, pero tus tiempos no se guardarán.',
      auth_unavailable:
        'El ranking no está disponible ahora mismo. Puedes jugar, pero tus tiempos no se guardarán.',
      permission_denied: 'El ranking rechazó ese nickname. Prueba otro.',
      unknown: 'Algo falló con el ranking. Intenta de nuevo.',
    },
    playOffline: 'Jugar sin ranking',
  },
  stagePassed: {
    title: '¡Etapa superada!',
    timeLabel: 'Tu tiempo',
    bestLabel: 'Tu mejor marca',
    personalBest: '¡Nuevo récord personal en el ranking!',
    saving: 'Guardando en el ranking…',
    saved: 'Tiempo guardado en el ranking.',
    offline: 'Ranking sin conexión: este tiempo no se guardó.',
    next: 'Siguiente misión',
    ranking: 'Ver ranking',
    quit: 'Salir del reto',
    progress: (done: number, total: number): string => `Llevas ${done} de ${total} misiones`,
  },
  failed: {
    title: 'Reto perdido',
    subtitle: 'En el Reto AcaDevHack no hay segundas: arranca otra vez desde la Misión 1.',
    implausible: 'Ese tiempo no cuadra con la misión. El reto se reinicia desde la Misión 1.',
    retry: 'Reintentar desde la Misión 1',
    quit: 'Volver al inicio',
  },
  winner: {
    title: '¡Ganaste el Reto AcaDevHack!',
    subtitle:
      'Completaste las 4 misiones seguidas. Te ganaste 3 meses gratis de la Suscripción AcaDevHack Virtual.',
    codeLabel: 'Tu código de premio',
    totalLabel: 'Tiempo total',
    registering: 'Registrando tu premio…',
    offline:
      'Sin conexión: tu código no se pudo registrar todavía. Toma captura de esta pantalla y escríbenos por WhatsApp.',
    note: 'Guarda tu código. DevHack verifica cada código antes de activar el premio.',
    claim: 'Reclamar por WhatsApp',
    subscription: 'Ver la suscripción',
    backToTitle: 'Volver al inicio',
    whatsappMessage: (nickname: string, code: string, total: string): string =>
      `Hola DevHack 👋 Gané el Reto AcaDevHack en GTA I - Cali - Colombia. Nickname: ${nickname}. Código: ${code}. Tiempo total: ${total}. Quiero reclamar mis 3 meses gratis de la Suscripción AcaDevHack Virtual.`,
  },
  ranking: {
    title: 'Ranking del Reto AcaDevHack',
    subtitle: 'Top 10 por misión · gana el más rápido',
    loading: 'Cargando ranking…',
    empty: 'Nadie ha marcado tiempo todavía. ¡Sé el primero!',
    offline: 'No pudimos cargar el ranking (sin conexión).',
    you: '(vos)',
    position: '#',
    player: 'Jugador',
    time: 'Tiempo',
    close: 'Cerrar',
  },
} as const;
