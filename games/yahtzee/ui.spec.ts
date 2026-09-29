import { expect, test } from "../../e2e/fixtures";
import type { Player } from "../../e2e/fixtures";

// The Yahtzee table, played in a browser. Today's dice come from a seed the
// test cannot know, so these specs read every die from its accessible name
// and check what any roll must do. e2e/daily.spec.ts covers starting, ending
// and the chart.

const DICE = 5;
const ROUNDS = 13;
const UPPER = ["Ones", "Twos", "Threes", "Fours", "Fives", "Sixes"];

async function startRun(player: Player) {
  await player.page.goto("/daily/yahtzee");
  await player.page.getByRole("button", { name: "Start today's run" }).click();
  await expect(dice(player)).toHaveCount(DICE);
}

function tray(player: Player) {
  return player.page.getByRole("group", { name: "Dice" });
}

function dice(player: Player) {
  return tray(player).getByRole("button");
}

function die(player: Player, number: number) {
  return tray(player).getByRole("button", { name: new RegExp(`^Die ${number}:`) });
}

function rollButton(player: Player) {
  return player.page.getByRole("button", { name: /^Roll \(\d left\)$/ });
}

function card(player: Player) {
  return player.page.getByRole("region", { name: "Scorecard" });
}

// The boxes the dice may be scored in now, each named for what it would score.
function options(player: Player) {
  return card(player).getByRole("button", { name: /^Score \d+ in / });
}

function box(player: Player, name: string) {
  return card(player)
    .getByRole("listitem")
    .filter({ hasText: new RegExp(`^${name}\\b`) })
    .first();
}

function stat(player: Player, name: string) {
  return player.page.getByRole("definition").filter({ hasText: name });
}

// What the dice show, as a screen reader hears them; null before a roll.
async function readDice(player: Player): Promise<(number | null)[]> {
  const names = await dice(player).evaluateAll((buttons) =>
    buttons.map((button) => button.getAttribute("aria-label") ?? ""),
  );
  return names.map((name) => {
    const face = name.match(/^Die \d: (\d)$/)?.[1];
    return face === undefined ? null : Number(face);
  });
}

// Rolls, and waits for the dice to land.
async function roll(player: Player, left: number) {
  await expect(rollButton(player)).toHaveAccessibleName(`Roll (${left} left)`);
  await rollButton(player).click();
  await expect(rollButton(player)).toHaveAccessibleName(`Roll (${left - 1} left)`);
  const faces = await readDice(player);
  expect(faces.every((face) => face !== null && face >= 1 && face <= 6)).toBe(true);
  return faces as number[];
}

test("everyone opens the day with the same roll", async ({ newPlayer }) => {
  const [ada, bob] = await Promise.all([newPlayer("Ada"), newPlayer("Bob")]);
  await startRun(ada);
  await startRun(bob);
  await expect(ada.page.getByText(/^Roll up to three times a round/)).toBeVisible();
  expect(await readDice(ada)).toEqual([null, null, null, null, null]);

  const opening = await roll(ada, 3);
  expect(await roll(bob, 3)).toEqual(opening);
});

test("held dice stay put, and a round has three rolls", async ({ newPlayer }) => {
  const ada = await newPlayer("Ada");
  await startRun(ada);
  // Nothing to hold before the first roll.
  await expect(die(ada, 1)).toBeDisabled();
  const first = await roll(ada, 3);

  await die(ada, 1).click();
  await die(ada, 3).click();
  await expect(die(ada, 1)).toHaveAttribute("aria-pressed", "true");
  await expect(die(ada, 3)).toHaveAttribute("aria-pressed", "true");
  // A second tap lets a die go again.
  await die(ada, 5).click();
  await die(ada, 5).click();
  await expect(die(ada, 5)).toHaveAttribute("aria-pressed", "false");

  const second = await roll(ada, 2);
  expect([second[0], second[2]]).toEqual([first[0], first[2]]);
  // Holds carry over to the next roll until they are let go.
  await expect(die(ada, 1)).toHaveAttribute("aria-pressed", "true");

  const third = await roll(ada, 1);
  expect([third[0], third[2]]).toEqual([first[0], first[2]]);
  await expect(rollButton(ada)).toBeDisabled();
  await expect(die(ada, 2)).toBeDisabled();
  await expect(ada.page.getByText("No rolls left: score the dice in an open box.")).toBeVisible();
});

test("every die held leaves nothing to roll", async ({ newPlayer }) => {
  const ada = await newPlayer("Ada");
  await startRun(ada);
  await roll(ada, 3);
  for (let number = 1; number <= DICE; number++) await die(ada, number).click();
  await expect(rollButton(ada)).toBeDisabled();
  await die(ada, 4).click();
  await expect(rollButton(ada)).toBeEnabled();
});

