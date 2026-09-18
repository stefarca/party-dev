import { test as base, expect } from "@playwright/test";
import type { BrowserContext, Locator, Page } from "@playwright/test";

// The harness every spec imports `test` and `expect` from. Specs drive the app the way players
// do, through the rendered UI and its accessible names, and never import app code: a spec
// breaking means a player would notice.

// One player is one browser context, with a session cookie of its own: the same isolation two
// coworkers on two laptops have. `context.request` shares that cookie, so API calls made
// through it act as this player.
export class Player {
  constructor(
    readonly id: string,
    readonly nickname: string,
    readonly context: BrowserContext,
    readonly page: Page,
  ) {}

  // The match page's turn banner, which sits above every game's board.
  get yourTurn(): Locator {
    return this.page.getByText("Your turn", { exact: true });
  }

  waitingOn(other: Player): Locator {
    return this.page.getByText(`Waiting on ${other.nickname}`, { exact: true });
  }

  // The match header's connection badge once the WebSocket is up. Without it, nothing the
  // other players do shows up on this page until it reloads.
  get live(): Locator {
    return this.page.getByRole("status", { name: "Live", exact: true });
  }
}

export interface Match {
  code: string;
  // The players the game waits on first come first, then the rest in join order. In a
  // sequential game, `players[0]` makes the opening move.
  players: Player[];
}

// Opens a `gameId` lobby hosted by `host`, over the HTTP API, and returns its code.
export async function createMatch(host: Player, gameId: string): Promise<string> {
  const res = await host.context.request.post("/api/matches", { data: { gameId } });
  await expect(res, `${host.nickname} creates a ${gameId} match`).toBeOK();
  return ((await res.json()) as { code: string }).code;
}

export async function joinMatch(guest: Player, code: string): Promise<void> {
  const res = await guest.context.request.post(`/api/matches/${code}/join`, { data: {} });
  await expect(res, `${guest.nickname} joins ${code}`).toBeOK();
}

interface Fixtures {
  // Signs in a new player in a fresh browser context and leaves its page blank.
  newPlayer: (nickname: string) => Promise<Player>;
  // Signs in one player per nickname. The first creates a `gameId` match, the rest join it in
  // order, and the first starts it. Then it opens the match for everyone and waits until each
  // page is live. Setup goes through the HTTP API, so a game's spec starts at its first move.
  // e2e/lobby.spec.ts covers the same steps through the UI.
  startMatch: (gameId: string, nicknames?: string[]) => Promise<Match>;
}

export const test = base.extend<Fixtures>({
  newPlayer: async ({ browser }, use) => {
    const contexts: BrowserContext[] = [];
    await use(async (nickname) => {
      // Picks up `use` from playwright.config.ts (baseURL, device, tracing) like `page` does.
      const context = await browser.newContext();
      contexts.push(context);
      const res = await context.request.post("/api/identity", { data: { nickname } });
      await expect(res, `sign in as ${nickname}`).toBeOK();
      const me = (await res.json()) as { playerId: string; nickname: string };
      return new Player(me.playerId, me.nickname, context, await context.newPage());
    });
    await Promise.all(contexts.map((context) => context.close()));
  },

  startMatch: async ({ newPlayer }, use) => {
    await use((gameId, nicknames = ["Alice", "Bob"]) =>
      test.step(
        `start a ${gameId} match for ${nicknames.join(", ")}`,
        async () => {
          const players = await Promise.all(nicknames.map((nickname) => newPlayer(nickname)));
          const [host, ...guests] = players;

          const code = await createMatch(host, gameId);
          // One at a time, because some games seat players in join order.
          for (const guest of guests) await joinMatch(guest, code);

          const started = await host.context.request.post(`/api/matches/${code}/start`, {
            data: {},
          });
          await expect(started, `${host.nickname} starts ${code}`).toBeOK();
          const { waitingOn } = (await started.json()) as { waitingOn: string[] };

          await Promise.all(
            players.map(async (player) => {
              await player.page.goto(`/m/${code}`);
              await expect(player.live).toBeVisible();
            }),
          );

          const first = players.filter((p) => waitingOn.includes(p.id));
          const rest = players.filter((p) => !waitingOn.includes(p.id));
          return { code, players: [...first, ...rest] };
        },
        { box: true },
      ),
    );
  },
});

export { expect };
