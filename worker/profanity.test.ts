import { readdirSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { WORDLISTS, isProfaneNickname } from "./profanity";

// Every case is built from the lists' own entries.
const LISTED = Object.values(WORDLISTS).flat();
const WORD = LISTED.find((entry) => /^[a-z]{5,7}$/.test(entry)) ?? "";

describe("isProfaneNickname", () => {
  // Entries holding a digit are skipped: leetspeak turns every digit in the
  // text into a letter, so those entries can never match.
  it("refuses every entry of the lists", () => {
    expect(WORD).not.toBe("");
    expect(LISTED.filter((entry) => !/\d/.test(entry) && !isProfaneNickname(entry))).toEqual([]);
  });

  it("refuses an entry however it is disguised", () => {
    const leet: Record<string, string> = { a: "4", e: "3", i: "1", o: "0", s: "5", t: "7" };
    const fullWidth = WORD.replace(/[a-z]/g, (letter) =>
      String.fromCodePoint(letter.codePointAt(0)! - 0x61 + 0xff41),
    );
    const disguises = [
      [...WORD].join("."),
      [...WORD].join(" "),
      [...WORD].join("_"),
      `${WORD}99`,
      `99_${WORD}`,
      [...WORD].map((letter) => leet[letter] ?? letter).join(""),
      fullWidth,
      `  ${WORD.toUpperCase()}  `,
    ];
    expect(disguises.filter((nickname) => !isProfaneNickname(nickname))).toEqual([]);
  });

  // Glued inside a longer word, an entry is left alone by the lists, which
  // match whole words only, but obscenity's dataset still finds the words it
  // knows.
  it("matches the lists as whole words, and the dataset inside words", () => {
    const glued = (entry: string) => isProfaneNickname(`zq${entry}zq`);
    const plain = LISTED.filter((entry) => /^[a-z]{4,6}$/.test(entry));
    expect(plain.some(glued)).toBe(true);
    expect(plain.every(glued)).toBe(false);
  });

  it("matches an entry with no word character in it", () => {
    const symbols = LISTED.filter((entry) => !/\w/.test(entry));
    expect(symbols).not.toEqual([]);
    for (const entry of symbols) {
      expect(isProfaneNickname(entry)).toBe(true);
      expect(isProfaneNickname(`${entry} alice`)).toBe(true);
    }
  });

  it("covers every language web/locales ships that the lists know", () => {
    const jsonNames = (dir: string) =>
      readdirSync(dir)
        .filter((name) => name.endsWith(".json"))
        .map((name) => name.slice(0, -".json".length));

    const available = new Set(jsonNames("node_modules/naughty-words"));
    const expected = jsonNames("web/locales").filter((language) => available.has(language));
    expect(Object.keys(WORDLISTS).sort()).toEqual(expected.sort());
  });
});
