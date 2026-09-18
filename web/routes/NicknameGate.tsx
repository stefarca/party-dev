import { useState } from "react";
import type { FormEvent } from "react";

import { Button, FieldError, Form, Input, Label, TextField } from "@heroui/react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

import { LanguagePicker } from "../components/LanguagePicker";
import { ThemeToggle } from "../components/ThemeToggle";
import { WordMark } from "../components/WordMark";
import { errorText } from "../errors";
import { useSession } from "../session";

// Mirrors the server's IdentityRequestSchema (shared/protocol.ts) so the
// user sees the same 1-24 char / no-control-character rule before ever
// hitting the network. The server re-validates regardless.
const MAX_LEN = 24;
// eslint-disable-next-line no-control-regex -- control chars are the point of this validation
const NO_CONTROL_CHARS = /^[^\x00-\x1F\x7F]*$/;

function validate(nickname: string, t: TFunction): string | null {
  const trimmed = nickname.trim();
  if (trimmed.length < 1) return t("nickname.required");
  if (trimmed.length > MAX_LEN) return t("nickname.tooLong", { max: MAX_LEN });
  if (!NO_CONTROL_CHARS.test(trimmed)) return t("nickname.controlCharacters");
  return null;
}

// Shown whenever session state is "anon". This component never navigates —
// the URL (e.g. a deep link to /m/ABCDEF) stays put, and once signIn()
// succeeds App.tsx swaps this out for the real route's content, so the
// intended destination is preserved for free.
export function NicknameGate() {
  const { t } = useTranslation();
  const { signIn } = useSession();
  const [nickname, setNickname] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const validationError = validate(nickname, t);
    if (validationError) {
      setError(validationError);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await signIn(nickname.trim());
    } catch (err) {
      setError(errorText(t, err, t("gate.failed")));
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
          <p className="m-0 text-balance text-[var(--text-secondary)]">{t("gate.tagline")}</p>
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
            <Label className="text-xs font-bold text-[var(--text-muted)]">{t("gate.label")}</Label>
            <Input autoFocus placeholder={t("gate.placeholder")} className="text-base" />
            {error && <FieldError>{error}</FieldError>}
          </TextField>
          <Button
            type="submit"
            isDisabled={submitting}
            className="w-full rounded-[var(--radius-pill)] py-3 font-display text-base font-bold transition-transform duration-[var(--dur-fast)] ease-[var(--ease-spring)] not-disabled:hover:scale-[1.03] not-disabled:active:scale-95"
          >
            {submitting ? t("gate.submitting") : t("gate.submit")}
          </Button>
        </Form>

        <p className="m-0 text-xs text-[var(--text-muted)]">{t("gate.footnote")}</p>
      </div>
      <div className="flex items-center gap-2">
        <LanguagePicker />
        <ThemeToggle />
      </div>
    </main>
  );
}
