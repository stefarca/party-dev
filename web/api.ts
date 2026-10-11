import type { GameMeta } from "../games/catalog";
import type {
  AchievementsResponse,
  DailyChart,
  DailyHub,
  DailyRunSnapshot,
  DailyStanding,
  DailyToday,
  EventsResponse,
  HubMatch,
  Leaderboard,
  MatchEvent,
  MatchReaction,
  MatchSnapshot,
  MatchSummary,
  MatchVisibility,
  PlayerStats,
  PlayerStatsDetail,
  PlayerStreaks,
  PushKeyResponse,
  PushSubscriptionPayload,
  RematchResponse,
  SecurityState,
  SignInNotices,
  SignInPollResponse,
} from "../shared/protocol";
import type { Reaction } from "../shared/reactions";

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
  // The whole error body, for the few errors that carry more than a code (a
  // sign-in that needs the owner's approval says how to get it).
  body: unknown;

  constructor({ status, code, message }: ApiErrorShape, body?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.body = body;
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
    let body: unknown;
    try {
      body = await res.json();
      const error = (body as { error?: unknown } | null)?.error;
      if (typeof error === "string") {
        code = error;
        message = error;
      }
    } catch {
      // Non-JSON error body — keep the generic message above.
    }
    throw new ApiError({ status: res.status, code, message }, body);
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

// Where a sign-in waiting on the owner's approval stands. Once it goes through,
// the reply has set this device's session cookie.
export function pollSignIn(id: string, secret: string): Promise<SignInPollResponse> {
  return request<SignInPollResponse>(`/api/identity/requests/${encodeURIComponent(id)}`, {
    method: "POST",
    body: JSON.stringify({ secret }),
  });
}

export function signInWithPin(nickname: string, pin: string): Promise<Me> {
  return request<Me>("/api/identity/pin", {
    method: "POST",
    body: JSON.stringify({ nickname, pin }),
  });
}

// The two halves of a passkey sign-in: the options to hand the browser, and
// the browser's answer. The JSON types are @simplewebauthn/browser's.
export function passkeySignInOptions(nickname: string): Promise<unknown> {
  return request<unknown>("/api/identity/passkey/options", {
    method: "POST",
    body: JSON.stringify({ nickname }),
  });
}

export function signInWithPasskey(response: unknown): Promise<Me> {
  return request<Me>("/api/identity/passkey", {
    method: "POST",
    body: JSON.stringify({ response }),
  });
}

// Sign-ins to the player's name that their devices should know about.
export function getSignInNotices(): Promise<SignInNotices> {
  return request<SignInNotices>("/api/me/sign-ins");
}

export function answerSignIn(id: string, answer: "approve" | "deny" | "ack"): Promise<void> {
  return request<void>(`/api/me/sign-ins/${encodeURIComponent(id)}/${answer}`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

// Signs every other device out of this player, keeping this one, and its
// notifications when `keepEndpoint` is its push endpoint.
export function signOutEverywhere(keepEndpoint?: string): Promise<void> {
  return request<void>("/api/me/sign-out-everywhere", {
    method: "POST",
    body: JSON.stringify(keepEndpoint ? { keepEndpoint } : {}),
  });
}

export function getSecurity(): Promise<SecurityState> {
  return request<SecurityState>("/api/me/security");
}

export function setPin(pin: string): Promise<SecurityState> {
  return request<SecurityState>("/api/me/pin", { method: "POST", body: JSON.stringify({ pin }) });
}

export function removePin(): Promise<SecurityState> {
  return request<SecurityState>("/api/me/pin/remove", { method: "POST", body: JSON.stringify({}) });
}

export function passkeyRegistrationOptions(): Promise<unknown> {
  return request<unknown>("/api/me/passkeys/options", { method: "POST", body: JSON.stringify({}) });
}

export function addPasskey(response: unknown): Promise<SecurityState> {
  return request<SecurityState>("/api/me/passkeys", {
    method: "POST",
    body: JSON.stringify({ response }),
  });
}

export function removePasskeys(): Promise<SecurityState> {
  return request<SecurityState>("/api/me/passkeys/remove", {
    method: "POST",
    body: JSON.stringify({}),
  });
}

// The application server key a push subscription has to be created with, or
// null where this deployment has no VAPID keys and can send no notifications
// at all.
export async function getPushKey(): Promise<string | null> {
  return (await request<PushKeyResponse>("/api/push/key")).key;
}

// Registers this browser as one to notify, in `language`. Idempotent — it is
// also how the language on an existing subscription is updated.
export function subscribePush(
  subscription: PushSubscriptionPayload,
  language: string,
): Promise<void> {
  return request<void>("/api/push/subscribe", {
    method: "POST",
    body: JSON.stringify({ subscription, language }),
  });
}

export function unsubscribePush(endpoint: string): Promise<void> {
  return request<void>("/api/push/unsubscribe", {
    method: "POST",
    body: JSON.stringify({ endpoint }),
  });
}

export function getGames(): Promise<GameMeta[]> {
  return request<GameMeta[]>("/api/games");
}

export type { PlayerStats };

// Starts the record over. Only the numbers: every match stays in the hub's lists.
export function resetStats(): Promise<PlayerStats> {
  return request<PlayerStats>("/api/me/stats/reset", { method: "POST", body: JSON.stringify({}) });
}

// Everything the stats page shows about the player: record, streaks, rivalries, reply time.
export function getMyStats(): Promise<PlayerStatsDetail> {
  return request<PlayerStatsDetail>("/api/me/stats");
}

// The last seven days for everyone: who won most, and who kept matches waiting longest.
export function getLeaderboard(): Promise<Leaderboard> {
  return request<Leaderboard>("/api/leaderboard");
}

// Every achievement with how far the player has got, and the levels they have
// already been told about.
export function getAchievements(): Promise<AchievementsResponse> {
  return request<AchievementsResponse>("/api/me/achievements");
}

// Records the levels the player has just been told about, so no device of
// theirs tells them again.
export function markAchievementsSeen(seen: Record<string, number>): Promise<void> {
  return request<void>("/api/me/achievements/seen", {
    method: "POST",
    body: JSON.stringify({ seen }),
  });
}

export interface MatchBuckets {
  yourTurn: HubMatch[];
  waiting: HubMatch[];
  finished: HubMatch[];
  // Public lobbies the player is not in, each with a seat left, newest first.
  open: HubMatch[];
  stats: PlayerStats;
  streaks: PlayerStreaks;
}

export function listMatches(): Promise<MatchBuckets> {
  return request<MatchBuckets>("/api/matches");
}

export interface CreateMatchResult {
  matchId: string;
  code: string;
}

export function createMatch(
  gameId: string,
  visibility: MatchVisibility,
): Promise<CreateMatchResult> {
  return request<CreateMatchResult>("/api/matches", {
    method: "POST",
    body: JSON.stringify({ gameId, visibility }),
  });
}

// Host-only, and only while the match is a lobby. Replies with the lobby as it
// now stands.
export function setMatchVisibility(id: string, visibility: MatchVisibility): Promise<MatchSummary> {
  return request<MatchSummary>(`/api/matches/${encodeURIComponent(id)}/visibility`, {
    method: "POST",
    body: JSON.stringify({ visibility }),
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

export async function postMatchReaction(id: string, reaction: Reaction): Promise<MatchReaction> {
  const body = await request<{ reaction: MatchReaction }>(
    `/api/matches/${encodeURIComponent(id)}/reactions`,
    { method: "POST", body: JSON.stringify({ reaction }) },
  );
  return body.reaction;
}

// The lobby of the next match between the same players: a new one, or the
// one another of them already opened.
export async function requestRematch(id: string): Promise<string> {
  const body = await request<RematchResponse>(`/api/matches/${encodeURIComponent(id)}/rematch`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  return body.matchId;
}

// ---------------------------------------------------------------------------
// Daily games. The server's clock says what today is, so the client never
// works it out: it reads `day` from the replies below and hands it back when
// it acts on that day's run.
// ---------------------------------------------------------------------------

export function getDailyHub(): Promise<DailyHub> {
  return request<DailyHub>("/api/daily");
}

// Today, and the player's run at `gameId` on it (null until they start one).
export function getDailyToday(gameId: string): Promise<DailyToday> {
  return request<DailyToday>(`/api/daily/${encodeURIComponent(gameId)}`);
}

// Starts today's run, or hands back the one already started.
export function startDailyRun(gameId: string): Promise<DailyToday> {
  return request<DailyToday>(`/api/daily/${encodeURIComponent(gameId)}/start`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export function postDailyAction(
  gameId: string,
  day: string,
  action: unknown,
): Promise<DailyRunSnapshot> {
  return request<DailyRunSnapshot>(
    `/api/daily/${encodeURIComponent(gameId)}/${encodeURIComponent(day)}/actions`,
    { method: "POST", body: JSON.stringify({ action }) },
  );
}

// Ends the run now, as it stands.
export function finishDailyRun(gameId: string, day: string): Promise<DailyRunSnapshot> {
  return request<DailyRunSnapshot>(
    `/api/daily/${encodeURIComponent(gameId)}/${encodeURIComponent(day)}/finish`,
    { method: "POST", body: JSON.stringify({}) },
  );
}

export function getDailyChart(gameId: string, day: string): Promise<DailyChart> {
  return request<DailyChart>(
    `/api/daily/${encodeURIComponent(gameId)}/${encodeURIComponent(day)}/chart`,
  );
}

// Another player's run on `day`, for the page a challenge link opens.
export function getDailyStanding(
  gameId: string,
  day: string,
  playerId: string,
): Promise<DailyStanding> {
  return request<DailyStanding>(
    `/api/daily/${encodeURIComponent(gameId)}/${encodeURIComponent(day)}/players/${encodeURIComponent(playerId)}`,
  );
}
