// Sending a link to someone: the phone's own share sheet where there is one,
// which is what puts a match or a challenge straight into a WhatsApp chat, and
// the clipboard where there is not.

export type ShareOutcome = "shared" | "copied" | "cancelled" | "failed";

// Whether this browser has a share sheet to offer.
export function canShareNatively(): boolean {
  return typeof navigator.share === "function";
}

// An absolute link to `path` on this app. It carries the sharer's language
// when that is not English, since the link's preview is written by the Worker
// before anyone opens it, and the friends a link goes to most likely read
// what its sharer does. The app itself ignores the parameter.
export function shareUrl(path: string, language: string): string {
  const url = new URL(path, window.location.origin);
  if (language !== "en") url.searchParams.set("lang", language);
  return url.toString();
}

// Offers `url` through the share sheet, or copies `text` and `url` together
// when there is none (or it failed for any reason but the player closing it).
export async function shareLink(share: {
  title: string;
  text: string;
  url: string;
}): Promise<ShareOutcome> {
  if (canShareNatively()) {
    try {
      await navigator.share(share);
      return "shared";
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return "cancelled";
    }
  }
  return (await copyText(`${share.text} ${share.url}`)) ? "copied" : "failed";
}

// Copies `text`, reporting whether it worked. The Clipboard API needs a
// secure context, so on plain http off localhost it is not there at all.
export async function copyText(text: string): Promise<boolean> {
  if (!navigator.clipboard) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
