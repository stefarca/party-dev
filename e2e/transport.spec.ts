import { expect, test } from "./fixtures";
import type { Player } from "./fixtures";

// The WebSocket is only an optimization: a player whose socket never connects can still load
// the match and play over HTTP. Tic-tac-toe is just the simplest game to drive.

function square(player: Player, row: number, col: number) {
  return player.page.getByRole("button", { name: new RegExp(`^Row ${row}, column ${col},`) });
}

// Runs in the page, before the app. It stands in for a network that refuses WebSockets (a proxy
// that strips the Upgrade header, say): every socket fails without ever opening. Playwright's
// `routeWebSocket` cannot do this, because a routed socket always opens on the page's side.
function refuseWebSockets() {
  class RefusedWebSocket extends EventTarget {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;
    readyState = RefusedWebSocket.CONNECTING;

    constructor() {
      super();
      setTimeout(() => {
        this.readyState = RefusedWebSocket.CLOSED;
        this.dispatchEvent(new Event("error"));
        this.dispatchEvent(new CloseEvent("close", { code: 1006 }));
      });
    }

    send() {
      throw new DOMException("WebSocket is not open", "InvalidStateError");
    }

    close() {}
  }
  window.WebSocket = RefusedWebSocket as unknown as typeof WebSocket;
}

test("a player whose WebSocket never connects still plays over HTTP", async ({ startMatch }) => {
  const {
    players: [x, o],
  } = await startMatch("tictactoe");

  await x.page.addInitScript(refuseWebSockets);
  await x.page.reload();
  await expect(x.page.getByRole("status", { name: "Reconnecting…" })).toBeVisible();
  await expect(x.yourTurn).toBeVisible();

  await square(x, 2, 2).click();
  // x sees its own move from the HTTP response, and o gets it pushed over o's socket.
  await expect(square(x, 2, 2)).toHaveAccessibleName("Row 2, column 2, X, last move");
  await expect(square(o, 2, 2)).toHaveAccessibleName("Row 2, column 2, X, last move");

  await square(o, 1, 1).click();
  await expect(o.yourTurn).toBeHidden();
  // Nothing pushes o's move to x without a socket. Loading the page again catches it up.
  await x.page.reload();
  await expect(square(x, 1, 1)).toHaveAccessibleName("Row 1, column 1, O, last move");
  await expect(x.yourTurn).toBeVisible();
});

// Stands in for the player switching tabs, minimising the window or putting their phone away:
// the page reports itself hidden (or shown again) the way a browser does. Headless pages are
// always visible, so this is the only way a spec can look away.
async function setHidden(player: Player, hidden: boolean) {
  await player.page.evaluate((hidden) => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => (hidden ? "hidden" : "visible"),
    });
    Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);
}

// A page nobody is looking at holds no socket. That is how the server knows its player has looked
// away and should be nudged about their turn, rather than taking an open socket as someone
// watching the board.
test("a hidden page lets go of its socket, and catches up once it is shown again", async ({
  startMatch,
}) => {
  const {
    players: [x, o],
  } = await startMatch("tictactoe");

  await square(x, 2, 2).click();
  await expect(square(o, 2, 2)).toHaveAccessibleName("Row 2, column 2, X, last move");

  await setHidden(x, true);
  await expect(x.page.getByRole("status", { name: "Reconnecting…" })).toBeVisible();

  await square(o, 1, 1).click();
  await expect(square(o, 1, 1)).toHaveAccessibleName("Row 1, column 1, O, last move");
  // With a socket, the move would reach x at the same moment it reached o.
  await expect(square(x, 1, 1)).toHaveAccessibleName("Row 1, column 1, empty");

  await setHidden(x, false);
  await expect(x.live).toBeVisible();
  await expect(square(x, 1, 1)).toHaveAccessibleName("Row 1, column 1, O, last move");
  await expect(x.yourTurn).toBeVisible();
});
