import type { GameMeta } from "../games/catalog";
import type { EventsResponse, MatchEvent, MatchSnapshot, MatchSummary } from "../shared/protocol";

// Thin typed client over worker/api.ts. Every call goes through request()
// so credentials, headers, and error shape are consistent in one place —
// including the rule that every fetch sends
// `credentials: "same-origin"` (the session cookie is HttpOnly; nothing here
// ever reads it directly).

export interface ApiErrorShape {
  status: number;
  code: string;
  message: string;
}

export class ApiError extends Error implements ApiErrorShape {
  status: number;
  code: string;

  constructor({ status, code, message }: ApiErrorShape) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "same-origin",
    headers: init?.body ? { "content-type": "application/json" } : undefined,
    ...init,
  });

  if (!res.ok) {
    let code = "unknown_error";
    let message = `request to ${path} failed with status ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body && typeof body.error === "string") {
        code = body.error;
        message = body.error;
      }
    } catch {
      // Non-JSON error body — keep the generic message above.
    }
    throw new ApiError({ status: res.status, code, message });
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface Me {
  playerId: string;
  nickname: string;
}

export function getMe(): Promise<Me> {
  return request<Me>("/api/me");
}

export function setIdentity(nickname: string): Promise<Me> {
  return request<Me>("/api/identity", {
    method: "POST",
    body: JSON.stringify({ nickname }),
  });
}

// Ends the session on this device only. The player itself is untouched —
// signing in with the same nickname anywhere brings it all back.
export function signOut(): Promise<void> {
  return request<void>("/api/identity/signout", { method: "POST", body: JSON.stringify({}) });
}

export function getGames(): Promise<GameMeta[]> {
  return request<GameMeta[]>("/api/games");
}

export interface PlayerStats {
  played: number;
  finished: number;
  won: number;
}

export interface MatchBuckets {
  yourTurn: MatchSummary[];
  waiting: MatchSummary[];
  finished: MatchSummary[];
  stats: PlayerStats;
}

export function listMatches(): Promise<MatchBuckets> {
  return request<MatchBuckets>("/api/matches");
}

export interface CreateMatchResult {
  matchId: string;
  code: string;
}

export function createMatch(gameId: string): Promise<CreateMatchResult> {
  return request<CreateMatchResult>("/api/matches", {
    method: "POST",
    body: JSON.stringify({ gameId }),
  });
}

export function joinMatch(code: string): Promise<MatchSummary> {
  return request<MatchSummary>(`/api/matches/${encodeURIComponent(code)}/join`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export function getMatch(id: string): Promise<MatchSummary> {
  return request<MatchSummary>(`/api/matches/${encodeURIComponent(id)}`);
}

// The live match transport's HTTP fallbacks — the
// same shapes the WS `snapshot`/`action`/`start` messages use, so useMatch
// can treat either transport interchangeably.
export function getMatchSnapshot(id: string): Promise<MatchSnapshot> {
  return request<MatchSnapshot>(`/api/matches/${encodeURIComponent(id)}/snapshot`);
}

// The history a freshly-loaded page starts from. `since` defaults to 0 —
// the whole (bounded) log — which is what a reload needs; the WebSocket
// takes over for everything after it.
export async function getMatchEvents(id: string, since = 0): Promise<MatchEvent[]> {
  const body = await request<EventsResponse>(
    `/api/matches/${encodeURIComponent(id)}/events?since=${since}`,
  );
  return body.events;
}

export function postMatchAction(id: string, action: unknown): Promise<MatchSnapshot> {
  return request<MatchSnapshot>(`/api/matches/${encodeURIComponent(id)}/actions`, {
    method: "POST",
    body: JSON.stringify({ action }),
  });
}

export function postMatchStart(id: string): Promise<MatchSnapshot> {
  return request<MatchSnapshot>(`/api/matches/${encodeURIComponent(id)}/start`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}
