import { useEffect, useState } from "react";

import { ToggleButton } from "@heroui/react";
import { useTranslation } from "react-i18next";

import { useLanguage } from "../i18n";
import { disablePush, enablePush, readPushState, syncPushLanguage } from "../push";
import type { PushState } from "../push";

// "Tell me when it is my turn", for this browser.
//
// It renders nothing at all unless push can actually work here — no service
// worker (every dev server), no VAPID keys on the deployment, or a browser
// without push — because an installed app that silently never notifies is
// worse than one that never offered. See web/push.ts for the three
// conditions.
//
// Blocked permission is the one unusable state that still shows: the browser
// will not ask again, and only its own site settings can undo it, so a
// missing control there would look like the app forgot the feature.

function BellIcon({ muted }: { muted: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-4.5 flex-none"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
      {muted && <line x1="3" y1="3" x2="21" y2="21" />}
    </svg>
  );
}

export function NotificationToggle() {
  const { t } = useTranslation();
  const language = useLanguage();
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void readPushState()
      .catch(() => "unavailable" as const)
      .then((next) => {
        if (!cancelled) setState(next);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Re-registers a subscribed device whenever the app's language changes,
  // and once on every load — the notification is composed on the server, so
  // this is the only thing that keeps its language in step with the app's.
  // The repeat on load is worth its one request: it also refreshes the row,
  // and restores a subscription the server has somehow lost.
  useEffect(() => {
    if (state !== "on") return;
    void syncPushLanguage(language).catch((err: unknown) => {
      console.error("could not update the notification language", err);
    });
  }, [state, language]);

  if (state === null || state === "unavailable") return null;

  const on = state === "on";
  const blocked = state === "denied";

  async function toggle(next: boolean) {
    setBusy(true);
    setFailed(false);
    try {
      setState(next ? await enablePush(language) : await disablePush());
    } catch (err) {
      console.error("could not change the notification setting", err);
      setFailed(true);
      setState(await readPushState().catch(() => "off" as const));
    } finally {
      setBusy(false);
    }
  }

  // Blocked is not a disabled button: a disabled one cannot be focused, so
  // the sentence explaining why it does nothing would never be read out. It
  // is not a button at all — there is nothing here that can lift the block,
  // only the browser's own site settings — so it is a bell with the reason
  // beside it, in the reading order.
  if (blocked) {
    return (
      <span
        title={t("notifications.blocked")}
        className="flex size-10 flex-none cursor-not-allowed items-center justify-center rounded-[var(--radius-pill)] border border-[var(--border-subtle)] bg-[var(--surface-2)] text-[var(--text-muted)] opacity-50"
      >
        <BellIcon muted />
        <span className="sr-only">{t("notifications.blocked")}</span>
      </span>
    );
  }

  return (
    <>
      <ToggleButton
        isSelected={on}
        isDisabled={busy}
        onChange={(next) => void toggle(next)}
        aria-label={t(on ? "notifications.on" : "notifications.off")}
        className="flex size-10 flex-none items-center justify-center rounded-[var(--radius-pill)] border border-[var(--border-subtle)] bg-[var(--surface-2)] text-[var(--text-muted)] transition-[transform,background-color,color] duration-[var(--dur-fast)] ease-[var(--ease-spring)] not-disabled:hover:scale-105 not-disabled:hover:text-[var(--text-primary)] disabled:opacity-50 data-selected:bg-[var(--surface-1)] data-selected:text-[var(--accent-on-soft)] data-selected:shadow-[var(--shadow-1),var(--edge-highlight)]"
      >
        <BellIcon muted={!on} />
      </ToggleButton>
      {/* The header has no room for a message, and a failed toggle is only
          ever visible as the switch going back where it was. This says what
          happened for anyone who would otherwise be told nothing. */}
      {failed && (
        <span role="alert" className="sr-only">
          {t("notifications.failed")}
        </span>
      )}
    </>
  );
}
