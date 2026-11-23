import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ChallengeSession, NICKNAME_STORAGE_KEY } from '../../../src/game/challengeSession';
import { CLAIM_CODE_PATTERN } from '../../../src/missions/devhackChallenge';
import type { StorageLike } from '../../../src/missions/missionDirector';
import {
  err,
  ok,
  type LeaderboardEntry,
  type LeaderboardPort,
  type Result,
  type SubmitOutcome,
  type WinnerRegistration,
} from '../../../src/services/leaderboardPort';
import type { MissionId, MissionSnapshot } from '../../../src/types/game';

/** Minimal DOM node: enough surface for ChallengeController in a node test environment. */
class Node {
  public className = '';
  public textContent = '';
  public hidden = false;
  public type = '';
  public value = '';
  public href = '';
  public disabled = false;
  public readonly dataset: Record<string, string> = {};
  public readonly children: Node[] = [];
  private readonly listeners = new Map<string, Array<(event: unknown) => void>>();
  public constructor(public readonly tagName: string) {}
  public setAttribute(): void {}
  public append(...nodes: Node[]): void {
    this.children.push(...nodes);
  }
  public appendChild(node: Node): Node {
    this.children.push(node);
    return node;
  }
  public replaceChildren(...nodes: Node[]): void {
    this.children.splice(0, this.children.length, ...nodes);
  }
  public remove(): void {}
  public focus(): void {}
  public addEventListener(type: string, fn: (event: unknown) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  public removeEventListener(): void {}
  public fire(type: string): void {
    for (const fn of this.listeners.get(type) ?? []) fn({ preventDefault() {}, stopPropagation() {} });
  }
  public find(testId: string): Node | null {
    if (this.dataset['testid'] === testId) return this;
    for (const child of this.children) {
      const hit = child.find(testId);
      if (hit) return hit;
    }
    return null;
  }
}

class MemoryPort implements LeaderboardPort {
  public readonly submitted: Array<{ missionId: MissionId; seconds: number }> = [];
  public readonly winners: WinnerRegistration[] = [];
  public offline = false;
  public async signIn(): Promise<Result<string>> {
    return ok('uid-1');
  }
  public async claimNickname(nickname: string): Promise<Result<string>> {
    return this.offline ? err('offline') : ok(nickname);
  }
  public async submitBestTime(missionId: MissionId, _n: string, seconds: number): Promise<Result<SubmitOutcome>> {
    if (this.offline) return err('offline');
    this.submitted.push({ missionId, seconds });
    return ok({ improved: true, bestTimeSeconds: seconds });
  }
  public async fetchTop(): Promise<Result<readonly LeaderboardEntry[]>> {
    return ok([{ uid: 'uid-1', nickname: 'Valeria', bestTimeSeconds: 60 }]);
  }
  public async registerWinner(winner: WinnerRegistration): Promise<Result<string>> {
    this.winners.push(winner);
    return ok(winner.code);
  }
  public currentUid(): string | null {
    return 'uid-1';
  }
}

function memoryStorage(): StorageLike {
  const store = new Map<string, string>();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
  };
}

