// A nickname is this app's whole account: the same one typed on a second
// device signs in as the same player and finds the same matches. That makes
// "the same nickname" a question with exactly one answer, and this file is
// it — the key two nicknames are compared by.
//
// Pure and unit-testable; no crypto, no I/O. The worker is the only caller
// that matters (the D1 unique index is built on what this returns), but it
// lives in shared/ because the client shows the rule to the player before
// they ever hit the network.

// Folding rules, in order:
//  - NFKC, so "ﬁnn" and "finn" (or a full-width "Ａda") are one nickname
//    rather than two that look identical in every font.
//  - Inner whitespace runs collapse to one space, and the ends are trimmed,
//    so "Ada  Lovelace " cannot shadow "Ada Lovelace".
//  - Lowercased, so nobody has to remember how they capitalised it.
//
// The *display* nickname keeps the player's own spelling — only the key is
// folded.
export function nicknameKey(nickname: string): string {
  return nickname.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
}

// What a roster shows for a player the registry cannot name right now — a
// failed lookup, or an id with no `players` row. Only ever displayed, never
// stored: the next lookup that succeeds replaces it.
export const UNKNOWN_NICKNAME = "?";

// The display form: the player's own capitalisation, with the same
// whitespace tidying so the roster never shows a name padded out with
// spaces.
export function displayNickname(nickname: string): string {
  return nickname.normalize("NFKC").replace(/\s+/g, " ").trim();
}

export const NICKNAME_MAX_LENGTH = 24;
