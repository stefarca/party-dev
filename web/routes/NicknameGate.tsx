import { useState } from "react";
import type { FormEvent } from "react";

import { Button, FieldError, Form, Input, Label, TextField } from "@heroui/react";

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
    <main
      id="main-content"
      className="relative flex min-h-dvh flex-col items-center justify-center gap-8 px-4 py-12"
    >
      <div className="party-pop flex w-full max-w-md flex-col items-center gap-7 rounded-[var(--radius-2xl)] border border-[var(--border-subtle)] bg-[var(--surface-1)]/85 p-8 text-center shadow-[var(--shadow-3),var(--edge-highlight)] backdrop-blur-xl">
        <div className="flex flex-col items-center gap-3">
          <WordMark animated className="size-16 text-accent" />
          <h1 className="m-0 font-display text-4xl font-bold tracking-tight text-[var(--text-primary)]">
            party
          </h1>
          <p className="m-0 text-balance text-[var(--text-secondary)]">
            Async games with your coworkers. One move at a time, no scheduling.
          </p>
        </div>

        <Form onSubmit={handleSubmit} className="flex w-full flex-col gap-4 text-left">
          {/* The error clears on every edit: while `isInvalid` is set, the input carries a
              custom validity and the browser refuses to submit the form at all. */}
          <TextField
            value={nickname}
            onChange={(value) => {
              setNickname(value);
              setError(null);
            }}
            maxLength={MAX_LEN}
            isInvalid={!!error}
          >
            <Label className="text-xs font-bold text-[var(--text-muted)]">Pick a nickname</Label>
            <Input autoFocus placeholder="e.g. alice" className="text-base" />
            {error && <FieldError>{error}</FieldError>}
          </TextField>
          <Button
            type="submit"
            isDisabled={submitting}
            className="w-full rounded-[var(--radius-pill)] py-3 font-display text-base font-bold transition-transform duration-[var(--dur-fast)] ease-[var(--ease-spring)] not-disabled:hover:scale-[1.03] not-disabled:active:scale-95"
          >
            {submitting ? "Joining…" : "Let's play"}
          </Button>
        </Form>

        <p className="m-0 text-xs text-[var(--text-muted)]">
          No password — your nickname is all anyone sees.
        </p>
      </div>
      <ThemeToggle />
    </main>
  );
}
