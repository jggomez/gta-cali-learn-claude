/**
 * Offline Web Speech API (es-CO) voice synthesis engine for GTA I - Cali - Colombia.
 * Provides character voice profiles, quality- and locale-ranked Spanish voice selection
 * (premium/neural voices first, novelty voices never), natural-delivery text cleanup,
 * anti-spam cooldown queuing, and safe silent no-op execution in headless environments.
 */

import { LOCALE_CALI } from '../config/localeCali';

export type VoiceProfile =
  | 'valeria'
  | 'mateo'
  | 'police'
  | 'pedestrian'
  | 'system'
  | 'narrator';

export type VoicePriority = 'mission' | 'callout';

export interface SpeechVoiceLike {
  readonly lang: string;
  readonly name: string;
  /** False for browser voices streamed from the network (e.g. Chrome's "Google español"). */
  readonly localService?: boolean;
}

export interface SpeechUtteranceLike {
  text: string;
  lang: string;
  rate: number;
  pitch: number;
  volume: number;
  voice: SpeechVoiceLike | null;
}

export interface SpeechSynthesisLike {
  getVoices(): readonly SpeechVoiceLike[];
  speak(utterance: SpeechUtteranceLike): void;
  cancel(): void;
}

export interface VoiceEngineOptions {
  readonly synthFactory?: () => SpeechSynthesisLike | null;
  readonly utteranceFactory?: (text: string) => SpeechUtteranceLike | null;
  readonly enabled?: boolean;
  readonly muted?: boolean;
  readonly nowMs?: () => number;
  /** Whether network-streamed voices may be used (defaults to `navigator.onLine`, else true). */
  readonly isOnline?: () => boolean;
}

interface VoiceProfileConfig {
  readonly rate: number;
  readonly pitch: number;
  readonly volume: number;
  readonly preferFemale: boolean;
  readonly defaultPriority: VoicePriority;
}

const FALLBACK_LANG = 'es-CO';
const MISSION_PROTECT_WINDOW_MS = 3500;
const POLICE_CALLOUT_COOLDOWN_MS = 8000;
const PEDESTRIAN_CALLOUT_COOLDOWN_MS = 6500;
const NARRATOR_CALLOUT_COOLDOWN_MS = 4000;

/** Small pitch offsets only: big pitch shifts are what makes synthetic speech sound robotic. */
const PEDESTRIAN_PITCH_CYCLE: readonly number[] = [0.97, 1.03, 1.06, 0.96, 1.01];

/** Lines longer than this are split into phrases (Chrome cuts long utterances after ~15 s). */
const LONG_LINE_CHARS = 160;

const FEMALE_SPANISH_VOICE_TOKENS: readonly string[] = [
  'paulina',
  'monica',
  'mónica',
  'soledad',
  'sabina',
  'laura',
  'elena',
  'paloma',
  'marisol',
  'lucia',
  'lucía',
  'jimena',
  'camila',
  'salome',
  'salomé',
  'female',
];

const STATIC_PROFILE_CONFIG: Readonly<Record<VoiceProfile, VoiceProfileConfig>> = {
  valeria: {
    rate: 1.02,
    pitch: 1.03,
    volume: 0.92,
    preferFemale: true,
    defaultPriority: 'mission',
  },
  mateo: {
    rate: 1.03,
    pitch: 0.97,
    volume: 0.9,
    preferFemale: false,
    defaultPriority: 'mission',
  },
  police: {
    rate: 1.05,
    pitch: 0.97,
    volume: 0.94,
    preferFemale: false,
    defaultPriority: 'callout',
  },
  pedestrian: {
    rate: 1.04,
    pitch: 1.0,
    volume: 0.78,
    preferFemale: false,
    defaultPriority: 'callout',
  },
  system: {
    rate: 1.0,
    pitch: 1.0,
    volume: 0.82,
    preferFemale: false,
    defaultPriority: 'mission',
  },
  narrator: {
    rate: 1.0,
    pitch: 1.0,
    volume: 0.88,
    preferFemale: false,
    defaultPriority: 'callout',
  },
};

