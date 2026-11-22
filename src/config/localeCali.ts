/**
 * Authentic Español Caleño player-facing copy for GTA VI: Cali (La Sucursal del Cielo).
 * All UI labels, mission copy, radio labels, dialogues, and news tickers live exclusively here.
 */

import type {
  CameraMode,
  DialogueSpeaker,
  LandmarkId,
  MissionId,
  RadioStationId,
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

export const LOCALE_CALI = {
  brand: {
    title: 'GTA VI: CALI',
    subtitle: 'La Sucursal del Cielo',
    tagline: 'Atardecer vallecaucano, salsa brava y velocidad sin frenos.',
    cityName: 'Santiago de Cali',
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
    { keys: 'R', action: 'Cambiar emisora FM' },
    { keys: 'C', action: 'Cambiar cámara' },
    { keys: 'Esc', action: 'Pausa' },
  ] as readonly ControlHintItem[],

  missions: {
    mission_1_bulevar: {
      title: 'Fuga en el Bulevar',
      subtitle: 'Misión 01 · Centro & Río Cali',
      description:
        'Recoge el vinilo maestro en la Torre de Cali, atraviesa el Bulevar del Río y escapa de la tomba rumbo a La Ermita.',
      rewardCop: 250_000,
      badge: 'Misión 1',
    },
    mission_2_cristo_rey: {
      title: 'Noche de Salsa en Cristo Rey',
      subtitle: 'Misión 02 · Estadio & Cerro Los Cristales',
      description:
        'Recoge a Mateo y los parlantes frente al Estadio Pascual Guerrero y sube a toda mecha hasta el Mirador de Cristo Rey.',
      rewardCop: 500_000,
      badge: 'Misión 2',
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
    },
    mission2: {
      enterVehicleLabel: 'Prende motores para la rumba',
      enterVehicleDetail: 'Presiona [F] para subirte al deportivo y activar el nitro.',
      stageLabel: 'Recoge a Mateo en el Estadio Pascual',
      stageDetail: 'Cruza el puente sur hacia la Calle 5 frente al Estadio Pascual Guerrero.',
      rampLabel: 'Toma la rampa hacia Cristo Rey',
      rampDetail:
        'Gira al oeste en Av. Circunvalar (Calle 13) para subir al Cerro Los Cristales.',
      summitLabel: 'Sube al Mirador de Cristo Rey',
      summitDetail: 'Toma la rampa oeste hacia el Cerro Los Cristales hasta la cima.',
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
      text: '¡Quiubo, parce! Móntate en el Banshee que el vinilo maestro nos espera en la Torre de Cali.',
    },
    m1Pickup: {
      speaker: 'mateo' as const,
      text: '¡Lo tenemos, ve! Pero ojito que la tomba ya prendió sirenas por el Bulevar del Río. ¡Métele nitro!',
    },
    m1Bulevar: {
      speaker: 'valeria' as const,
      text: '¡Qué chimba de derrape! Cruza el Puente de La Ermita y los perdemos frente a la iglesia, ¡oís!',
    },
    m1Passed: {
      speaker: 'mateo' as const,
      text: '¡Coronamos, parce! Nadie nos alcanza en la Sucursal del Cielo. ¡Ahora vamos por Cristo Rey!',
    },
    m2Intro: {
      speaker: 'mateo' as const,
      text: '¡Esta noche retumba toda Cali! Pasa por mí al Estadio Pascual Guerrero que tengo los parlantes listos.',
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
    freeRoamIntro: {
      speaker: 'valeria' as const,
      text: '¡Relájate, oís! Tienes toda Cali pa’ vos: San Antonio, el Bulevar, La Ermita, el Pascual y Cristo Rey.',
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
      title: 'FUGA EN EL BULEVAR',
      subtitle: 'Arranca desde San Antonio hacia la Torre de Cali.',
    },
    m1Pickup: {
      title: '¡VINILO ASEGURADO!',
      subtitle: 'La tomba viene detrás — cruza el Bulevar del Río.',
    },
    m1Bulevar: {
      title: '¡BULEVAR SUPERADO!',
      subtitle: 'Cruza el Puente de La Ermita para escapar.',
    },
    m2Start: {
      title: 'NOCHE DE SALSA',
      subtitle: 'Recoge a Mateo frente al Estadio Pascual Guerrero.',
    },
    m2Stage: {
      title: '¡PARLANTES A BORDO!',
      subtitle: 'Escapa hacia la rampa de Av. Circunvalar.',
    },
    m2Ramp: {
      title: '¡RUMBO A CRISTO REY!',
      subtitle: 'Sube a toda mecha por el Cerro Los Cristales.',
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

  landmarks: {
    san_antonio: 'Barrio San Antonio',
    torre_de_cali: 'Torre de Cali',
    bulevar_del_rio: 'Bulevar del Río',
    la_ermita: 'Iglesia La Ermita',
    estadio_pascual: 'Estadio Pascual Guerrero',
    cristo_rey: 'Mirador de Cristo Rey',
  } as Readonly<Record<LandmarkId, string>>,

  vehicleNames: {
    banshee: 'Ferrari Caleño',
    taxi: 'Taxi Amarillito',
    mio_bus: 'Bus MIO',
    chiva: 'Chiva Rumbera',
    police: 'Patrulla Policía',
  } as Readonly<Record<VehicleKind, string>>,

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
    directionStraight: 'Sigue derecho',
    directionLeft: 'Gira a la izquierda',
    directionRight: 'Gira a la derecha',
    directionBack: 'Da la vuelta',
    driftLabel: 'DERRAPE',
    landmarksLabel: 'Íconos',
    audioMutedBadge: 'Silencio',
    radioHint: '[R] Radio',
    pauseHint: '[Esc] Pausa',
    cameraHint: '[C] Cámara',
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
