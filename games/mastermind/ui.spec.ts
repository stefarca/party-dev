import { expect, test } from "../../e2e/fixtures";
import type { Player } from "../../e2e/fixtures";

// The Mastermind board, played in a browser. Today's code comes from a seed
// the test cannot know, so these specs never expect particular marks: they
// read each guess from the line a screen reader reads, and check what any
// board must do. e2e/daily.spec.ts covers starting, ending and the chart.

async function startRun(player: Player) {
  await player.page.goto("/daily/mastermind");
  await player.page.getByRole("button", { name: "Start today's run" }).click();
  await expect(palette(player)).toBeVisible();
}

function palette(player: Player) {
  return player.page.getByRole("group", { name: "Colours" });
}

function guesses(player: Player) {
  return player.page.getByRole("list", { name: "Your guesses" }).getByRole("listitem");
}

function guessCount(player: Player) {
  return player.page.getByRole("definition").filter({ hasText: "Guesses" });
}

function check(player: Player) {
  return player.page.getByRole("button", { name: "Check", exact: true });
}

// Types a guess by the colours' numbers, 1 to 7, and checks it.
async function guessByKeys(player: Player, digits: string) {
  for (const digit of digits) await player.page.keyboard.press(digit);
  await expect(check(player)).toBeEnabled();
  await player.page.keyboard.press("Enter");
}

test("everyone cracks the same code today", async ({ newPlayer }) => {
  const [ada, bob] = await Promise.all([newPlayer("Ada"), newPlayer("Bob")]);
  await startRun(ada);
  await startRun(bob);

  await guessByKeys(ada, "12345");
  await guessByKeys(bob, "12345");
  await expect(guesses(ada)).toHaveCount(1);
  await expect(guesses(bob)).toHaveCount(1);
  const line = await guesses(ada).first().getAttribute("aria-label");
  expect(line).toMatch(
    /^Guess 1: Orange, Sky blue, Green, Yellow, Blue\. \d in place, \d misplaced\.$/,
  );
  await expect(guesses(bob).first()).toHaveAccessibleName(line!);
});

test("a guess is five different colours, built from the palette", async ({ newPlayer }) => {
  const ada = await newPlayer("Ada");
  await startRun(ada);
  const { page } = ada;
  const row = page.getByRole("group", { name: "Guess 1 of 7" });
  await expect(guessCount(ada)).toHaveText(/Guesses\s*0\/7/);
  await expect(check(ada)).toBeDisabled();

  await palette(ada).getByRole("button", { name: "Orange" }).click();
  await palette(ada).getByRole("button", { name: "Pink" }).click();
  await expect(
    row.getByRole("button", { name: "Slot 1: Orange, press to take it out" }),
  ).toBeVisible();
  await expect(
    row.getByRole("button", { name: "Slot 2: Pink, press to take it out" }),
  ).toBeVisible();
  // A colour already in the guess cannot go in again.
  await expect(palette(ada).getByRole("button", { name: "Orange" })).toBeDisabled();

  // Taking a peg out frees its slot, and its colour, for the next pick.
  await row.getByRole("button", { name: /^Slot 1: Orange/ }).click();
  await expect(row.getByRole("button", { name: "Slot 1: empty" })).toBeVisible();
  await expect(palette(ada).getByRole("button", { name: "Orange" })).toBeEnabled();
  await palette(ada).getByRole("button", { name: "Blue", exact: true }).click();
  await expect(row.getByRole("button", { name: /^Slot 1: Blue/ })).toBeVisible();

  // Erase takes back the last peg.
  await page.getByRole("button", { name: "Erase" }).click();
  await expect(row.getByRole("button", { name: "Slot 2: empty" })).toBeVisible();

  for (const name of ["Green", "Yellow", "Red", "Sky blue"]) {
    await palette(ada).getByRole("button", { name }).click();
  }
  // Five pegs fill the row: nothing more goes in, and it can be checked.
  await expect(palette(ada).getByRole("button", { name: "Pink" })).toBeDisabled();
  await check(ada).click();

  await expect(guesses(ada)).toHaveCount(1);
  await expect(guesses(ada).first()).toHaveAccessibleName(
    /^Guess 1: Blue, Green, Yellow, Red, Sky blue\. \d in place, \d misplaced\.$/,
  );
  await expect(guessCount(ada)).toHaveText(/Guesses\s*1\/7/);
  await expect(page.getByRole("group", { name: "Guess 2 of 7" })).toBeVisible();
});

test("seven guesses end the run, cracked or not", async ({ newPlayer }) => {
  const ada = await newPlayer("Ada");
  await startRun(ada);

  const tries = ["12345", "21345", "31245", "41235", "51234", "13245", "14235"];
  for (const [i, digits] of tries.entries()) {
    if (await ada.page.getByText(/^Cracked in \d guess/).isVisible()) break;
    await guessByKeys(ada, digits);
    await expect(guesses(ada)).toHaveCount(i + 1);
  }

  await expect(ada.page.getByRole("heading", { name: "Today's run is over" })).toBeVisible();
  const cracked = await ada.page.getByText(/^Cracked in \d guess/).isVisible();
  if (!cracked) {
    await expect(ada.page.getByText("Out of guesses.", { exact: false })).toBeVisible();
    await expect(guessCount(ada)).toHaveText(/Guesses\s*7\/7/);
  }
  for (const button of await palette(ada).getByRole("button").all()) {
    await expect(button).toBeDisabled();
  }
  await expect(check(ada)).toBeDisabled();
});

test("a run that is over takes no more guesses", async ({ newPlayer }) => {
  const ada = await newPlayer("Ada");
  await startRun(ada);
  await ada.page.getByRole("button", { name: "End run" }).click();
  await ada.page.getByRole("alertdialog").getByRole("button", { name: "End run" }).click();
  await expect(ada.page.getByText("This run is over.")).toBeVisible();

  await expect(palette(ada).getByRole("button", { name: "Orange" })).toBeDisabled();
  for (const digit of "12345") await ada.page.keyboard.press(digit);
  await ada.page.keyboard.press("Enter");
  await expect(guessCount(ada)).toHaveText(/Guesses\s*0\/7/);
  await expect(ada.page.getByRole("list", { name: "Your guesses" })).toHaveCount(0);
});
