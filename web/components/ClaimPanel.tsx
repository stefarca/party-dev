import { useEffect, useState } from "react";
import type { FormEvent } from "react";

import { Button, FieldError, Form, Input, Label, TextField } from "@heroui/react";
import { browserSupportsWebAuthn, startAuthentication } from "@simplewebauthn/browser";
import type { PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import { useTranslation } from "react-i18next";

import { PIN_RE } from "../../shared/protocol";
import type { SignInChallenge } from "../../shared/protocol";
import {
  ApiError,
  passkeySignInOptions,
  pollSignIn,
  signInWithPasskey,
  signInWithPin,
} from "../api";
import type { Me } from "../api";
import { errorText } from "../errors";
import { useLanguage } from "../i18n";

// How often the waiting device asks whether the owner has answered.
const POLL_MS = 2000;

// What the gate shows instead of its form when the nickname typed belongs to
// someone: the ways in the owner has left open. A request waits on the
// owner's other device (and, for a name nobody locked, goes through by itself
// once its clock runs out); a locked name also takes its PIN or a passkey.
export function ClaimPanel({
  challenge,
  onSignedIn,
  onCancel,
}: {
  challenge: SignInChallenge;
  onSignedIn: (me: Me) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const language = useLanguage();
  const { nickname, request, methods } = challenge;
  const [status, setStatus] = useState<"waiting" | "denied" | "expired">("waiting");
  const [now, setNow] = useState(() => Date.now());
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [passkeyError, setPasskeyError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const passkeys = methods.passkey && browserSupportsWebAuthn();

  useEffect(() => {
    if (!request || status !== "waiting") return;
    let cancelled = false;
    async function poll() {
      if (!request) return;
      try {
        const result = await pollSignIn(request.id, request.secret);
        if (cancelled) return;
        if (result.status === "signedIn") {
          onSignedIn({ playerId: result.playerId, nickname: result.nickname });
        } else if (result.status !== "pending") {
          setStatus(result.status);
        }
      } catch (err) {
        // A dropped request is retried on the next tick.
        console.error("could not check the sign-in request", err);
      }
    }
    const timer = window.setInterval(() => void poll(), POLL_MS);
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.clearInterval(tick);
    };
  }, [request, status, onSignedIn]);

  async function handlePin(e: FormEvent) {
    e.preventDefault();
    if (!PIN_RE.test(pin)) {
      setPinError(t("claim.pinFormat"));
      return;
    }
    setBusy(true);
    setPinError(null);
    try {
      onSignedIn(await signInWithPin(nickname, pin));
    } catch (err) {
      setPin("");
      if (err instanceof ApiError && err.code === "pin_blocked") {
        const retryAt = (err.body as { retryAt?: number } | undefined)?.retryAt ?? Date.now();
        setPinError(
          t("claim.pinBlocked", {
            time: new Intl.DateTimeFormat(language, { timeStyle: "short" }).format(retryAt),
          }),
        );
      } else {
        setPinError(errorText(t, err, t("claim.failed")));
      }
    } finally {
      setBusy(false);
    }
  }

  async function handlePasskey() {
    setBusy(true);
    setPasskeyError(null);
    try {
      const optionsJSON = (await passkeySignInOptions(
        nickname,
      )) as PublicKeyCredentialRequestOptionsJSON;
      const response = await startAuthentication({ optionsJSON });
      onSignedIn(await signInWithPasskey(response));
    } catch (err) {
      setPasskeyError(errorText(t, err, t("claim.passkeyFailed")));
    } finally {
      setBusy(false);
    }
  }

  const locked = challenge.error === "nickname_locked";
  const secondsLeft =
    request?.autoAt != null ? Math.max(0, Math.ceil((request.autoAt - now) / 1000)) : null;

  return (
    <div className="flex w-full flex-col gap-4 text-left">
      <div className="flex flex-col gap-1">
        <h2 className="m-0 font-display text-lg font-bold">{t("claim.title", { nickname })}</h2>
        <p className="m-0 text-sm text-[var(--text-secondary)]">
          {t(locked ? "claim.locked" : "claim.taken")}
        </p>
      </div>

      {request && (
        <div
          role="status"
          className="flex flex-col gap-1 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3 text-sm"
        >
          {status === "waiting" && (
            <>
              <p className="m-0 font-semibold">{t("claim.waiting")}</p>
              {secondsLeft !== null && (
                <p className="m-0 text-[var(--text-muted)]">
                  {t("claim.autoIn", {
                    time: `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")}`,
                  })}
                </p>
              )}
            </>
          )}
          {status === "denied" && <p className="m-0 text-danger">{t("claim.denied")}</p>}
          {status === "expired" && <p className="m-0 text-danger">{t("claim.expired")}</p>}
        </div>
      )}

      {methods.pin && (
        <Form onSubmit={handlePin} className="flex flex-col gap-2">
          <TextField
            value={pin}
            onChange={(value) => {
              setPin(value.replace(/\D/g, ""));
              setPinError(null);
            }}
            maxLength={8}
            isInvalid={!!pinError}
          >
            <Label className="text-xs font-bold text-[var(--text-muted)]">{t("claim.pin")}</Label>
            <Input type="password" inputMode="numeric" autoComplete="off" autoFocus />
            {pinError && <FieldError>{pinError}</FieldError>}
          </TextField>
          <Button type="submit" size="sm" isDisabled={busy}>
            {t("claim.pinSubmit")}
          </Button>
        </Form>
      )}

      {passkeys && (
        <div className="flex flex-col gap-1">
          <Button
            variant="secondary"
            size="sm"
            isDisabled={busy}
            onPress={() => void handlePasskey()}
          >
            {t("claim.passkey")}
          </Button>
          {passkeyError && (
            <p role="alert" className="m-0 text-sm text-danger">
              {passkeyError}
            </p>
          )}
        </div>
      )}

      <Button variant="ghost" size="sm" onPress={onCancel}>
        {t("claim.cancel")}
      </Button>
    </div>
  );
}
