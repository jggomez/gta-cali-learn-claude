/**
 * Active player-facing locale for GTA I - Cali - Colombia. Spanish copy lives in `localeEs.ts`,
 * English in `localeEn.ts`, and city/advertising copy (always Español Caleño) in `localeCity.ts`.
 * Every consumer imports `LOCALE_CALI` / `LOCALE_DEVHACK` from here.
 */

import { ACTIVE_LANGUAGE } from './language';
import { LOCALE_CALI_EN, LOCALE_DEVHACK_EN } from './localeEn';
import {
  LOCALE_CALI_ES,
  LOCALE_DEVHACK_ES,
  type LocaleCaliShape,
  type LocaleDevhackShape,
} from './localeEs';

export type { ControlHintItem, GaragePaintPreset, LocaleCaliShape, LocaleDevhackShape, MissionCopy } from './localeEs';
export { LOCALE_CALI_ES, LOCALE_DEVHACK_ES } from './localeEs';
export { ACTIVE_LANGUAGE } from './language';

export const LOCALE_CALI: LocaleCaliShape = ACTIVE_LANGUAGE === 'en' ? LOCALE_CALI_EN : LOCALE_CALI_ES;
export const LOCALE_DEVHACK: LocaleDevhackShape =
  ACTIVE_LANGUAGE === 'en' ? LOCALE_DEVHACK_EN : LOCALE_DEVHACK_ES;

export type LocaleCali = LocaleCaliShape;
