import { Button } from "@heroui/react";
import { useTranslation } from "react-i18next";
import { useRegisterSW } from "virtual:pwa-register/react";

// Registers the service worker, and offers the new build once one is waiting.
//
// The worker is configured never to activate on its own, because applying an update means
// reloading the page and a reload lands in the middle of whatever move the player is making.
// So a new build sits there precached until this asks, and the reassurance in the body is
// literally true: the match lives in its Durable Object, not in this tab.
//
// In a dev server the virtual module is a stub that registers nothing, so `needRefresh` never
// flips and this renders nothing at all.
export function UpdatePrompt() {
  const { t } = useTranslation();
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  if (!needRefresh) return null;

  // Bottom right from `sm` up, where it clears the centred column the hub and the nickname gate
  // both lay out in; centred on a phone, which has no room to sit beside anything, and lifted
  // clear of the hub's tab bar there.
  return (
    <div
      role="status"
      className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] left-1/2 z-50 flex w-[min(24rem,calc(100%-2rem))] -translate-x-1/2 animate-in flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--border-accent)] bg-[var(--surface-2)] p-4 shadow-[var(--shadow-3)] duration-300 fade-in slide-in-from-bottom-4 sm:right-4 sm:bottom-4 sm:left-auto sm:translate-x-0"
    >
      <div className="flex flex-col gap-1">
        <p className="m-0 font-display text-sm font-bold">{t("update.title")}</p>
        <p className="m-0 text-sm text-[var(--text-muted)]">{t("update.body")}</p>
      </div>
      <div className="flex gap-2">
        <Button size="sm" onPress={() => void updateServiceWorker(true)}>
          {t("update.reload")}
        </Button>
        <Button type="button" variant="ghost" size="sm" onPress={() => setNeedRefresh(false)}>
          {t("update.later")}
        </Button>
      </div>
    </div>
  );
}
