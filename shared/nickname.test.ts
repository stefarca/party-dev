import { describe, expect, it } from "vitest";

import { displayNickname, nicknameKey } from "./nickname";

describe("nicknameKey", () => {
  it.each([
    ["Ada", "ada"],
    ["ADA", "ada"],
    ["  Ada  ", "ada"],
    ["Ada  Lovelace", "ada lovelace"],
    ["Ada\tLovelace", "ada lovelace"],
    // NFKC folds the compatibility forms that would otherwise let a second
    // "Ada" exist alongside the first.
    ["Ａda", "ada"],
    ["ﬁnn", "finn"],
  ])("folds %j to %j", (input, expected) => {
    expect(nicknameKey(input)).toBe(expected);
  });

  it("keeps different people apart", () => {
    expect(nicknameKey("ada")).not.toBe(nicknameKey("adam"));
  });
});

describe("displayNickname", () => {
  it("keeps the player's own capitalisation", () => {
    expect(displayNickname("AdaLovelace")).toBe("AdaLovelace");
  });

  it("tidies whitespace, so a padded name cannot shadow a plain one", () => {
    expect(displayNickname("  Ada   Lovelace ")).toBe("Ada Lovelace");
  });
});
