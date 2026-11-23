/**
 * City and advertising copy that is ALWAYS Español Caleño, whatever the UI language:
 * billboards, the bank sign, the #CaliViral news ticker, radio stations and Radio IA ads, and the
 * shouts of pedestrians, police and the Pay'n'Spray crew. Both locales reference these objects.
 */

import type { RadioStationId } from '../types/game';

export const CITY_COPY = {
  devhackAds: {
    footer: 'devhack.co',
    brandTag: 'AcaDevHack de IA',
    messages: {
      school: { headline: 'AcaDevHack de IA', tagline: 'Escuela de IA aplicada' },
      claude_code_course: { headline: 'Curso GRATIS', tagline: 'Claude Code desde cero' },
      claude_for_all: { headline: 'Claude para todos', tagline: 'Curso gratis · sin programar' },
      subscription: { headline: 'Suscripción AcaDevHack', tagline: '$13 USD/mes · devhack.co' },
      future: { headline: 'Arquitectando el Futuro con IA', tagline: 'DevHack' },
      reto: { headline: 'Reto AcaDevHack', tagline: '5 misiones · gana 3 meses gratis' },
    },
  },

  learningWorld: {
    bankSign: 'BANCO SUCURSAL IA',
    bankTagline: 'Bóveda de prompts · abierto 24/7',
    cardTag: 'CARTA CLAUDE',
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

  radioAds: [
    'Radio IA, noventa y nueve punto uno. ¿Sabías que con CLAUDE.md, Claude se acuerda de tu proyecto? Curso gratis en devhack punto co.',
    'Oiga, ve: antes de programar, el modo Plan de Claude Code te muestra qué va a hacer. Aprende gratis en AcaDevHack.',
    'Pedile bien a Claude: rol, contexto, tarea y formato. Curso Claude para todos, gratis en devhack punto co.',
    '¿La conversación ya está muy larga? Barra compact y seguís sin perder el hilo. AcaDevHack, la escuela de IA de Cali.',
  ] as readonly string[],
} as const;
