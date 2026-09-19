import { expect, test } from "../../e2e/fixtures";
import type { Player } from "../../e2e/fixtures";

type Waters = "Your waters" | "Enemy waters";

// A square on one of a player's two boards, by the name players call it: row letter, then
// column number, "A1" at the top left. Every square's accessible name starts with it.
function square(player: Player, waters: Waters, name: string) {
  return player.page
    .getByRole("group", { name: waters, exact: true })
    .getByRole("button", { name: new RegExp(`^${name}(,|$)`) });
}

// Lays the fleet out one ship to a row down the left edge (carrier on A1–A5, battleship on
// B1–B4, …, destroyer on E1–E2) and presses Ready. Each ship's click picks the next ship.
async function placeFleet(player: Player) {
  for (const name of ["A1", "B1", "C1", "D1", "E1"]) {
    await square(player, "Your waters", name).click();
  }
  await player.page.getByRole("button", { name: "Ready" }).click();
}

// Who fires first is drawn at random once both fleets are down: returns [shooter, the other].
async function firingOrder(a: Player, b: Player): Promise<[Player, Player]> {
  const aFires = a.page.getByText("Your turn — pick a square in enemy waters to fire at.");
  const bFires = a.page.getByText(`Waiting for ${b.nickname} to fire…`);
  await expect(aFires.or(bFires)).toBeVisible();
  return (await aFires.isVisible()) ? [a, b] : [b, a];
}

// One shot. Waiting for the shooter's turn banner to go keeps a page that has not yet seen its
// own shot from firing again.
async function fire(player: Player, name: string) {
  await square(player, "Enemy waters", name).click();
  await expect(player.yourTurn).toBeHidden();
}

test("both fleets are placed, then the first shot shows on both boards and passes the turn", async ({
  startMatch,
}) => {
  const {
    players: [a, b],
  } = await startMatch("battleship");

  // Both players place at once.
  for (const player of [a, b]) {
    await expect(player.yourTurn).toBeVisible();
    await expect(
      player.page.getByText("Placing the carrier: pick the square for its left end."),
    ).toBeVisible();
  }

  // The carrier fits from A6 but would run off the board from A7.
  await expect(square(a, "Your waters", "A6")).toHaveAccessibleName(
    "A6, empty, place the carrier here",
  );
  await expect(square(a, "Your waters", "A7")).toHaveAccessibleName("A7, empty");
  await expect(square(a, "Your waters", "A7")).toBeDisabled();

  await square(a, "Your waters", "A1").click();
  await expect(square(a, "Your waters", "A5")).toHaveAccessibleName("A5, Carrier");
  await expect(
    a.page.getByText("Placing the battleship: pick the square for its left end."),
  ).toBeVisible();

  // A placed ship is picked up again by clicking it, and put back down.
  await square(a, "Your waters", "A3").click();
  await expect(
    a.page.getByText("Placing the carrier: pick the square for its left end."),
  ).toBeVisible();
  await expect(square(a, "Your waters", "A3")).toHaveAccessibleName(
    "A3, empty, place the carrier here",
  );
  await square(a, "Your waters", "A1").click();
  for (const name of ["B1", "C1", "D1", "E1"]) {
    await square(a, "Your waters", name).click();
  }
  await expect(
    a.page.getByText("Fleet placed — press Ready, or pick a ship to move it."),
  ).toBeVisible();
  await a.page.getByRole("button", { name: "Ready" }).click();

  await expect(
    a.page.getByText(`Your fleet is ready. Waiting for ${b.nickname} to place theirs…`),
  ).toBeVisible();
  await expect(a.waitingOn(b)).toBeVisible();

  // Ready waits for the whole fleet, and Random places all of it.
  const ready = b.page.getByRole("button", { name: "Ready" });
  await expect(ready).toBeDisabled();
  await b.page.getByRole("button", { name: "Random" }).click();
  await expect(ready).toBeEnabled();
  await b.page.getByRole("button", { name: "Clear" }).click();
  await expect(ready).toBeDisabled();

  // The other player stands every ship upright instead, one to a column from A1.
  await b.page.getByRole("button", { name: "Rotate (now horizontal)" }).click();
  await expect(
    b.page.getByText("Placing the carrier: pick the square for its top end."),
  ).toBeVisible();
  for (const name of ["A1", "A2", "A3", "A4", "A5"]) {
    await square(b, "Your waters", name).click();
  }
  await expect(square(b, "Your waters", "E1")).toHaveAccessibleName("E1, Carrier");
  await ready.click();

  // Both fleets have a ship on A1, and nothing on J10.
  const [shooter, target] = await firingOrder(a, b);
  await expect(target.waitingOn(shooter)).toBeVisible();
  await expect(square(target, "Enemy waters", "J10")).toBeDisabled();

  await fire(shooter, "J10");

  await expect(square(target, "Your waters", "J10")).toHaveAccessibleName(
    "J10, empty, miss, last shot",
  );
  await expect(target.page.getByText(`${shooter.nickname} fired at J10: miss.`)).toBeVisible();
  await expect(shooter.page.getByText("You fired at J10: miss.")).toBeVisible();
  await expect(target.yourTurn).toBeVisible();

  await fire(target, "A1");

  await expect(square(shooter, "Your waters", "A1")).toHaveAccessibleName(
    "A1, Carrier, hit, last shot",
  );
  await expect(square(target, "Enemy waters", "A1")).toHaveAccessibleName("A1, hit, last shot");
  await expect(shooter.page.getByText(`${target.nickname} fired at A1: hit!`)).toBeVisible();

  // A square takes one shot: J10 is spent, the square beside it is still open.
  await expect(shooter.yourTurn).toBeVisible();
  await expect(square(shooter, "Enemy waters", "J10")).toHaveAccessibleName("J10, miss");
  await expect(square(shooter, "Enemy waters", "J10")).toBeDisabled();
  await expect(square(shooter, "Enemy waters", "J9")).toHaveAccessibleName("J9, fire here");
  await expect(square(shooter, "Enemy waters", "J9")).toBeEnabled();
});

