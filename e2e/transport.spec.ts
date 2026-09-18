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
