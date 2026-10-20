import { expect, test } from "../../e2e/fixtures";
import type { Player } from "../../e2e/fixtures";

// Mini golf, played in a browser. Today's round comes from a seed the test
// cannot know, so these specs never expect a particular hole: they read each
// hole from the name a screen reader reads, and only ever play shots too soft
// to reach water, a tunnel or the cup from any tee. Every shot strays a hair
// from its aim, differently for every run, so they never expect two runs'
// shots to land in the same place either. Every player here prefers reduced
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
  return player.page.getByRole("definition").filter({ hasText: new RegExp(`^${name}`) });
}

// The round's par, from the scorecard's Par row, whose last cell is its total.
async function roundPar(player: Player): Promise<number> {
  const row = await player.page.getByRole("row", { name: /^Par/ }).innerText();
  return Number(row.trim().split(/\s+/).at(-1));
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
  await expect(bob.page.getByRole("row", { name: /^Par/ })).toHaveText(
    (await ada.page.getByRole("row", { name: /^Par/ }).textContent())!,
  );
  // Both start aimed at the cup.
  await expect(aim(bob)).toHaveValue((await aim(ada).inputValue()) as string);

  // The same shot from the same tee goes about the same way.
  await putt(ada, 25, 1);
  await putt(bob, 25, 1);
  await expect(course(ada)).not.toHaveAttribute("aria-label", tee!);
  await expect(course(bob)).not.toHaveAttribute("aria-label", tee!);
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
  await expect(aim(ada)).toHaveAttribute("aria-valuetext", "0°");
  await page.mouse.up();
  await expect(stat(ada, "Strokes")).toHaveText(/Strokes\s*1$/);
  await expect(course(ada)).not.toHaveAttribute("aria-label", tee!);

  // The aim slider is centred on the cup, whichever way it lies, and finer
  // there: its middle half turns the aim less than 90° either way, and its
  // ends point straight away from the cup.
  const cup = Number(/at (\d+)°/.exec((await course(ada).getAttribute("aria-label"))!)![1]);
  const compass = (bearing: number) => `${(bearing + 360) % 360}°`;
  await expect(aim(ada)).toHaveValue("0");
  await expect(aim(ada)).toHaveAttribute("aria-valuetext", compass(cup));
  await aim(ada).fill("90");
  await expect(aim(ada)).toHaveAttribute("aria-valuetext", compass(cup + 68));
  await aim(ada).fill("-180");
  await expect(aim(ada)).toHaveAttribute("aria-valuetext", compass(cup - 180));

  // The sliders play the same shot a drag would.
  await aim(ada).fill("0");
  await power(ada).fill("12");
  await expect(power(ada)).toHaveAttribute("aria-valuetext", "12%");
  await shoot(ada).click();
  await expect(stat(ada, "Strokes")).toHaveText(/Strokes\s*2$/);
  await expect(
    page.getByRole("status").filter({ hasText: /^Stroke 2: the ball stopped/ }),
  ).toHaveCount(1);

  // The buttons beside each slider move it one step, from the cup the ball
  // that has come to rest is aimed at again.
  const next = Number(/at (\d+)°/.exec((await course(ada).getAttribute("aria-label"))!)![1]);
  await page.getByRole("button", { name: "Harder" }).click();
  await expect(power(ada)).toHaveAttribute("aria-valuetext", "13%");
  await page.getByRole("button", { name: "Softer" }).click();
  await page.getByRole("button", { name: "Softer" }).click();
  await expect(power(ada)).toHaveAttribute("aria-valuetext", "11%");
  await page.getByRole("button", { name: "Turn the aim clockwise" }).click();
  await expect(aim(ada)).toHaveAttribute("aria-valuetext", compass(next + 1));
  await page.getByRole("button", { name: "Turn the aim anticlockwise" }).click();
  await page.getByRole("button", { name: "Turn the aim anticlockwise" }).click();
  await expect(aim(ada)).toHaveAttribute("aria-valuetext", compass(next - 1));
});

test("three over par picks the ball up, and six holes end the round", async ({ newPlayer }) => {
  test.slow();
  const ada = await newPlayer("Ada", STILL);
  await startRun(ada);
  const { page } = ada;
  const par = await roundPar(ada);

  for (let hole = 1; hole <= 6; hole++) {
    await expect(stat(ada, "Hole")).toHaveText(new RegExp(`Hole\\s*${hole}/6$`));
    const holePar = Number((await stat(ada, "Par").innerText()).replace(/\D/g, ""));
    // The softest putt the slider has: a few of them never reach anything.
    for (let stroke = 1; stroke <= holePar + 3; stroke++) await putt(ada, 1, stroke);
    await expect(
      page
        .getByText(`Picked up after ${holePar + 3} strokes: this hole scores ${holePar + 4}.`)
        .first(),
    ).toBeVisible();
    await expect(shoot(ada)).toBeDisabled();
    if (hole < 6) {
      // Next floats over the course, and takes the keyboard without moving
      // the page away from it.
      const next = page.getByRole("button", { name: "Next hole" });
      await expect(next).toBeFocused();
      const field = (await course(ada).boundingBox())!;
      const button = (await next.boundingBox())!;
      expect(button.y).toBeGreaterThanOrEqual(field.y);
      expect(button.y + button.height).toBeLessThanOrEqual(field.y + field.height);
      await next.scrollIntoViewIfNeeded();
      const scrolled = await page.evaluate(() => window.scrollY);
      await next.click();
      // Moving on hands the keyboard straight back to the next shot.
      await expect(shoot(ada)).toBeFocused();
      expect(await page.evaluate(() => window.scrollY)).toBe(scrolled);
    }
  }

  await expect(page.getByRole("heading", { name: "Today's run is over" })).toBeVisible();
  await expect(page.getByText(`You scored ${par + 24}.`)).toBeVisible();
  await expect(page.getByRole("row", { name: /^Score/ })).toHaveText(new RegExp(`${par + 24}$`));
  await expect(page.getByRole("button", { name: "Next hole" })).toHaveCount(0);
  await expect(shoot(ada)).toBeDisabled();
});

test("a run that is over takes no more shots", async ({ newPlayer }) => {
  const ada = await newPlayer("Ada", STILL);
  await startRun(ada);
  await ada.page.getByRole("button", { name: "End run" }).click();
  await ada.page.getByRole("alertdialog").getByRole("button", { name: "End run" }).click();
  await expect(ada.page.getByText("This run is over.")).toBeVisible();

  // Every hole it never played counts four over its par.
  const par = await roundPar(ada);
  await expect(ada.page.getByText(`You scored ${par + 24}.`)).toBeVisible();
  await expect(shoot(ada)).toBeDisabled();
  await expect(aim(ada)).toBeDisabled();
  await expect(power(ada)).toBeDisabled();
  await expect(stat(ada, "Strokes")).toHaveText(/Strokes\s*0$/);
});
