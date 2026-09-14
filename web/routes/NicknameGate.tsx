import { useState } from "react";
import type { FormEvent } from "react";

import { ApiError } from "../api";
import { ThemeToggle } from "../components/ThemeToggle";
import { WordMark } from "../components/WordMark";
import { useSession } from "../session";

// Mirrors the server's IdentityRequestSchema (shared/protocol.ts) so the
// user sees the same 1-24 char / no-control-character rule before ever
// hitting the network. The server re-validates regardless.
const MAX_LEN = 24;
// eslint-disable-next-line no-control-regex -- control chars are the point of this validation
const NO_CONTROL_CHARS = /^[^\x00-\x1F\x7F]*$/;

function validate(nickname: string): string | null {
  const trimmed = nickname.trim();
  if (trimmed.length < 1) return "Enter a nickname to continue.";
  if (trimmed.length > MAX_LEN) return `Nickname must be ${MAX_LEN} characters or fewer.`;
  if (!NO_CONTROL_CHARS.test(trimmed)) return "Nickname must not contain control characters.";
  return null;
}

// Shown whenever session state is "anon". This component never navigates —
// the URL (e.g. a deep link to /m/ABCDEF) stays put, and once signIn()
// succeeds App.tsx swaps this out for the real route's content, so the
// intended destination is preserved for free.
export function NicknameGate() {
  const { signIn } = useSession();
  const [nickname, setNickname] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const validationError = validate(nickname);
    if (validationError) {
      setError(validationError);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await signIn(nickname.trim());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not sign in — try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main id="main-content" className="page page-narrow gate">
      <div className="panel gate-panel">
        <div className="gate-header">
          <WordMark className="gate-mark" />
          <h1>party-dev</h1>
        </div>
        <p className="gate-tagline">Async party games you play a move at a time.</p>
        <form onSubmit={handleSubmit} className="stack">
          <label htmlFor="nickname">Nickname</label>
          <input
            id="nickname"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            maxLength={MAX_LEN}
            autoFocus
            placeholder="e.g. alice"
          />
          {error && <p className="error">{error}</p>}
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? "Joining…" : "Continue"}
          </button>
        </form>
      </div>
      <ThemeToggle />
    </main>
  );
}
