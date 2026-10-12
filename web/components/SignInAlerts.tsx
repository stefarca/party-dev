import { useCallback, useEffect, useState } from "react";

import { Button } from "@heroui/react";
import { useTranslation } from "react-i18next";

import type { SignInNotices } from "../../shared/protocol";
import { ApiError, answerSignIn, getSignInNotices, signOutEverywhere } from "../api";
import { useLanguage } from "../i18n";
import { currentPushEndpoint } from "../push";
import { useSession } from "../session";

// How often a visible page asks about sign-ins to its player's name. It is
// also how the server knows the player has a device that could answer one,
// so it has to be well inside the server's five-minute window.
const POLL_MS = 10 * 1000;

// Sign-ins to the player's name, on every signed-in page: a device asking to
// come in, with Allow and Deny, and a device that came in without the
// player's say, with "That was me" and "Sign out everywhere". Nothing shows
// when there is nothing to answer.
export function SignInAlerts() {
  const { t } = useTranslation();
  const language = useLanguage();
  const { notifyUnauthorized } = useSession();
  const [notices, setNotices] = useState<SignInNotices | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setNotices(await getSignInNotices());
      setNow(Date.now());
    } catch (err) {
      // Signed out from another device: back to the gate.
      if (err instanceof ApiError && err.status === 401) notifyUnauthorized();
    }
  }, [notifyUnauthorized]);

  useEffect(() => {
    let timer: number | undefined;
    function schedule() {
      window.clearInterval(timer);
      if (document.visibilityState === "visible") {
        void refresh();
        timer = window.setInterval(() => void refresh(), POLL_MS);
      }
    }
    schedule();
    document.addEventListener("visibilitychange", schedule);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", schedule);
    };
  }, [refresh]);

  // The countdown on a request that goes through by itself.
  const ticking = (notices?.pending ?? []).some((p) => p.autoAt !== null);
  useEffect(() => {
    if (!ticking) return;
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(tick);
  }, [ticking]);

  async function act(work: () => Promise<void>, done?: string) {
    setBusy(true);
    setMessage(null);
    try {
      await work();
      if (done) setMessage(done);
    } catch (err) {
      console.error("could not answer the sign-in", err);
      setMessage(t("signIns.failed"));
    } finally {
      setBusy(false);
      await refresh();
    }
  }

  const pending = notices?.pending ?? [];
  const recent = notices?.recent ?? [];
  if (pending.length === 0 && recent.length === 0 && !message) return null;

  const when = (at: number) =>
    new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" }).format(at);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-4 pt-4">
      {pending.map((request) => {
        const left =
          request.autoAt !== null ? Math.max(0, Math.ceil((request.autoAt - now) / 1000)) : null;
        return (
          <section
            key={request.id}
            aria-label={t("signIns.requestLabel")}
            className="flex animate-in flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--border-accent)] bg-[var(--surface-2)] p-4 shadow-[var(--shadow-2)] duration-300 fade-in slide-in-from-top-2"
          >
            <div className="flex flex-col gap-1">
              <h2 className="m-0 font-display text-sm font-bold">
                {t("signIns.requestTitle", { device: request.device })}
              </h2>
              <p className="m-0 text-sm text-[var(--text-muted)]">
                {left !== null
                  ? t("signIns.requestAuto", {
                      time: `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`,
                    })
                  : t("signIns.requestBody")}
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                isDisabled={busy}
                onPress={() => void act(() => answerSignIn(request.id, "approve"))}
              >
                {t("signIns.allow")}
              </Button>
              <Button
                size="sm"
                variant="danger"
                isDisabled={busy}
                onPress={() => void act(() => answerSignIn(request.id, "deny"))}
              >
                {t("signIns.deny")}
              </Button>
            </div>
          </section>
        );
      })}

      {recent.length > 0 && (
        <section
          aria-label={t("signIns.recentLabel")}
          className="flex animate-in flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--surface-2)] p-4 shadow-[var(--shadow-2)] duration-300 fade-in"
        >
          <div className="flex flex-col gap-1">
            <h2 className="m-0 font-display text-sm font-bold">{t("signIns.recentTitle")}</h2>
            <ul className="m-0 flex list-none flex-col gap-0.5 p-0 text-sm">
              {recent.map((signIn) => (
                <li key={signIn.id}>
                  {t("signIns.recentItem", { device: signIn.device, time: when(signIn.at) })}
                </li>
              ))}
            </ul>
            <p className="m-0 text-xs text-[var(--text-muted)]">{t("signIns.recentHint")}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              isDisabled={busy}
              onPress={() =>
                void act(async () => {
                  await Promise.all(recent.map((signIn) => answerSignIn(signIn.id, "ack")));
                })
              }
            >
              {t("signIns.itWasMe")}
            </Button>
            <Button
              size="sm"
              variant="danger"
              isDisabled={busy}
              onPress={() =>
                void act(
                  async () => signOutEverywhere(await currentPushEndpoint().catch(() => undefined)),
                  t("signIns.signedOutEverywhere"),
                )
              }
            >
              {t("signIns.signOutEverywhere")}
            </Button>
          </div>
        </section>
      )}

      {message && (
        <p role="status" className="m-0 text-sm text-[var(--text-secondary)]">
          {message}
        </p>
      )}
    </div>
  );
}
