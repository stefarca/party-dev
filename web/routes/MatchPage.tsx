import { useCallback, useEffect, useState } from "react";

import { getGameMeta } from "../../games/catalog";
import type { MatchSummary } from "../../shared/protocol";
import { ApiError, getMatch } from "../api";
import { useSession } from "../session";

function CopyCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    const url = `${window.location.origin}/m/${code}`;
    if (navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
        return;
      } catch {
        // Fall through to the selection fallback below.
      }
    }
    // Clipboard API needs a secure context; on plain http (non-localhost) or
    // if it's unavailable, select the text so the user can copy manually.
    const input = document.getElementById("match-share-url") as HTMLInputElement | null;
    input?.select();
  }

  return (
    <div className="card">
      <div className="match-code">{code}</div>
      <input id="match-share-url" readOnly value={`${window.location.origin}/m/${code}`} />
      <button onClick={copy}>{copied ? "Copied!" : "Copy link"}</button>
    </div>
  );
}

// Seam for plan 05: once there's a live transport, it mounts here in place
// of the static lobby/placeholder body, keyed off `match.status`. Keep this
// component thin — no game-specific logic belongs in MatchPage.
function MatchBody({ match, myPlayerId }: { match: MatchSummary; myPlayerId: string }) {
  const meta = getGameMeta(match.gameId);

  if (match.status !== "lobby") {
    return (
      <div className="card">
        <p>This match is in progress — gameplay lands in a later step.</p>
      </div>
    );
  }

  return (
    <div className="card">
      <h2>Players</h2>
      <ul className="player-list">
        {match.players.map((p) => (
          <li key={p.id}>
            {p.nickname}
            {p.id === match.hostId && <span className="badge">host</span>}
            {p.id === myPlayerId && <span className="badge">you</span>}
          </li>
        ))}
      </ul>
      {meta && (
        <p>
          {meta.name} needs {meta.minPlayers}
          {meta.maxPlayers !== meta.minPlayers ? `-${meta.maxPlayers}` : ""} players. Waiting for the
          host to start.
        </p>
      )}
    </div>
  );
}

export function MatchPage({ code }: { code: string }) {
  const { player, notifyUnauthorized } = useSession();
  const [match, setMatch] = useState<MatchSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getMatch(code);
      setMatch(result);
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        notifyUnauthorized();
        return;
      }
      if (err instanceof ApiError && err.status === 404) {
        setError("No match with that code.");
      } else {
        setError(err instanceof Error ? err.message : "Failed to load this match.");
      }
    } finally {
      setLoading(false);
    }
  }, [code, notifyUnauthorized]);

  useEffect(() => {
    load();
  }, [load]);

  const meta = match ? getGameMeta(match.gameId) : undefined;

  return (
    <main className="container">
      <CopyCode code={code} />

      {loading && <p>Loading…</p>}

      {!loading && error && (
        <div className="card">
          <p className="error">{error}</p>
          <button onClick={() => load()}>Retry</button>
        </div>
      )}

      {!loading && !error && match && (
        <>
          <div className="card">
            <p>
              Game: <strong>{meta?.name ?? match.gameId}</strong>
            </p>
            <p>
              Status: <strong>{match.status}</strong>
            </p>
          </div>
          <MatchBody match={match} myPlayerId={player?.playerId ?? ""} />
          <button onClick={() => load()}>Refresh</button>
        </>
      )}
    </main>
  );
}
