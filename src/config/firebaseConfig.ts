/**
 * Firebase web config for the Reto AcaDevHack leaderboard (project devhack-3f0c2).
 * Web API keys identify the project and are public by design; access is enforced by
 * firestore.rules on the dedicated `gta-cali` database.
 */

export const FIREBASE_WEB_CONFIG = {
  apiKey: 'AIzaSyDokZ35_PamPogr1hdIcmcOELOFZDIjATA',
  authDomain: 'devhack-3f0c2.firebaseapp.com',
  projectId: 'devhack-3f0c2',
  storageBucket: 'devhack-3f0c2.firebasestorage.app',
  messagingSenderId: '823002731253',
  appId: '1:823002731253:web:5719f0d787f0b503c22bbc',
} as const;

export const FIRESTORE_DATABASE_ID = 'gta-cali';

/** Optional local emulator override, e.g. `?firestoreEmulator=127.0.0.1:8080`. */
export const EMULATOR_QUERY_PARAM = 'firestoreEmulator';
