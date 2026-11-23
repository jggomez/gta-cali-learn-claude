import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, serverTimestamp, setDoc, updateDoc, type Firestore } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-gta-cali',
    firestore: { rules: readFileSync(resolve(__dirname, '../../firestore.rules'), 'utf8') },
  });
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
});

const entry = (seconds: number, nickname = 'Valeria') => ({
  nickname,
  bestTimeSeconds: seconds,
  updatedAt: serverTimestamp(),
});

const winner = (overrides: Record<string, unknown> = {}) => ({
  nickname: 'Valeria',
  code: 'CALI-ABCD-EFGH',
  times: {
    mission_1_bulevar: 60,
    mission_2_cristo_rey: 80,
    mission_3_pique_bulevar: 90,
    mission_5_golpe_prompt: 70,
    free_roam: 300,
  },
  totalSeconds: 600,
  claimed: false,
  completedAt: serverTimestamp(),
  ...overrides,
});

describe('nicknames', () => {
  it('lets a player reserve a free nickname once and blocks others from taking it', async () => {
    const alice = env.authenticatedContext('alice').firestore();
    const bob = env.authenticatedContext('bob').firestore();
    await assertSucceeds(
      setDoc(doc(alice, 'nicknames', 'valeria'), {
        uid: 'alice',
        nickname: 'Valeria',
        createdAt: serverTimestamp(),
      }),
    );
    await assertFails(
      setDoc(doc(bob, 'nicknames', 'valeria'), {
        uid: 'bob',
        nickname: 'VALERIA',
        createdAt: serverTimestamp(),
      }),
    );
  });

  it('rejects invalid nicknames, mismatched keys, foreign uids and anonymous callers', async () => {
    const alice = env.authenticatedContext('alice').firestore();
    const anon = env.unauthenticatedContext().firestore();
    const base = { uid: 'alice', createdAt: serverTimestamp() };
    await assertFails(setDoc(doc(alice, 'nicknames', 'a b'), { ...base, nickname: 'a b' }));
    await assertFails(setDoc(doc(alice, 'nicknames', 'other'), { ...base, nickname: 'Valeria' }));
    await assertFails(
      setDoc(doc(alice, 'nicknames', 'mateo'), { ...base, uid: 'bob', nickname: 'Mateo' }),
    );
    await assertFails(setDoc(doc(anon, 'nicknames', 'mateo'), { ...base, nickname: 'Mateo' }));
  });
});

describe('leaderboards', () => {
  const ref = (db: () => unknown, uid: string, mission = 'mission_1_bulevar') =>
    doc(db() as Firestore, 'leaderboards', mission, 'entries', uid);

  it('is publicly readable and only improves the stored time', async () => {
    const alice = env.authenticatedContext('alice');
    const aliceDb = () => alice.firestore();
    await assertSucceeds(setDoc(ref(aliceDb, 'alice'), entry(90)));
    await assertSucceeds(setDoc(ref(aliceDb, 'alice'), entry(70)));
    await assertFails(setDoc(ref(aliceDb, 'alice'), entry(80)));
    await assertFails(updateDoc(ref(aliceDb, 'alice'), { bestTimeSeconds: 70 }));

    const anonDb = () => env.unauthenticatedContext().firestore();
    await assertSucceeds(getDoc(ref(anonDb, 'alice')));
  });

  it('accepts the fastest real (autopilot-verified) M1 and M2 completions', async () => {
    const aliceDb = () => env.authenticatedContext('alice').firestore();
    await assertSucceeds(setDoc(ref(aliceDb, 'alice'), entry(12.77)));
    await assertSucceeds(setDoc(ref(aliceDb, 'alice', 'mission_2_cristo_rey'), entry(9.6)));
    await assertSucceeds(setDoc(ref(aliceDb, 'alice', 'mission_5_golpe_prompt'), entry(27.08)));
  });

  it('rejects writes to someone else, implausible times, unknown missions and extra fields', async () => {
    const aliceDb = () => env.authenticatedContext('alice').firestore();
    await assertFails(setDoc(ref(aliceDb, 'bob'), entry(90)));
    await assertFails(setDoc(ref(aliceDb, 'alice'), entry(3)));
    await assertFails(setDoc(ref(aliceDb, 'alice', 'free_roam'), entry(20)));
    await assertFails(setDoc(ref(aliceDb, 'alice'), entry(9.9)));
    await assertFails(setDoc(ref(aliceDb, 'alice', 'mission_2_cristo_rey'), entry(7.9)));
    await assertFails(setDoc(ref(aliceDb, 'alice', 'mission_5_golpe_prompt'), entry(21.9)));
    await assertFails(setDoc(ref(aliceDb, 'alice'), entry(4000)));
    await assertFails(setDoc(ref(aliceDb, 'alice', 'mission_9'), entry(90)));
    await assertFails(setDoc(ref(aliceDb, 'alice'), { ...entry(90), admin: true }));
  });
});

describe('challengeWinners', () => {
  it('lets the owner register once and read it back, never mark it claimed, and hides it from others', async () => {
    const alice = env.authenticatedContext('alice').firestore();
    const bob = env.authenticatedContext('bob').firestore();
    await assertFails(setDoc(doc(alice, 'challengeWinners', 'alice'), winner({ claimed: true })));
    await assertSucceeds(setDoc(doc(alice, 'challengeWinners', 'alice'), winner()));
    await assertSucceeds(getDoc(doc(alice, 'challengeWinners', 'alice')));
    await assertFails(getDoc(doc(bob, 'challengeWinners', 'alice')));
    await assertFails(updateDoc(doc(alice, 'challengeWinners', 'alice'), { claimed: true }));
    await assertFails(setDoc(doc(bob, 'challengeWinners', 'alice'), winner()));
  });

  it('rejects malformed codes and implausible run times', async () => {
    const alice = env.authenticatedContext('alice').firestore();
    await assertFails(setDoc(doc(alice, 'challengeWinners', 'alice'), winner({ code: 'CALI-0000-OOOO' })));
    await assertFails(
      setDoc(
        doc(alice, 'challengeWinners', 'alice'),
        winner({
          times: {
            mission_1_bulevar: 1,
            mission_2_cristo_rey: 80,
            mission_3_pique_bulevar: 90,
            mission_5_golpe_prompt: 70,
            free_roam: 300,
          },
        }),
      ),
    );
  });
});
