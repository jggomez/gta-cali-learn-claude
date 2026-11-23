/**
 * Leaderboard port for the Reto AcaDevHack: the game depends on this interface only, so the
 * Firestore adapter stays swappable and the game keeps working when the network is down.
 */

import type { MissionId } from '../types/game';

export type LeaderboardErrorCode =
  | 'offline'
  | 'auth_unavailable'
  | 'nickname_taken'
  | 'permission_denied'
  | 'unknown';

export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: LeaderboardErrorCode };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function err<T>(error: LeaderboardErrorCode): Result<T> {
  return { ok: false, error };
}

export interface LeaderboardEntry {
  readonly uid: string;
  readonly nickname: string;
  readonly bestTimeSeconds: number;
}

export interface SubmitOutcome {
  /** True when this time beat the player's stored best and was written. */
  readonly improved: boolean;
  readonly bestTimeSeconds: number;
}

export interface WinnerRegistration {
  readonly nickname: string;
  readonly code: string;
  readonly times: Readonly<Record<MissionId, number>>;
  readonly totalSeconds: number;
}

export interface LeaderboardPort {
  /** Signs the player in (anonymously) and returns a stable player id. */
  signIn(): Promise<Result<string>>;
  /** Reserves a nickname for the signed-in player; re-claiming one's own nickname succeeds. */
  claimNickname(nickname: string): Promise<Result<string>>;
  submitBestTime(
    missionId: MissionId,
    nickname: string,
    seconds: number,
  ): Promise<Result<SubmitOutcome>>;
  fetchTop(missionId: MissionId, limit: number): Promise<Result<readonly LeaderboardEntry[]>>;
  /** Registers a full-run winner once; returns the stored claim code (an earlier one wins). */
  registerWinner(winner: WinnerRegistration): Promise<Result<string>>;
  currentUid(): string | null;
}
