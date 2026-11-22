import { describe, expect, it, vi } from 'vitest';
import {
  VoiceEngine,
  selectBestSpanishVoice,
  type SpeechSynthesisLike,
  type SpeechUtteranceLike,
  type SpeechVoiceLike,
} from '../../../src/audio/voiceEngine';

class MockSpeechSynthesis implements SpeechSynthesisLike {
  public voices: SpeechVoiceLike[];
  public readonly spoken: SpeechUtteranceLike[] = [];
  public readonly speak = vi.fn((utterance: SpeechUtteranceLike) => {
    this.spoken.push({ ...utterance });
  });
  public readonly cancel = vi.fn();

  public constructor(voices: SpeechVoiceLike[] = []) {
    this.voices = voices;
  }

  public getVoices(): readonly SpeechVoiceLike[] {
    return this.voices;
  }
}

function createMockUtterance(text: string): SpeechUtteranceLike {
  return {
    text,
    lang: '',
    rate: 1,
    pitch: 1,
    volume: 1,
    voice: null,
  };
}

describe('selectBestSpanishVoice', () => {
  it('returns null when voices list is empty or has no Spanish voices', () => {
    expect(selectBestSpanishVoice([])).toBeNull();
    expect(
      selectBestSpanishVoice([
        { lang: 'en-US', name: 'Samantha' },
        { lang: 'fr-FR', name: 'Thomas' },
        { lang: 'pt-BR', name: 'Luciana' },
      ]),
    ).toBeNull();
  });

  it('follows locale priority es-CO > es-MX/es-419 > es-US > any es* case-insensitively', () => {
    const esEs: SpeechVoiceLike = { lang: 'es-ES', name: 'Jorge' };
    const esUs: SpeechVoiceLike = { lang: 'es-US', name: 'Carlos' };
    const esMx: SpeechVoiceLike = { lang: 'es-MX', name: 'Juan' };
    const es419: SpeechVoiceLike = { lang: 'ES-419', name: 'Latam Voice' };
    const esCo: SpeechVoiceLike = { lang: 'es_co', name: 'Gonzalo' };

    expect(selectBestSpanishVoice([esEs, esUs, esMx, esCo])).toEqual(esCo);
    expect(selectBestSpanishVoice([esEs, esUs, esMx])).toEqual(esMx);
    expect(selectBestSpanishVoice([esEs, esUs, es419])).toEqual(es419);
    expect(selectBestSpanishVoice([esEs, esUs])).toEqual(esUs);
    expect(selectBestSpanishVoice([{ lang: 'en-US', name: 'Alex' }, esEs])).toEqual(esEs);
  });

  it('prefers female Spanish voice names within the best locale tier when preferFemale is true', () => {
    const coMale: SpeechVoiceLike = { lang: 'es-CO', name: 'Gonzalo' };
    const coFemale: SpeechVoiceLike = { lang: 'es-CO', name: 'Camila' };
    const mxFemale: SpeechVoiceLike = { lang: 'es-MX', name: 'Paulina' };

    // Picks female voice inside es-CO tier
    expect(selectBestSpanishVoice([coMale, coFemale, mxFemale], true)).toEqual(coFemale);

    // Does not drop down to es-MX even if es-CO only has male voice
    expect(selectBestSpanishVoice([coMale, mxFemale], true)).toEqual(coMale);

    // Recognizes accented female names (Mónica, Lucía) and generic 'female'
    const esEsMale: SpeechVoiceLike = { lang: 'es-ES', name: 'Jorge' };
    const esEsMonica: SpeechVoiceLike = { lang: 'es-ES', name: 'Mónica' };
    expect(selectBestSpanishVoice([esEsMale, esEsMonica], true)).toEqual(esEsMonica);

    const esMxMale: SpeechVoiceLike = { lang: 'es-MX', name: 'Juan' };
    const esMxGenericFemale: SpeechVoiceLike = { lang: 'es-MX', name: 'Google Spanish Female' };
    expect(selectBestSpanishVoice([esMxMale, esMxGenericFemale], true)).toEqual(esMxGenericFemale);
  });
});

