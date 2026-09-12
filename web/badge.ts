// Tab title / favicon "your turn" badge (PLAN.md §8 item 2, plan 08 step 5).
//
// `document.title` and the favicon `<link>` are themselves page-level global
// state, and two independent sources need to contribute to the same count:
// the dashboard's full "your turn" bucket (the source of truth whenever the
// dashboard is mounted) and a live match snapshot on whichever match page is
// currently open (so a WS push that makes it your turn updates the badge
// immediately, without waiting for the next dashboard visit/poll). Both are
// tracked as a set of match ids "needing my move" rather than a bare
// counter, so the two sources can update independently without clobbering
// each other — `setDashboardYourTurn` replaces the whole set (it always
// knows the full truth), `setMatchWaiting` only ever adds/removes the one
// match id it is watching.

const BASE_TITLE = "Party";
const BASE_FAVICON_HREF = "/favicon.svg";
const FAVICON_SIZE = 32;

const waitingMatchIds = new Set<string>();

function applyTitle(count: number): void {
  document.title = count > 0 ? `(${count}) ${BASE_TITLE}` : BASE_TITLE;
}

// Favicon badge: cosmetic and best-effort (Risks/notes explicitly allow
// shipping the title badge alone if this fights the tooling). Draws a red
// dot with the count over the static base icon and swaps the
// `<link rel="icon">` href to the resulting data URL; restores the static
// base icon at zero. Any failure (no canvas, no 2d context) is swallowed
// silently — the title badge above already carries the information.
function applyFavicon(count: number): void {
  try {
    let link = document.querySelector<HTMLLinkElement>("link[rel='icon']");
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      document.head.appendChild(link);
    }
    if (count <= 0) {
      link.href = BASE_FAVICON_HREF;
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.width = FAVICON_SIZE;
    canvas.height = FAVICON_SIZE;
    const ctx2d = canvas.getContext("2d");
    if (!ctx2d) return;

    // Base glyph: a simple filled circle standing in for the static icon —
    // good enough for a badge that is only ever shown briefly overlaid.
    ctx2d.fillStyle = "#4f46e5";
    ctx2d.beginPath();
    ctx2d.arc(FAVICON_SIZE / 2, FAVICON_SIZE / 2, FAVICON_SIZE / 2 - 1, 0, Math.PI * 2);
    ctx2d.fill();

    const label = count > 9 ? "9+" : String(count);
    const dotRadius = FAVICON_SIZE * 0.32;
    const cx = FAVICON_SIZE - dotRadius - 1;
    const cy = dotRadius + 1;
    ctx2d.fillStyle = "#dc2626";
    ctx2d.beginPath();
    ctx2d.arc(cx, cy, dotRadius, 0, Math.PI * 2);
    ctx2d.fill();
    ctx2d.fillStyle = "#ffffff";
    ctx2d.font = `${Math.floor(dotRadius * 1.15)}px sans-serif`;
    ctx2d.textAlign = "center";
    ctx2d.textBaseline = "middle";
    ctx2d.fillText(label, cx, cy + 1);

    link.href = canvas.toDataURL("image/png");
  } catch (err) {
    console.error("badge: favicon update failed, skipping", err);
  }
}

function render(): void {
  const count = waitingMatchIds.size;
  applyTitle(count);
  applyFavicon(count);
}

// The dashboard's full "your turn" bucket — always the full, authoritative
// set for however many matches await this player, replacing whatever a
// since-navigated-away match page may have last set via `setMatchWaiting`.
export function setDashboardYourTurn(matchIds: string[]): void {
  waitingMatchIds.clear();
  for (const id of matchIds) waitingMatchIds.add(id);
  render();
}

// Called from the currently-open match page whenever a fresh snapshot
// arrives (WS or HTTP): keeps the badge live between dashboard visits
// without needing to know about any other match.
export function setMatchWaiting(matchId: string, waitingOnMe: boolean): void {
  if (waitingOnMe) waitingMatchIds.add(matchId);
  else waitingMatchIds.delete(matchId);
  render();
}

// Called when a match page unmounts, so a match that stops being watched
// does not linger in the badge until the next dashboard visit resyncs it.
export function clearMatchWaiting(matchId: string): void {
  waitingMatchIds.delete(matchId);
  render();
}

// §8 step 5's focus-restore case: a cheap guard against `document.title`
// staying stuck on a stale badge if a background tab's JS was throttled
// mid-update — re-applies the current (already correct) count the instant
// the tab regains focus.
if (typeof window !== "undefined") {
  window.addEventListener("focus", () => {
    if (waitingMatchIds.size === 0) applyTitle(0);
  });
}