test("sinking every ship wins, and shows the loser where the fleet was", async ({ startMatch }) => {
  // Thirty-three shots between two browsers.
  test.slow();
  const {
    players: [a, b],
  } = await startMatch("battleship");
  await placeFleet(a);
  await placeFleet(b);
  const [shooter, target] = await firingOrder(a, b);

  const fleet = "A1 A2 A3 A4 A5 B1 B2 B3 B4 C1 C2 C3 D1 D2 D3 E1 E2".split(" ");
  // The target answers each shot with one into the empty bottom two rows.
  const misses = Array.from({ length: 16 }, (_, i) => `${i < 10 ? "J" : "I"}${(i % 10) + 1}`);

  for (const [i, name] of fleet.entries()) {
    await fire(shooter, name);
    if (name === "A5") {
      await expect(shooter.page.getByText("You fired at A5 and sank the carrier!")).toBeVisible();
      await expect(
        target.page.getByText(`${shooter.nickname} fired at A5 and sank the carrier!`),
      ).toBeVisible();
      await expect(square(shooter, "Enemy waters", "A1")).toHaveAccessibleName("A1, Carrier, sunk");
      await expect(square(target, "Your waters", "A1")).toHaveAccessibleName("A1, Carrier, sunk");
      await expect(shooter.page.getByText("4 ships afloat")).toBeVisible();
    }
    if (i < misses.length) await fire(target, misses[i]);
  }

  await expect(shooter.page.getByText("You won!")).toBeVisible();
  await expect(shooter.page.getByText("You fired at E2 and sank the destroyer!")).toBeVisible();
  await expect(target.page.getByText(`${shooter.nickname} won.`)).toBeVisible();

  // The loser now sees the ships they never found, and neither board takes another shot.
  await expect(square(target, "Enemy waters", "A1")).toHaveAccessibleName("A1, Carrier");
  await expect(square(target, "Enemy waters", "I7")).toHaveAccessibleName("I7, not fired at");
  for (const player of [shooter, target]) {
    await expect(square(player, "Enemy waters", "F5")).toBeDisabled();
  }
});
