/**
 * Firestore adapter for the Reto AcaDevHack leaderboard (`gta-cali` database).
 * Firebase is loaded lazily so the game boots and plays fully offline; every call resolves to a
 * Result and never throws, letting the HUD show "sin conexión" instead of blocking gameplay.
 */

import {
  EMULATOR_QUERY_PARAM,
  FIREBASE_WEB_CONFIG,
  FIRESTORE_DATABASE_ID,
} from '../config/firebaseConfig';
import { nicknameKey } from '../missions/devhackChallenge';
import type { MissionId } from '../types/game';
import {
  err,
  ok,
  type LeaderboardEntry,
  type LeaderboardErrorCode,
  type LeaderboardPort,
  type Result,
  type SubmitOutcome,
  type WinnerRegistration,
} from './leaderboardPort';

type FirestoreLite = typeof import('firebase/firestore/lite');
type FirebaseAuth = typeof import('firebase/auth');
type Db = import('firebase/firestore/lite').Firestore;

interface Session {
  readonly fs: FirestoreLite;
  readonly db: Db;
  readonly uid: string;
}

const REQUEST_TIMEOUT_MS = 8000;

function withTimeout<T>(promise: Promise<T>, ms = REQUEST_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

export function classifyFirebaseError(error: unknown): LeaderboardErrorCode {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code: unknown }).code)
      : '';
  const message = error instanceof Error ? error.message : '';
  if (code.includes('permission-denied')) return 'permission_denied';
  if (
    code.includes('admin-restricted-operation') ||
    code.includes('operation-not-allowed') ||
    code.includes('configuration-not-found')
  ) {
    return 'auth_unavailable';
  }
  if (
    code.includes('unavailable') ||
    code.includes('network-request-failed') ||
    code.includes('deadline-exceeded') ||
    message === 'timeout'
  ) {
    return 'offline';
  }
  return 'unknown';
}

function readEmulatorHost(): { host: string; port: number } | null {
  if (typeof window === 'undefined' || !window.location) return null;
  const raw = new URLSearchParams(window.location.search).get(EMULATOR_QUERY_PARAM);
  if (!raw) return null;
  const [host, portRaw] = raw.split(':');
  const port = Number(portRaw);
  return host && Number.isInteger(port) ? { host, port } : null;
}

export class FirestoreLeaderboard implements LeaderboardPort {
  private sessionPromise: Promise<Session> | null = null;
  private uid: string | null = null;

  public currentUid(): string | null {
    return this.uid;
  }

  public async signIn(): Promise<Result<string>> {
    return this.run(async (session) => session.uid);
  }

  public async claimNickname(nickname: string): Promise<Result<string>> {
    return this.run(async ({ fs, db, uid }) => {
      const ref = fs.doc(db, 'nicknames', nicknameKey(nickname));
      const existing = await withTimeout(fs.getDoc(ref));
      if (existing.exists()) {
        if (existing.data()['uid'] !== uid) {
          throw Object.assign(new Error('taken'), { code: 'nickname-taken' });
        }
        return String(existing.data()['nickname'] ?? nickname);
      }
      await withTimeout(
        fs.setDoc(ref, { uid, nickname, createdAt: fs.serverTimestamp() }),
      );
      return nickname;
    });
  }

  public async submitBestTime(
    missionId: MissionId,
    nickname: string,
    seconds: number,
  ): Promise<Result<SubmitOutcome>> {
    return this.run(async ({ fs, db, uid }) => {
      const ref = fs.doc(db, 'leaderboards', missionId, 'entries', uid);
      const existing = await withTimeout(fs.getDoc(ref));
      const previous = existing.exists() ? Number(existing.data()['bestTimeSeconds']) : null;
      if (previous !== null && Number.isFinite(previous) && previous <= seconds) {
        return { improved: false, bestTimeSeconds: previous };
      }
      await withTimeout(
        fs.setDoc(ref, { nickname, bestTimeSeconds: seconds, updatedAt: fs.serverTimestamp() }),
      );
      return { improved: true, bestTimeSeconds: seconds };
    });
  }

  public async fetchTop(
    missionId: MissionId,
    limit: number,
  ): Promise<Result<readonly LeaderboardEntry[]>> {
    return this.run(async ({ fs, db }) => {
      const q = fs.query(
        fs.collection(db, 'leaderboards', missionId, 'entries'),
        fs.orderBy('bestTimeSeconds', 'asc'),
        fs.limit(limit),
      );
      const snap = await withTimeout(fs.getDocs(q));
      return snap.docs.map((entry) => ({
        uid: entry.id,
        nickname: String(entry.data()['nickname'] ?? '???'),
        bestTimeSeconds: Number(entry.data()['bestTimeSeconds']),
      }));
    });
  }

  public async registerWinner(winner: WinnerRegistration): Promise<Result<string>> {
    return this.run(async ({ fs, db, uid }) => {
      const ref = fs.doc(db, 'challengeWinners', uid);
      const existing = await withTimeout(fs.getDoc(ref));
      if (existing.exists()) {
        return String(existing.data()['code']);
      }
      await withTimeout(
        fs.setDoc(ref, {
          nickname: winner.nickname,
          code: winner.code,
          times: { ...winner.times },
          totalSeconds: winner.totalSeconds,
          claimed: false,
          completedAt: fs.serverTimestamp(),
        }),
      );
      return winner.code;
    });
  }

  private async run<T>(work: (session: Session) => Promise<T>): Promise<Result<T>> {
    try {
      const session = await this.session();
      return ok(await work(session));
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        (error as { code?: unknown }).code === 'nickname-taken'
      ) {
        return err('nickname_taken');
      }
      // Allow a later retry after a failed sign-in (e.g. the network came back).
      if (!this.uid) this.sessionPromise = null;
      return err(classifyFirebaseError(error));
    }
  }

  private session(): Promise<Session> {
    if (!this.sessionPromise) {
      this.sessionPromise = this.connect();
    }
    return this.sessionPromise;
  }

  private async connect(): Promise<Session> {
    const [appMod, authMod, fs] = await withTimeout(
      Promise.all([
        import('firebase/app'),
        import('firebase/auth') as Promise<FirebaseAuth>,
        import('firebase/firestore/lite') as Promise<FirestoreLite>,
      ]),
    );
    const app = appMod.getApps()[0] ?? appMod.initializeApp(FIREBASE_WEB_CONFIG);
    const db = fs.getFirestore(app, FIRESTORE_DATABASE_ID);
    const auth = authMod.getAuth(app);
    const emulator = readEmulatorHost();
    if (emulator) {
      fs.connectFirestoreEmulator(db, emulator.host, emulator.port);
      authMod.connectAuthEmulator(auth, `http://${emulator.host}:9099`, { disableWarnings: true });
    }
    // Wait for the persisted anonymous session so a returning player keeps the same uid.
    await withTimeout(auth.authStateReady());
    const credential = auth.currentUser
      ? { user: auth.currentUser }
      : await withTimeout(authMod.signInAnonymously(auth));
    this.uid = credential.user.uid;
    return { fs, db, uid: credential.user.uid };
  }
}