describe('VoiceEngine', () => {
  it('operates as a safe silent no-op when SpeechSynthesis or utterance API is unavailable', () => {
    const headlessEngine = new VoiceEngine({
      synthFactory: () => null,
      utteranceFactory: () => null,
    });

    expect(() => {
      expect(headlessEngine.isEnabled()).toBe(true);
      expect(headlessEngine.isMuted()).toBe(false);
      expect(headlessEngine.speak('¡Quiubo pues!', 'valeria')).toBe(false);
      headlessEngine.setEnabled(false);
      expect(headlessEngine.toggleEnabled()).toBe(true);
      headlessEngine.setMuted(true);
      headlessEngine.dispose();
    }).not.toThrow();

    // Also safe with default browser factories in Node/Vitest environment
    const defaultEngine = new VoiceEngine();
    expect(() => {
      defaultEngine.speak('¡Dale pues!', 'valeria');
      defaultEngine.dispose();
    }).not.toThrow();
  });

  it('applies distinct voice profiles, selects best Spanish voices, and falls back to es-CO lang', () => {
    let now = 10_000;
    const coMale: SpeechVoiceLike = { lang: 'es-CO', name: 'Gonzalo' };
    const coFemale: SpeechVoiceLike = { lang: 'es-CO', name: 'Camila' };
    const synth = new MockSpeechSynthesis([coMale, coFemale]);

    const engine = new VoiceEngine({
      synthFactory: () => synth,
      utteranceFactory: createMockUtterance,
      nowMs: () => now,
    });

    expect(engine.speak('¡Arrancamos por el Bulevar!', 'valeria')).toBe(true);
    const valeriaUtterance = synth.spoken[0];
    expect(valeriaUtterance).toBeDefined();
    expect(valeriaUtterance?.rate).toBeCloseTo(1.04, 2);
    expect(valeriaUtterance?.pitch).toBeCloseTo(1.12, 2);
    expect(valeriaUtterance?.volume).toBeCloseTo(0.92, 2);
    expect(valeriaUtterance?.voice).toEqual(coFemale);
    expect(valeriaUtterance?.lang).toBe('es-CO');

    expect(engine.speak('¡Pilas con la Policía, Valeria!', 'mateo')).toBe(true);
    const mateoUtterance = synth.spoken[1];
    expect(mateoUtterance?.rate).toBeCloseTo(1.08, 2);
    expect(mateoUtterance?.pitch).toBeCloseTo(0.88, 2);
    expect(mateoUtterance?.volume).toBeCloseTo(0.90, 2);

    expect(engine.speak('Misión iniciada.', 'system')).toBe(true);
    const systemUtterance = synth.spoken[2];
    expect(systemUtterance?.rate).toBeCloseTo(1.04, 2);
    expect(systemUtterance?.pitch).toBeCloseTo(1.0, 2);
    expect(systemUtterance?.volume).toBeCloseTo(0.82, 2);

    // Advance past 3500ms mission protection window for police callout
    now += 4000;
    expect(engine.speak('¡Alto ahí, Policía Nacional!', 'police')).toBe(true);
    const policeUtterance = synth.spoken[3];
    expect(policeUtterance?.rate).toBeCloseTo(1.06, 2);
    expect(policeUtterance?.pitch).toBeCloseTo(0.82, 2);
    expect(policeUtterance?.volume).toBeCloseTo(0.94, 2);

    // Empty voice list still populates fallback lang 'es-CO'
    synth.voices = [];
    now += 9000;
    expect(engine.speak('¡Orille el vehículo!', 'police')).toBe(true);
    const fallbackUtterance = synth.spoken[4];
    expect(fallbackUtterance?.voice).toBeNull();
    expect(fallbackUtterance?.lang).toBe('es-CO');
  });

  it('cycles pedestrian pitch across 5 variations and alternates female voice preference', () => {
    let now = 0;
    const coMale: SpeechVoiceLike = { lang: 'es-CO', name: 'Gonzalo' };
    const coFemale: SpeechVoiceLike = { lang: 'es-CO', name: 'Jimena' };
    const synth = new MockSpeechSynthesis([coMale, coFemale]);

    const engine = new VoiceEngine({
      synthFactory: () => synth,
      utteranceFactory: createMockUtterance,
      nowMs: () => now,
    });

    const expectedPitches = [0.92, 1.08, 1.18, 0.96, 1.14, 0.92];
    const pickedVoices: Array<SpeechVoiceLike | null> = [];

    for (let i = 0; i < expectedPitches.length; i++) {
      expect(engine.speak(`¡Oís, ve, cuidado ${i}!`, 'pedestrian')).toBe(true);
      const u = synth.spoken[i];
      expect(u?.rate).toBeCloseTo(1.1, 2);
      expect(u?.volume).toBeCloseTo(0.78, 2);
      expect(u?.pitch).toBeCloseTo(expectedPitches[i] ?? 1, 2);
      pickedVoices.push(u?.voice ?? null);
      now += 6500;
    }

    // Consecutive pedestrian callouts alternate between female and non-female preference
    for (let i = 1; i < pickedVoices.length; i++) {
      expect(pickedVoices[i]?.name).not.toBe(pickedVoices[i - 1]?.name);
    }
  });

  it('enforces mission priority cancellation, 3500ms protection window, and per-profile callout cooldowns', () => {
    let now = 1000;
    const synth = new MockSpeechSynthesis([{ lang: 'es-CO', name: 'Camila' }]);
    const engine = new VoiceEngine({
      synthFactory: () => synth,
      utteranceFactory: createMockUtterance,
      nowMs: () => now,
    });

    // Empty / whitespace text is ignored
    expect(engine.speak('   ', 'valeria')).toBe(false);
    expect(synth.speak).not.toHaveBeenCalled();

    // Mission dialogue cancels current speech and speaks immediately
    expect(engine.speak('¡Vamos rumbo a Cristo Rey!', 'valeria')).toBe(true);
    expect(synth.cancel).toHaveBeenCalledTimes(1);
    expect(synth.speak).toHaveBeenCalledTimes(1);

    // Callouts within 3500ms of mission dialogue are blocked
    now += 3499;
    expect(engine.speak('¡Oís, ve!', 'pedestrian')).toBe(false);
    expect(engine.speak('¡Alto ahí!', 'police')).toBe(false);
    expect(synth.speak).toHaveBeenCalledTimes(1);

    // At exactly +3500ms, callouts are allowed without calling cancel()
    now += 1;
    expect(engine.speak('¡Qué chimba de carro!', 'pedestrian')).toBe(true);
    expect(synth.cancel).toHaveBeenCalledTimes(1);
    expect(synth.speak).toHaveBeenCalledTimes(2);

    // Pedestrian cooldown is 6500ms; police has its own independent 8000ms cooldown
    now += 1000;
    expect(engine.speak('¡Frena pues!', 'pedestrian')).toBe(false);
    expect(engine.speak('¡Alto ahí, Policía Nacional!', 'police')).toBe(true);
    expect(synth.speak).toHaveBeenCalledTimes(3);

    // Police blocked before 8000ms elapsed
    now += 5500; // total since pedestrian = 6500ms, total since police = 5500ms
    expect(engine.speak('¡Epa, mirá!', 'pedestrian')).toBe(true);
    expect(engine.speak('¡Deténgase!', 'police')).toBe(false);
    expect(synth.speak).toHaveBeenCalledTimes(4);

    // Police allowed once 8000ms elapsed
    now += 2500; // total since police = 8000ms
    expect(engine.speak('¡Deténgase de inmediato!', 'police')).toBe(true);
    expect(synth.speak).toHaveBeenCalledTimes(5);
  });

  it('handles setEnabled, toggleEnabled, setMuted, and dispose with speech cancellation', () => {
    let now = 5000;
    const synth = new MockSpeechSynthesis([{ lang: 'es-CO', name: 'Camila' }]);
    const engine = new VoiceEngine({
      synthFactory: () => synth,
      utteranceFactory: createMockUtterance,
      nowMs: () => now,
    });

    expect(engine.isEnabled()).toBe(true);
    engine.setEnabled(false);
    expect(engine.isEnabled()).toBe(false);
    expect(synth.cancel).toHaveBeenCalledTimes(1);
    expect(engine.speak('Bloqueado', 'valeria')).toBe(false);

    expect(engine.toggleEnabled()).toBe(true);
    expect(engine.isEnabled()).toBe(true);
    expect(engine.speak('Activo', 'valeria')).toBe(true);
    expect(synth.speak).toHaveBeenCalledTimes(1);

    engine.setMuted(true);
    expect(engine.isMuted()).toBe(true);
    expect(synth.cancel).toHaveBeenCalledTimes(3); // 1 from setEnabled(false), 1 from mission speak, 1 from setMuted(true)
    expect(engine.speak('Silenciado', 'valeria')).toBe(false);

    engine.setMuted(false);
    now += 1000;
    expect(engine.speak('Con sonido', 'valeria')).toBe(true);
    expect(synth.speak).toHaveBeenCalledTimes(2);

    engine.dispose();
    expect(synth.cancel).toHaveBeenCalledTimes(5);
    expect(engine.speak('Post dispose', 'valeria')).toBe(false);
  });
});
