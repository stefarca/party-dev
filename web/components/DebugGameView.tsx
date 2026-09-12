import { useState } from "react";

import type { GameUiProps } from "../../shared/protocol";

// The generic proof that the engine works before any real game exists
// (plan 05 step 6) — a `<pre>` of the raw `view()` projection plus a
// textarea for a hand-typed JSON action. Reachable whenever no UI is
// registered for a game (games/registry.ts's `gameUi` map), and stays in
// the tree afterwards as a debugging aid for whatever isn't registered yet.
export function DebugGameView({ view, waitingOn, deadline, result, send }: GameUiProps) {
  const [text, setText] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);

  function submit() {
    let action: unknown;
    try {
      action = text.trim() === "" ? undefined : JSON.parse(text);
    } catch {
      setParseError("Enter a valid JSON action (or leave blank).");
      return;
    }
    setParseError(null);
    send(action);
  }

  return (
    <div className="card debug-game-view">
      <p className="debug-game-view-note">No UI is registered for this game — showing the raw engine view.</p>
      <pre>{JSON.stringify({ view, waitingOn, deadline, result }, null, 2)}</pre>
      <label htmlFor="debug-action">Action (JSON)</label>
      <textarea
        id="debug-action"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder={'{"t":"increment"}'}
      />
      {parseError && <p className="error">{parseError}</p>}
      <button onClick={submit}>Send</button>
    </div>
  );
}