const CALLOUT_COOLDOWN_BY_PROFILE_MS: Readonly<Partial<Record<VoiceProfile, number>>> = {
  police: POLICE_CALLOUT_COOLDOWN_MS,
  pedestrian: PEDESTRIAN_CALLOUT_COOLDOWN_MS,
  narrator: NARRATOR_CALLOUT_COOLDOWN_MS,
};

const nativeUtteranceMap = new WeakMap<SpeechUtteranceLike, SpeechSynthesisUtterance>();

function normalizeLang(rawLang: string): string {
  return rawLang.trim().toLowerCase().replace(/_/g, '-');
}

function getSpanishLocaleTier(rawLang: string): number | null {
  const lang = normalizeLang(rawLang);
  if (lang === 'es-co' || lang.startsWith('es-co-')) {
    return 0;
  }
  if (
    lang === 'es-mx' ||
    lang.startsWith('es-mx-') ||
    lang === 'es-419' ||
    lang.startsWith('es-419-')
  ) {
    return 1;
  }
  if (lang === 'es-us' || lang.startsWith('es-us-')) {
    return 2;
  }
  if (lang === 'es' || lang.startsWith('es-')) {
    return 3;
  }
  return null;
}

function isFemaleSpanishVoiceName(name: string): boolean {
  const lowered = name.toLowerCase();
  return FEMALE_SPANISH_VOICE_TOKENS.some((token) => lowered.includes(token));
}

/** Voice quality tiers, best first. `null` means "never use" (novelty voices). */
const PREMIUM_VOICE_TOKENS: readonly string[] = [
  'premium',
  'enhanced',
  'mejorada',
  'natural',
  'neural',
  'siri',
  'online',
];

/** macOS Eloquence voices: available everywhere but clearly synthetic. */
const ELOQUENCE_VOICE_TOKENS: readonly string[] = [
  'eddy',
  'flo',
  'grandma',
  'grandpa',
  'reed',
  'rocko',
  'sandy',
  'shelley',
];

/** macOS novelty/effect voices that must never narrate the game. */
const NOVELTY_VOICE_TOKENS: readonly string[] = [
  'bad news',
  'bahh',
  'bells',
  'boing',
  'bubbles',
  'cellos',
  'good news',
  'jester',
  'organ',
  'superstar',
  'trinoids',
  'whisper',
  'wobble',
  'zarvox',
  'albert',
];

export interface VoiceSelectionOptions {
  /** When false, network-streamed voices are ranked below every local voice. */
  readonly online?: boolean;
}

/**
 * Quality tier for a voice (lower is better): 0 premium/neural, 1 network voices while online,
 * 2 standard local voices, 3 Eloquence, 4 network voices while offline; `null` excludes it.
 */
