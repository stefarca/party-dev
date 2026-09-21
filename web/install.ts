import { useSyncExternalStore } from "react";

// Offering to install the app, only where a player can actually act on the offer.
//
// There are two ways in, and every other browser gets no offer at all:
//
//   - Chromium announces an installable page with `beforeinstallprompt`, whose `prompt()` opens
//     the browser's own install dialog. It fires once per page load, early, and usually before
//     the hub is on screen, so `listenForInstallPrompt()` runs at boot and holds the event until
//     the hub asks for it. Holding it means calling `preventDefault()`, which also keeps Chrome
//     on Android from showing its own install bar on someone's very first visit.
//   - iOS and iPadOS have no event and no API: the only way in is the Share sheet, so the offer
//     there is instructions. It is also where installing matters most, because Safari only
//     speaks web push inside a Home Screen app.
//
// Same store shape as web/router.tsx: a module-level listener Set, an emitChange(), and
// useSyncExternalStore — no context provider.

export type InstallOffer = "none" | "prompt" | "ios";

// Not in lib.dom: only Chromium has it.
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

const DISMISSED_STORAGE_KEY = "party-install-dismissed";

// How long "Not now" holds. Long enough that nobody is asked twice in the same stretch of
// playing, and short enough that the offer comes back when the player has more reason to want it.
const DISMISS_FOR_MS = 30 * 24 * 60 * 60 * 1000;

type Listener = () => void;
const listeners = new Set<Listener>();

function emitChange(): void {
  for (const listener of listeners) listener();
}

function readDismissed(): boolean {
  try {
    const at = Number(window.localStorage.getItem(DISMISSED_STORAGE_KEY));
    return at > 0 && Date.now() - at < DISMISS_FOR_MS;
  } catch {
    // localStorage can throw (e.g. Safari private mode) — the offer is shown again next load.
    return false;
  }
}

let deferred: BeforeInstallPromptEvent | null = null;
let dismissed = readDismissed();

// Whether this page is already running as the installed app. iOS answers only through its own
// `navigator.standalone`; everything else through the manifest's display mode.
function installed(): boolean {
  if ((navigator as Navigator & { standalone?: boolean }).standalone === true) return true;
  try {
    return window.matchMedia("(display-mode: standalone)").matches;
  } catch {
    return false;
  }
}

function isIos(): boolean {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return true;
  // An iPad asks for desktop sites by default, so it says it is a Mac. A Mac has no touchscreen.
  return /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
}

function getSnapshot(): InstallOffer {
  if (dismissed || installed()) return "none";
  if (deferred) return "prompt";
  return isIos() ? "ios" : "none";
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Called once at boot, before the first render, so an event that fires while the nickname gate or
// a match page is showing is still there when the player reaches the hub.
export function listenForInstallPrompt(): void {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferred = event as BeforeInstallPromptEvent;
    emitChange();
  });
  // Installed from the browser's own menu instead: this tab stays a tab, so `installed()` cannot
  // tell, and an offer still on screen would be offering what just happened.
  window.addEventListener("appinstalled", () => {
    deferred = null;
    emitChange();
  });
}

export function dismissInstall(): void {
  dismissed = true;
  try {
    window.localStorage.setItem(DISMISSED_STORAGE_KEY, String(Date.now()));
  } catch {
    // Best-effort persistence only — the offer is still gone for the rest of this page.
  }
  emitChange();
}

// Opens the browser's install dialog. Must be called from a click, like a permission prompt. An
// event can be prompted only once, so it is dropped before anything is awaited; turning the
// browser's dialog down counts as "Not now".
export async function promptInstall(): Promise<void> {
  const event = deferred;
  if (!event) return;
  deferred = null;
  emitChange();
  await event.prompt();
  const { outcome } = await event.userChoice;
  if (outcome === "dismissed") dismissInstall();
}

export function useInstallOffer(): InstallOffer {
  return useSyncExternalStore(subscribe, getSnapshot);
}
