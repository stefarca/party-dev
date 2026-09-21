import type { BlacklistedTerm, ParsedPattern } from "obscenity";
import {
  RegExpMatcher,
  collapseDuplicatesTransformer,
  englishDataset,
  englishRecommendedTransformers,
  parseRawPattern,
  resolveConfusablesTransformer,
  resolveLeetSpeakTransformer,
  toAsciiLowerCaseTransformer,
} from "obscenity";

import englishWords from "naughty-words/en.json";
import italianWords from "naughty-words/it.json";

import { nicknameKey } from "../shared/nickname";

// Which nicknames this app refuses. It is a speed bump, not moderation, and it
// runs only in the Worker: shipping the word lists to the browser would
// publish them.

// The naughty-words list for every language `web/locales/` ships that it
// covers (worker/profanity.test.ts fails when one is missing). The lists are
// used as published, so their entries only ever match a whole word: matched
// inside a word, their short entries would refuse ordinary names.
export const WORDLISTS: Record<string, readonly string[]> = {
  en: englishWords,
  it: italianWords,
};

// Local amendments to what the libraries provide, empty until needed. Write
// entries lowercase. A term in ALLOWED spares any match it overlaps, in either
// matcher. A word in REFUSED is matched like a list entry.
const ALLOWED: readonly string[] = [];
const REFUSED: readonly string[] = [];

// Every spelling of an entry worth matching: with and without its accents,
// since the text is folded to ASCII before matching, and with and without its
// spaces, so a multi-word entry is caught when a nickname runs it together.
function spellings(word: string): string[] {
  const forms = [word, word.normalize("NFD").replace(/\p{M}+/gu, "")];
  return [...new Set(forms.flatMap((form) => [form, form.replace(/\s+/g, "")]))];
}

// An entry as a whole-word pattern. The boundary compiles to `\b`, so it is
// only asserted next to a word character: an entry made of symbols would
// otherwise never match.
function wholeWord(word: string): ParsedPattern {
  return {
    ...parseRawPattern(word),
    requireWordBoundaryAtStart: /^\w/.test(word),
    requireWordBoundaryAtEnd: /\w$/.test(word),
  };
}

// obscenity's English dataset matches inside words and carries its own
// exceptions.
const english = englishDataset.build();
const englishMatcher = new RegExpMatcher({
  blacklistedTerms: english.blacklistedTerms,
  whitelistedTerms: [...(english.whitelistedTerms ?? []), ...ALLOWED],
  ...englishRecommendedTransformers,
});

// The lists get a matcher of their own because the English preset collapses
// every repeated letter in the text, which its dataset is written for and a
// flat list is not. Here repeats are capped at two, on the entries and on the
// text alike, so the two still meet. A letter doubled where an entry has one
// is therefore not caught by this matcher.
const REPEAT_CAP = 2;
const repeats = new RegExp(`(.)\\1{${REPEAT_CAP},}`, "gu");
const capRepeats = (text: string) => text.replace(repeats, "$1".repeat(REPEAT_CAP));

const wordlistMatcher = new RegExpMatcher({
  blacklistedTerms: [...Object.values(WORDLISTS).flat(), ...REFUSED]
    .flatMap(spellings)
    .map((word, id): BlacklistedTerm => ({ id, pattern: wholeWord(capRepeats(word)) })),
  whitelistedTerms: [...ALLOWED],
  blacklistMatcherTransformers: [
    resolveConfusablesTransformer(),
    resolveLeetSpeakTransformer(),
    toAsciiLowerCaseTransformer(),
    collapseDuplicatesTransformer({ defaultThreshold: REPEAT_CAP }),
  ],
  whitelistMatcherTransformers: [toAsciiLowerCaseTransformer()],
});

// The readings of a nickname that get matched. The transformers undo lookalike
// characters, leetspeak and repeated letters; the readings undo separators.
// The second drops every separator, so letters spaced out with punctuation
// join up again. The third treats digits and underscores as spaces, so a word
// with digits around it is still a whole word.
function readings(key: string): Set<string> {
  return new Set([key, key.replace(/[^\p{L}\p{N}]+/gu, ""), key.replace(/[\p{N}_]+/gu, " ")]);
}

// Whether `nickname` is refused, judged on the same folded key the registry
// compares nicknames by.
export function isProfaneNickname(nickname: string): boolean {
  for (const reading of readings(nicknameKey(nickname))) {
    if (englishMatcher.hasMatch(reading) || wordlistMatcher.hasMatch(reading)) return true;
  }
  return false;
}
