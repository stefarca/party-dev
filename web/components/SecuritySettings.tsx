import { useEffect, useState } from "react";
import type { FormEvent } from "react";

import { Button, FieldError, Form, Input, Label, TextField } from "@heroui/react";
import { browserSupportsWebAuthn, startRegistration } from "@simplewebauthn/browser";
import type { PublicKeyCredentialCreationOptionsJSON } from "@simplewebauthn/browser";
import { useTranslation } from "react-i18next";

import { PIN_RE } from "../../shared/protocol";
import type { SecurityState } from "../../shared/protocol";
import {
  addPasskey,
  getSecurity,
  passkeyRegistrationOptions,
  removePasskeys,
  removePin,
  setPin,
  signOutEverywhere,
} from "../api";
import { useAchievements } from "../achievements";
import { errorText } from "../errors";
import { currentPushEndpoint } from "../push";

// The lock on the player's name, in the profile popup. Entirely optional:
// without it, a new device gets in once the player's other device allows it
// (or by itself, if nobody answers). With a PIN or a passkey, only those or
// the player's approval let a new device in. Locking earns an achievement,
// which is the nudge to do it.
export function SecuritySettings() {
  const { t } = useTranslation();
  const { checkSoon } = useAchievements();
  const [state, setState] = useState<SecurityState | null>(null);
  const [editingPin, setEditingPin] = useState(false);
  const [pin, setPinValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const passkeys = browserSupportsWebAuthn();

  useEffect(() => {
    let cancelled = false;
    getSecurity()
      .then((s) => {
        if (!cancelled) setState(s);
      })
      .catch((err: unknown) => console.error("could not read the lock settings", err));
    return () => {
      cancelled = true;
    };
  }, []);

  async function run(work: () => Promise<SecurityState | void>, done?: string) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const next = await work();
      if (next) setState(next);
      if (done) setMessage(done);
      return true;
    } catch (err) {
      setError(errorText(t, err, t("security.failed")));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function handlePin(e: FormEvent) {
    e.preventDefault();
    if (!PIN_RE.test(pin)) {
      setError(t("security.pinFormat"));
      return;
    }
    if (await run(() => setPin(pin), t("security.pinSaved"))) {
      setEditingPin(false);
      setPinValue("");
      checkSoon();
    }
  }

  async function handleAddPasskey() {
    const added = await run(async () => {
      const optionsJSON =
        (await passkeyRegistrationOptions()) as PublicKeyCredentialCreationOptionsJSON;
      return addPasskey(await startRegistration({ optionsJSON }));
    }, t("security.passkeySaved"));
    if (added) checkSoon();
  }

  const locked = !!state && (state.pin || state.passkeys > 0);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <span className="text-xs font-bold text-[var(--text-muted)]">{t("security.title")}</span>
        <p className="m-0 text-xs text-[var(--text-muted)]">
          {t(locked ? "security.lockedHint" : "security.unlockedHint")}
        </p>
      </div>

      {state && editingPin && (
        <Form onSubmit={handlePin} className="flex flex-col gap-2">
          <TextField
            value={pin}
            onChange={(value) => {
              setPinValue(value.replace(/\D/g, ""));
              setError(null);
            }}
            maxLength={8}
            isInvalid={!!error}
          >
            <Label className="text-xs font-bold text-[var(--text-muted)]">
              {t("security.newPin")}
            </Label>
            <Input type="password" inputMode="numeric" autoComplete="new-password" autoFocus />
            {error && <FieldError>{error}</FieldError>}
          </TextField>
          <div className="flex gap-2">
            <Button type="submit" size="sm" isDisabled={busy}>
              {t("security.savePin")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onPress={() => {
                setEditingPin(false);
                setPinValue("");
                setError(null);
              }}
            >
              {t("security.cancel")}
            </Button>
          </div>
        </Form>
      )}

      {state && !editingPin && (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            isDisabled={busy}
            onPress={() => {
              setEditingPin(true);
              setMessage(null);
            }}
          >
            {t(state.pin ? "security.changePin" : "security.setPin")}
          </Button>
          {state.pin && (
            <Button
              size="sm"
              variant="ghost"
              isDisabled={busy}
              onPress={() => void run(removePin, t("security.pinRemoved"))}
            >
              {t("security.removePin")}
            </Button>
          )}
          {passkeys && (
            <Button
              size="sm"
              variant="secondary"
              isDisabled={busy}
              onPress={() => void handleAddPasskey()}
            >
              {t("security.addPasskey")}
            </Button>
          )}
          {state.passkeys > 0 && (
            <Button
              size="sm"
              variant="ghost"
              isDisabled={busy}
              onPress={() => void run(removePasskeys, t("security.passkeysRemoved"))}
            >
              {t("security.removePasskeys", { count: state.passkeys })}
            </Button>
          )}
        </div>
      )}

      {!editingPin && error && (
        <p role="alert" className="m-0 text-sm text-danger">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="m-0 text-xs text-[var(--text-secondary)]">
          {message}
        </p>
      )}

      <Button
        size="sm"
        variant="ghost"
        isDisabled={busy}
        // Pulled left by its own padding, so its label lines up with the ones above it.
        className="-ml-3 self-start text-[var(--text-muted)]"
        onPress={() =>
          void run(
            async () => signOutEverywhere(await currentPushEndpoint().catch(() => undefined)),
            t("security.signedOutEverywhere"),
          )
        }
      >
        {t("security.signOutEverywhere")}
      </Button>
    </div>
  );
}
