import { useState } from "react";
import type { FormEvent } from "react";

import { Button, Card, FieldError, Form, Input, Label, TextField } from "@heroui/react";

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
      className="relative flex min-h-dvh flex-col items-center justify-center gap-6 px-4 py-10"
    >
      <Card className="w-full max-w-sm animate-in fade-in slide-in-from-bottom-2 duration-500 fill-mode-both">
        <Card.Content className="flex flex-col items-center gap-5 py-2 text-center">
          <div className="flex flex-col items-center gap-2">
            <WordMark className="size-10 text-accent" />
            <h1 className="m-0 text-xl font-bold text-foreground">party-dev</h1>
          </div>
          <p className="m-0 text-muted">Async party games you play a move at a time.</p>
          <Form onSubmit={handleSubmit} className="flex w-full flex-col gap-3 text-left">
            <TextField
              value={nickname}
              onChange={setNickname}
              maxLength={MAX_LEN}
              isInvalid={!!error}
            >
              <Label>Nickname</Label>
              <Input autoFocus placeholder="e.g. alice" />
              {error && <FieldError>{error}</FieldError>}
            </TextField>
            <Button type="submit" isDisabled={submitting} className="w-full">
              {submitting ? "Joining…" : "Continue"}
            </Button>
          </Form>
        </Card.Content>
      </Card>
      <ThemeToggle />
    </main>
  );
}