test("the number keys hold the dice and R rolls", async ({ newPlayer }) => {
  const ada = await newPlayer("Ada");
  await startRun(ada);
  await ada.page.keyboard.press("r");
  await expect(rollButton(ada)).toHaveAccessibleName("Roll (2 left)");
  const first = await readDice(ada);

  await ada.page.keyboard.press("2");
  await expect(die(ada, 2)).toHaveAttribute("aria-pressed", "true");
  await ada.page.keyboard.press("r");
  await expect(rollButton(ada)).toHaveAccessibleName("Roll (1 left)");
  expect((await readDice(ada))[1]).toBe(first[1]);
});

test("scoring fills the box, and the next round waits for its roll", async ({ newPlayer }) => {
  const ada = await newPlayer("Ada");
  await startRun(ada);
  const faces = await roll(ada, 3);
  const sum = faces.reduce((total, face) => total + face, 0);
  // Before a box is picked, every one of them is on offer.
  await expect(options(ada)).toHaveCount(ROUNDS);

  await card(ada)
    .getByRole("button", { name: `Score ${sum} in Chance` })
    .click();
  await expect(box(ada, "Chance")).toHaveText(new RegExp(`^Chance\\s*${sum}$`));
  await expect(stat(ada, "Round")).toHaveText(/Round\s*2\/13/);
  await expect(stat(ada, "Score")).toHaveText(new RegExp(`Score\\s*${sum}$`));
  await expect(options(ada)).toHaveCount(0);
  expect(await readDice(ada)).toEqual([null, null, null, null, null]);
  await expect(ada.page.getByText("Round 2 of 13: roll the dice.")).toBeVisible();
  await expect(rollButton(ada)).toHaveAccessibleName("Roll (3 left)");

  // The box is taken for the rest of the run.
  await roll(ada, 3);
  await expect(options(ada)).toHaveCount(ROUNDS - 1);
  await expect(card(ada).getByRole("button", { name: /in Chance$/ })).toHaveCount(0);
});

test("thirteen rounds fill the card and put the run on the chart", async ({ newPlayer }) => {
  const ada = await newPlayer("Ada");
  await startRun(ada);

  // What each box scored, by name, and the Yahtzee bonuses: kept here to add
  // the card up without taking the page's own sums on trust.
  const scored = new Map<string, number>();
  let yahtzees = 0;
  let bonuses = 0;
  for (let round = 1; round <= ROUNDS; round++) {
    const faces = await roll(ada, 3);
    const pick = options(ada).first();
    const [, points, name] = (await pick.getAttribute("aria-label"))!.match(
      /^Score (\d+) in (.+)$/,
    )!;
    if (faces.every((face) => face === faces[0])) {
      yahtzees++;
      if (scored.get("Yahtzee") === 50) bonuses++;
    }
    await pick.click();
    scored.set(name, Number(points));
    await expect(box(ada, name)).toHaveText(new RegExp(`^${name}\\s*${points}$`));
  }

  expect(scored.size).toBe(ROUNDS);
  const upper = UPPER.reduce((total, name) => total + (scored.get(name) ?? 0), 0);
  const total =
    [...scored.values()].reduce((sum, points) => sum + points, 0) +
    (upper >= 63 ? 35 : 0) +
    bonuses * 100;
  await expect(stat(ada, "Score")).toHaveText(new RegExp(`Score\\s*${total}$`));
  await expect(ada.page.getByText(`Card full: ${total} points!`).first()).toBeVisible();
  await expect(ada.page.getByRole("heading", { name: "Today's run is over" })).toBeVisible();
  await expect(ada.page.getByText(`You scored ${total}.`)).toBeVisible();
  const mine = ada.page
    .getByRole("list", { name: /^Chart for / })
    .getByRole("listitem")
    .filter({ hasText: ada.nickname });
  const counted = yahtzees === 0 ? "" : `${yahtzees} ${yahtzees === 1 ? "Yahtzee" : "Yahtzees"}`;
  await expect(mine).toContainText(
    upper >= 63
      ? ["Upper bonus", counted].filter(Boolean).join(" · ")
      : counted || "Every box filled",
  );

  await expect(rollButton(ada)).toBeDisabled();
});

test("a run that is over takes no more rolls", async ({ newPlayer }) => {
  const ada = await newPlayer("Ada");
  await startRun(ada);
  await roll(ada, 3);
  await ada.page.getByRole("button", { name: "End run" }).click();
  await ada.page.getByRole("alertdialog").getByRole("button", { name: "End run" }).click();
  await expect(ada.page.getByText("This run is over.")).toBeVisible();

  await expect(rollButton(ada)).toBeDisabled();
  await expect(die(ada, 1)).toBeDisabled();
  await expect(options(ada)).toHaveCount(0);
  await ada.page.keyboard.press("r");
  await expect(rollButton(ada)).toHaveAccessibleName("Roll (2 left)");
});
