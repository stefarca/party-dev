import { expect, test } from "../../e2e/fixtures";
import type { Player } from "../../e2e/fixtures";

// Mini golf, played in a browser. Today's round comes from a seed the test
// cannot know, so these specs never expect a particular hole: they read each
// hole from the name a screen reader reads, and only ever play shots too soft
// to reach water or the cup from any tee. Every player here prefers reduced
// motion, so a shot lands the moment its reply does instead of once the ball
// has rolled. e2e/daily.spec.ts covers starting, ending and the chart.

const STILL = { reducedMotion: "reduce" } as const;

async function startRun(player: Player) {
  await player.page.goto("/daily/minigolf");
  await player.page.getByRole("button", { name: "Start today's run" }).click();
  await expect(shoot(player)).toBeEnabled();
}

function course(player: Player) {
  return player.page.getByRole("img", { name: /^Hole \d of 6, par \d\./ });
}

function shoot(player: Player) {
  return player.page.getByRole("button", { name: "Shoot" });
}

function aim(player: Player) {
  return player.page.getByRole("slider", { name: "Aim" });
}

function power(player: Player) {
  return player.page.getByRole("slider", { name: "Power" });
}

function stat(player: Player, name: string) {
  return player.page.getByRole("definition").filter({ hasText: name });
}

// Plays a shot at `percent` power, aimed wherever the sliders say, and waits
// for it to count as the hole's `strokes`th.
async function putt(player: Player, percent: number, strokes: number) {
  await power(player).fill(String(percent));
  await shoot(player).click();
  await expect(stat(player, "Strokes")).toHaveText(new RegExp(`Strokes\\s*${strokes}$`));
}

test("everyone plays the same round today", async ({ newPlayer }) => {
  const [ada, bob] = await Promise.all([newPlayer("Ada", STILL), newPlayer("Bob", STILL)]);
  await startRun(ada);
  await startRun(bob);

  const tee = await course(ada).getAttribute("aria-label");
  expect(tee).toMatch(/^Hole 1 of 6, par \d\. The cup is [\d.]+ m away, at \d+°\./);
  await expect(course(bob)).toHaveAttribute("aria-label", tee!);
  // Both start aimed at the cup.
  await expect(aim(bob)).toHaveValue((await aim(ada).inputValue()) as string);

  // The same shot from the same tee stops in the same place.
  await putt(ada, 25, 1);
  await putt(bob, 25, 1);
  const lie = await course(ada).getAttribute("aria-label");
  expect(lie).not.toBe(tee);
  await expect(course(bob)).toHaveAttribute("aria-label", lie!);
});

test("a shot is pulled back on the course, or set on the sliders", async ({ newPlayer }) => {
  const ada = await newPlayer("Ada", STILL);
  await startRun(ada);
  const { page } = ada;
  await expect(page.getByText(/^Drag back from anywhere on the course/)).toBeVisible();
  await expect(stat(ada, "Hole")).toHaveText(/Hole\s*1\/6$/);
  await expect(stat(ada, "Strokes")).toHaveText(/Strokes\s*0$/);

  // Pulling straight down aims straight up, as hard as it was pulled.
  const tee = await course(ada).getAttribute("aria-label");
  await course(ada).scrollIntoViewIfNeeded();
  const box = (await course(ada).boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + box.height / 12, { steps: 5 });
  await expect(aim(ada)).toHaveValue("0");
  await expect(aim(ada)).toHaveAttribute("aria-valuetext", "0°");
  await page.mouse.up();
  await expect(stat(ada, "Strokes")).toHaveText(/Strokes\s*1$/);
  await expect(course(ada)).not.toHaveAttribute("aria-label", tee!);

  // The sliders play the same shot a drag would.
  await aim(ada).fill("90");
  await expect(aim(ada)).toHaveAttribute("aria-valuetext", "90°");
  await power(ada).fill("12");
  await expect(power(ada)).toHaveAttribute("aria-valuetext", "12%");
  await shoot(ada).click();
  await expect(stat(ada, "Strokes")).toHaveText(/Strokes\s*2$/);
  await expect(
    page.getByRole("status").filter({ hasText: /^Stroke 2: the ball stopped/ }),
  ).toHaveCount(1);
});

test("five strokes pick the ball up, and six holes end the round", async ({ newPlayer }) => {
  test.slow();
  const ada = await newPlayer("Ada", STILL);
  await startRun(ada);
  const { page } = ada;

  for (let hole = 1; hole <= 6; hole++) {
    await expect(stat(ada, "Hole")).toHaveText(new RegExp(`Hole\\s*${hole}/6$`));
    for (let stroke = 1; stroke <= 5; stroke++) await putt(ada, 5, stroke);
    await expect(
      page.getByText("Picked up after 5 strokes: this hole scores 6.").first(),
    ).toBeVisible();
    await expect(shoot(ada)).toBeDisabled();
    if (hole < 6) {
      await page.getByRole("button", { name: "Next hole" }).click();
      // Moving on hands the keyboard straight back to the next shot.
      await expect(shoot(ada)).toBeFocused();
    }
  }

  await expect(page.getByRole("heading", { name: "Today's run is over" })).toBeVisible();
  await expect(page.getByText("You scored 36.")).toBeVisible();
  await expect(page.getByRole("row", { name: /^Score/ })).toHaveText(/6\s*6\s*6\s*6\s*6\s*6\s*36/);
  await expect(page.getByRole("button", { name: "Next hole" })).toHaveCount(0);
  await expect(shoot(ada)).toBeDisabled();
});

test("a run that is over takes no more shots", async ({ newPlayer }) => {
  const ada = await newPlayer("Ada", STILL);
  await startRun(ada);
  await ada.page.getByRole("button", { name: "End run" }).click();
  await ada.page.getByRole("alertdialog").getByRole("button", { name: "End run" }).click();
  await expect(ada.page.getByText("This run is over.")).toBeVisible();

  // Every hole it never played counts six.
  await expect(ada.page.getByText("You scored 36.")).toBeVisible();
  await expect(shoot(ada)).toBeDisabled();
  await expect(aim(ada)).toBeDisabled();
  await expect(power(ada)).toBeDisabled();
  await expect(stat(ada, "Strokes")).toHaveText(/Strokes\s*0$/);
});