function snap(overrides: Partial<MissionSnapshot>): MissionSnapshot {
  return {
    mode: 'playing',
    activeMission: 'mission_1_bulevar',
    isChallengeRun: true,
    elapsedSeconds: 0,
    lastCompletedTimeSeconds: null,
    ...overrides,
  } as MissionSnapshot;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('ChallengeSession', () => {
  const originalDocument = globalThis.document;
  let root: Node;
  let port: MemoryPort;
  let stages: MissionId[];
  let titles: number;
  let session: ChallengeSession;
  let storage: StorageLike;

  beforeEach(() => {
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: { createElement: (tag: string) => new Node(tag) },
    });
    root = new Node('div');
    port = new MemoryPort();
    stages = [];
    titles = 0;
    storage = memoryStorage();
    session = new ChallengeSession({
      root: root as unknown as HTMLElement,
      port,
      storage,
      rng: () => 0.5,
      host: {
        startChallengeStage: (id) => stages.push(id),
        returnToTitle: () => {
          titles += 1;
        },
      },
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'document', { configurable: true, value: originalDocument });
  });

  async function startWithNickname(nickname: string): Promise<void> {
    (root.find('reto-nickname-input') as Node).value = nickname;
    root.find('reto-nickname-modal')!.children[0]!.children
      .find((child) => child.tagName === 'form')!
      .fire('submit');
    await flush();
  }

  it('claims the nickname, remembers it, and starts Mission 1', async () => {
    await startWithNickname('Valeria');
    expect(stages).toEqual(['mission_1_bulevar']);
    expect(session.isRunning()).toBe(true);
    expect(storage.getItem(NICKNAME_STORAGE_KEY)).toBe('Valeria');
  });

  it('rejects an invalid nickname without starting', async () => {
    await startWithNickname('a b');
    expect(stages).toEqual([]);
    expect(root.find('reto-nickname-error')!.textContent).not.toBe('');
  });

  it('submits each stage time, chains the stages, and registers the winner with a claim code', async () => {
    await startWithNickname('Valeria');
    const order: MissionId[] = ['mission_1_bulevar', 'mission_2_cristo_rey', 'mission_3_pique_bulevar', 'free_roam'];
    for (const [index, missionId] of order.entries()) {
      session.onMissionTransition(
        snap({ activeMission: missionId }),
        snap({ activeMission: missionId, mode: index === 1 ? 'victory' : 'mission_passed', lastCompletedTimeSeconds: 60 + index }),
      );
      await flush();
      if (index < order.length - 1) {
        expect(root.find('reto-stage-modal')!.hidden).toBe(false);
        root.find('btn-reto-next')!.fire('click');
      }
    }
    expect(stages).toEqual(order);
    expect(port.submitted.map((entry) => entry.missionId)).toEqual(order);
    expect(port.winners).toHaveLength(1);
    expect(port.winners[0]!.code).toMatch(CLAIM_CODE_PATTERN);
    expect(root.find('reto-winner-modal')!.hidden).toBe(false);
    expect(root.find('reto-winner-code')!.textContent).toBe(port.winners[0]!.code);
    expect(root.find('btn-reto-claim')!.href).toContain('https://wa.me/573174498336?text=');
    expect(root.find('btn-reto-claim')!.href).toContain(encodeURIComponent(port.winners[0]!.code));
  });

  it('ends the run on a bust and retries from Mission 1', async () => {
    await startWithNickname('Valeria');
    session.onMissionTransition(snap({}), snap({ mode: 'busted' }));
    expect(session.isRunning()).toBe(false);
    expect(root.find('reto-failed-modal')!.hidden).toBe(false);
    root.find('btn-reto-retry')!.fire('click');
    expect(stages).toEqual(['mission_1_bulevar', 'mission_1_bulevar']);
    expect(session.isRunning()).toBe(true);
  });

  it('ignores completions outside a challenge run and lets the player quit to title', async () => {
    session.onMissionTransition(snap({ isChallengeRun: false }), snap({ mode: 'mission_passed', isChallengeRun: false, lastCompletedTimeSeconds: 60 }));
    expect(port.submitted).toHaveLength(0);
    await startWithNickname('Valeria');
    session.onMissionTransition(snap({}), snap({ mode: 'mission_passed', lastCompletedTimeSeconds: 60 }));
    root.find('btn-reto-quit')!.fire('click');
    expect(titles).toBe(1);
    expect(session.isRunning()).toBe(false);
  });

  it('offers to play without the ranking when offline and skips leaderboard writes', async () => {
    port.offline = true;
    await startWithNickname('Valeria');
    expect(stages).toEqual([]);
    const offlineBtn = root.find('btn-reto-offline')!;
    expect(offlineBtn.hidden).toBe(false);
    offlineBtn.fire('click');
    expect(stages).toEqual(['mission_1_bulevar']);
    port.offline = false;
    session.onMissionTransition(snap({}), snap({ mode: 'mission_passed', lastCompletedTimeSeconds: 60 }));
    await flush();
    expect(port.submitted).toHaveLength(0);
    expect(root.find('reto-stage-sync')!.dataset['state']).toBe('offline');
  });
});
