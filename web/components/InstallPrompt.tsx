import { useEffect, useId, useState } from "react";

import { Button } from "@heroui/react";
import { useTranslation } from "react-i18next";

import { dismissInstall, promptInstall, useInstallOffer } from "../install";
import { pushConfigured } from "../push";
import { Buddy } from "./Brand";

// "Install Pimpom", inline on the hub. It renders nothing unless this browser can actually
// install the app and it is not already running as one — see web/install.ts. The hub only mounts
// it for a player who has a match, because that is when coming back to the app is worth an icon.
//
// On iOS the body promises turn notifications, but only when the deployment sends them: there,
// installing is the one thing that turns them on. Elsewhere push already works in a tab, so
// crediting it to installing would be untrue.

// The iOS Share glyph, since that is what the player has to find, and it has no label on screen.
function ShareIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-4 flex-none"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3v12" />
      <path d="m8 7 4-4 4 4" />
      <path d="M8 10H6a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1h-2" />
    </svg>
  );
}

export function InstallPrompt({ className = "" }: { className?: string }) {
  const { t } = useTranslation();
  const offer = useInstallOffer();
  const titleId = useId();
  const [notifies, setNotifies] = useState(false);

  useEffect(() => {
    if (offer !== "ios") return;
    let cancelled = false;
    void pushConfigured().then((yes) => {
      if (!cancelled) setNotifies(yes);
    });
    return () => {
      cancelled = true;
    };
  }, [offer]);

  if (offer === "none") return null;

  const ios = offer === "ios";

  return (
    <section
      aria-labelledby={titleId}
      className={`flex max-w-xl animate-in items-start gap-3 rounded-[var(--radius-lg)] border border-[var(--border-accent)] bg-[var(--surface-2)] p-4 shadow-[var(--shadow-2)] duration-300 fade-in slide-in-from-top-2 ${className}`}
    >
      <Buddy className="mt-0.5 size-8 flex-none text-accent" />
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 id={titleId} className="m-0 font-display text-sm font-bold">
            {t("install.title")}
          </h2>
          <p className="m-0 text-sm text-[var(--text-muted)]">
            {t(ios && notifies ? "install.bodyNotify" : "install.body")}
          </p>
          {ios && (
            <p className="m-0 flex items-center gap-1.5 text-sm font-semibold text-[var(--text-secondary)]">
              <ShareIcon />
              {t("install.iosSteps")}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          {!ios && (
            <Button
              size="sm"
              onPress={() =>
                void promptInstall().catch((err: unknown) => {
                  console.error("could not open the install dialog", err);
                })
              }
            >
              {t("install.action")}
            </Button>
          )}
          {/* Alone, a ghost button would float off the text's edge with nothing beside it. */}
          <Button variant={ios ? "secondary" : "ghost"} size="sm" onPress={dismissInstall}>
            {t("install.dismiss")}
          </Button>
        </div>
      </div>
    </section>
  );
}
