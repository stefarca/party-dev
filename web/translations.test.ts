import { describe, expect, test } from "vitest";

import { GAME_CATALOG } from "../games/catalog";
import { FALLBACK_LANGUAGE, LANGUAGES, NAMESPACES, matchLanguage, resources } from "./translations";

// i18next picks a plural form by suffix, and languages have different sets of them (Italian has a
// `many` that English lacks). Keys are compared with the suffix stripped.
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

// Every string in a namespace, flattened to dotted keys.
function flatten(strings: unknown, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(strings as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") out.set(path, value);
    else for (const [k, v] of flatten(value, path)) out.set(k, v);
  }
  return out;
}

function baseKeys(strings: Map<string, string>): string[] {
  return [...new Set([...strings.keys()].map((key) => key.replace(PLURAL_SUFFIX, "")))].sort();
}

function variables(value: string): string[] {
  return [...value.matchAll(/\{\{\s*([^,}\s]+)/g)].map((m) => m[1]).sort();
}

test("offers English first, and at least one other language", () => {
  expect(LANGUAGES[0]).toBe(FALLBACK_LANGUAGE);
  expect(LANGUAGES.length).toBeGreaterThan(1);
});

describe.each(NAMESPACES)("namespace %s", (namespace) => {
  const english = flatten(resources[FALLBACK_LANGUAGE][namespace]);

  test("exists in English", () => {
    expect(english.size).toBeGreaterThan(0);
  });

  test.each(LANGUAGES.filter((l) => l !== FALLBACK_LANGUAGE))("is fully translated to %s", (l) => {
    const translated = flatten(resources[l]?.[namespace] ?? {});
    expect(baseKeys(translated)).toEqual(baseKeys(english));

    for (const [key, value] of translated) {
      expect(value.trim(), `${l} ${namespace}:${key} is empty`).not.toBe("");
      // A plural form has its own English counterpart only if English uses that form too.
      const source = english.get(key) ?? english.get(key.replace(PLURAL_SUFFIX, "_other"));
      expect(source, `${l} ${namespace}:${key} has no English plural to follow`).toBeDefined();
      expect(variables(value), `${l} ${namespace}:${key}`).toEqual(variables(source!));
    }
  });
});

test.each(GAME_CATALOG)("$id's English name matches the one the server reports", (game) => {
  expect(flatten(resources[FALLBACK_LANGUAGE][game.id] ?? {}).get("name")).toBe(game.name);
});

test.each([
  [["it-IT", "en-US"], "it"],
  [["fr-FR", "IT"], "it"],
  [["en-GB"], "en"],
  [["de-DE", "fr"], "en"],
  [[], "en"],
])("matchLanguage(%j) picks %s", (preferred, expected) => {
  expect(matchLanguage(preferred)).toBe(expected);
});