export function voiceQualityTier(voice: SpeechVoiceLike, options: VoiceSelectionOptions = {}): number | null {
  const name = voice.name.toLowerCase();
  if (NOVELTY_VOICE_TOKENS.some((token) => name.includes(token))) {
    return null;
  }
  const isNetwork = voice.localService === false || name.includes('google');
  if (PREMIUM_VOICE_TOKENS.some((token) => name.includes(token))) {
    return isNetwork && options.online === false ? 4 : 0;
  }
  if (isNetwork) {
    return options.online === false ? 4 : 1;
  }
  if (ELOQUENCE_VOICE_TOKENS.some((token) => name.split(/[\s(]+/)[0] === token)) {
    return 3;
  }
  return 2;
}

/**
 * Picks the most natural Spanish voice: quality tier first, then locale (es-CO > es-419/MX >
 * es-US > es), then the requested gender within the best group.
 */
export function selectBestSpanishVoice(
  voices: readonly SpeechVoiceLike[],
  preferFemale?: boolean,
  options: VoiceSelectionOptions = {},
): SpeechVoiceLike | null {
  let bestKey = Number.POSITIVE_INFINITY;
  let bestVoices: SpeechVoiceLike[] = [];

  for (const voice of voices) {
    const localeTier = getSpanishLocaleTier(voice.lang);
    if (localeTier === null) {
      continue;
    }
    const qualityTier = voiceQualityTier(voice, options);
    if (qualityTier === null) {
      continue;
    }
    const key = qualityTier * 10 + localeTier;
    if (key < bestKey) {
      bestKey = key;
      bestVoices = [voice];
    } else if (key === bestKey) {
      bestVoices.push(voice);
    }
  }

  if (bestVoices.length === 0) {
    return null;
  }

  if (preferFemale === true) {
    const femaleMatch = bestVoices.find((v) => isFemaleSpanishVoiceName(v.name));
    if (femaleMatch) {
      return femaleMatch;
    }
  } else if (preferFemale === false) {
    const nonFemaleMatch = bestVoices.find((v) => !isFemaleSpanishVoiceName(v.name));
    if (nonFemaleMatch) {
      return nonFemaleMatch;
    }
  }

  return bestVoices[0] ?? null;
}

const EMOJI_PATTERN = /\p{Extended_Pictographic}|\u{FE0F}|\u{200D}|[✦★☆]/gu;

/**
 * Normalizes HUD-flavoured copy into something a Spanish TTS voice reads naturally:
 * drops key hints and emojis, reads money in words and pronounces brand names like a caleño.
 */
export function prepareSpokenText(text: string): string {
  return text
    .replace(EMOJI_PATTERN, '')
    .replace(/\[(?:[A-Za-z0-9]{1,5}|Esc)\]\s*/g, '')
    .replace(/\$\s?([\d.]+)\.000\.000\s*(?:COP)?/g, '$1 millones de pesos')
    .replace(/\$\s?([\d.]+)\.000\s*(?:COP)?/g, '$1 mil pesos')
    .replace(/\bCOP\b/g, 'pesos')
    .replace(/(^|\s)\/([a-z]+)/g, '$1$2')
    .replace(/#CaliViral/g, 'Cali Viral')
    .replace(/AcaDevHack/g, 'Aca Dev Jack')
    .replace(/DevHack/g, 'Dev Jack')
    .replace(/\bClaude\b/g, 'Clod')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Splits a long line into sentence-sized phrases so engines pause naturally and never cut off. */
export function splitIntoPhrases(text: string, maxChars = LONG_LINE_CHARS): string[] {
  if (text.length <= maxChars) {
    return text.length > 0 ? [text] : [];
  }
  const sentences = text.match(/[^.!?;…]+[.!?;…]+["»)]*|[^.!?;…]+$/g) ?? [text];
  const phrases: string[] = [];
  let current = '';
  for (const raw of sentences) {
    const sentence = raw.trim();
    if (sentence.length === 0) continue;
    if (current.length > 0 && current.length + sentence.length + 1 > maxChars) {
      phrases.push(current);
      current = sentence;
    } else {
      current = current.length > 0 ? `${current} ${sentence}` : sentence;
    }
  }
  if (current.length > 0) phrases.push(current);
  return phrases;
}

function defaultIsOnline(): boolean {
  try {
    return typeof navigator === 'undefined' || navigator.onLine !== false;
  } catch {
    return true;
  }
}

function createDefaultSynth(): SpeechSynthesisLike | null {
  if (typeof globalThis === 'undefined' || !('speechSynthesis' in globalThis)) {
    return null;
  }
  try {
    const nativeSynth = globalThis.speechSynthesis;
    if (!nativeSynth || typeof nativeSynth.speak !== 'function') {
      return null;
    }
    return {
      getVoices(): readonly SpeechVoiceLike[] {
        return nativeSynth.getVoices();
      },
      speak(utterance: SpeechUtteranceLike): void {
        const existingNative = nativeUtteranceMap.get(utterance);
        let nativeUtterance: SpeechSynthesisUtterance;
        if (existingNative) {
          nativeUtterance = existingNative;
        } else if (typeof SpeechSynthesisUtterance === 'function') {
          nativeUtterance = new SpeechSynthesisUtterance(utterance.text);
        } else {
          return;
        }
        nativeUtterance.text = utterance.text;
        nativeUtterance.lang = utterance.lang;
        nativeUtterance.rate = utterance.rate;
        nativeUtterance.pitch = utterance.pitch;
        nativeUtterance.volume = utterance.volume;
        if (utterance.voice) {
          const targetVoice = utterance.voice;
          const nativeVoice =
            nativeSynth
              .getVoices()
              .find((v) => v.name === targetVoice.name && v.lang === targetVoice.lang) ?? null;
          nativeUtterance.voice = nativeVoice;
        } else {
          nativeUtterance.voice = null;
        }
        nativeSynth.speak(nativeUtterance);
      },
      cancel(): void {
        nativeSynth.cancel();
      },
    };
  } catch {
    return null;
  }
}

function createDefaultUtterance(text: string): SpeechUtteranceLike | null {
  if (typeof SpeechSynthesisUtterance !== 'function') {
    return null;
  }
  try {
    const native = new SpeechSynthesisUtterance(text);
    const wrapper: SpeechUtteranceLike = {
      text: native.text,
      lang: native.lang,
      rate: native.rate,
      pitch: native.pitch,
      volume: native.volume,
      voice: null,
    };
    nativeUtteranceMap.set(wrapper, native);
    return wrapper;
  } catch {
    return null;
  }
}

export class VoiceEngine {
  private synth: SpeechSynthesisLike | null;
  private readonly utteranceFactory: (text: string) => SpeechUtteranceLike | null;
  private readonly nowMs: () => number;
  private readonly isOnline: () => boolean;
  private lastVoiceName: string | null = null;

  private enabled: boolean;
  private muted: boolean;
  private disposed = false;

  private lastMissionSpeakMs: number | null = null;
  private readonly lastCalloutByProfile = new Map<VoiceProfile, number>();
  private readonly lineCursorByPool = new Map<string, number>();
  private pedestrianSpeakIndex = 0;

  public constructor(options: VoiceEngineOptions = {}) {
    const synthFactory = options.synthFactory ?? createDefaultSynth;
    this.utteranceFactory = options.utteranceFactory ?? createDefaultUtterance;
    this.enabled = options.enabled ?? true;
    this.muted = options.muted ?? false;
    this.nowMs = options.nowMs ?? (() => Date.now());
    this.isOnline = options.isOnline ?? defaultIsOnline;

    try {
      this.synth = synthFactory();
    } catch {
      this.synth = null;
    }
  }

  /** Name of the last voice used (debug / E2E evidence), or null before the first line. */
  public getLastVoiceName(): string | null {
    return this.lastVoiceName;
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.safeCancel();
    }
  }

  public toggleEnabled(): boolean {
    this.setEnabled(!this.enabled);
    return this.enabled;
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    if (muted) {
      this.safeCancel();
    }
  }

  public speak(text: string, profile: VoiceProfile, priority?: VoicePriority): boolean {
    if (this.disposed || !this.enabled || this.muted || !this.synth) {
      return false;
    }

    const trimmed = prepareSpokenText(text);
    if (trimmed.length === 0) {
      return false;
    }

    const profileConfig = STATIC_PROFILE_CONFIG[profile];
    const effectivePriority: VoicePriority = priority ?? profileConfig.defaultPriority;
    const now = this.nowMs();

    if (effectivePriority === 'callout' && !this.canSpeakCallout(profile, now)) {
      return false;
    }

    const phrases = splitIntoPhrases(trimmed);
    const utterances: SpeechUtteranceLike[] = [];
    for (const phrase of phrases) {
      const utterance = this.safeCreateUtterance(phrase);
      if (!utterance) {
        return false;
      }
      utterances.push(utterance);
    }

    const { pitch, preferFemale } = this.resolveProfileDelivery(profile, profileConfig);
    const voices = this.safeGetVoices();
    const selectedVoice = selectBestSpanishVoice(voices, preferFemale, { online: this.safeIsOnline() });

    utterances.forEach((utterance, index) => {
      utterance.text = phrases[index] ?? '';
      utterance.rate = profileConfig.rate;
      utterance.pitch = pitch;
      utterance.volume = profileConfig.volume;
      utterance.voice = selectedVoice;
      utterance.lang = selectedVoice?.lang || FALLBACK_LANG;
    });

    if (effectivePriority === 'mission') {
      this.safeCancel();
    }

    try {
      for (const utterance of utterances) {
        this.synth.speak(utterance);
      }
    } catch {
      return false;
    }
    this.lastVoiceName = selectedVoice?.name ?? null;

    if (effectivePriority === 'mission') {
      this.lastMissionSpeakMs = now;
    } else {
      this.lastCalloutByProfile.set(profile, now);
    }

    if (profile === 'pedestrian') {
      this.pedestrianSpeakIndex += 1;
    }

    return true;
  }

  public speakRandomLine(
    lines: readonly string[],
    profile: VoiceProfile,
    priority?: VoicePriority,
  ): boolean {
    if (lines.length === 0) {
      return false;
    }
    const poolKey = `${profile}:${lines[0] ?? ''}:${lines.length}`;
    const cursor = this.lineCursorByPool.get(poolKey) ?? 0;
    const line = lines[cursor % lines.length];
    if (!line) {
      return false;
    }
    const spoken = this.speak(line, profile, priority);
    if (spoken) {
      this.lineCursorByPool.set(poolKey, (cursor + 1) % lines.length);
    }
    return spoken;
  }

  public speakPedestrianHornReaction(
    lines: readonly string[] = LOCALE_CALI.voiceLines.pedestrianHorn,
  ): boolean {
    return this.speakRandomLine(lines, 'pedestrian', 'callout');
  }

  public speakPayNSprayCallout(
    lines: readonly string[] = LOCALE_CALI.voiceLines.payNSpray,
    profile: VoiceProfile = 'mateo',
    priority: VoicePriority = 'callout',
  ): boolean {
    return this.speakRandomLine(lines, profile, priority);
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.safeCancel();
    this.synth = null;
  }

  private canSpeakCallout(profile: VoiceProfile, now: number): boolean {
    if (
      this.lastMissionSpeakMs !== null &&
      now - this.lastMissionSpeakMs < MISSION_PROTECT_WINDOW_MS
    ) {
      return false;
    }

    const cooldownMs = CALLOUT_COOLDOWN_BY_PROFILE_MS[profile] ?? 0;
    if (cooldownMs > 0) {
      const lastSpokenMs = this.lastCalloutByProfile.get(profile);
      if (lastSpokenMs !== undefined && now - lastSpokenMs < cooldownMs) {
        return false;
      }
    }

    return true;
  }

  private resolveProfileDelivery(
    profile: VoiceProfile,
    config: VoiceProfileConfig,
  ): { readonly pitch: number; readonly preferFemale: boolean } {
    if (profile === 'pedestrian') {
      const pitch =
        PEDESTRIAN_PITCH_CYCLE[this.pedestrianSpeakIndex % PEDESTRIAN_PITCH_CYCLE.length] ??
        config.pitch;
      const preferFemale = this.pedestrianSpeakIndex % 2 === 1;
      return { pitch, preferFemale };
    }
    return { pitch: config.pitch, preferFemale: config.preferFemale };
  }

  private safeIsOnline(): boolean {
    try {
      return this.isOnline();
    } catch {
      return true;
    }
  }

  private safeGetVoices(): readonly SpeechVoiceLike[] {
    if (!this.synth) {
      return [];
    }
    try {
      return this.synth.getVoices();
    } catch {
      return [];
    }
  }

  private safeCreateUtterance(text: string): SpeechUtteranceLike | null {
    try {
      return this.utteranceFactory(text);
    } catch {
      return null;
    }
  }

  private safeCancel(): void {
    if (!this.synth) {
      return;
    }
    try {
      this.synth.cancel();
    } catch {
      // Safe no-op when speech synthesis cancel is unavailable in restricted contexts.
    }
  }
}
