import { Hono } from "hono";

import { api } from "./api";
import { sessionMiddleware, type SessionBindings } from "./auth";
import { DailyDO } from "./daily";
import { MatchDO } from "./match";
import { RECAP_CRON, sendWeeklyRecap } from "./recap";
import { sweepLobbies } from "./sweep";
import { MATCH_CODE_RE, normalizeMatchCode } from "../shared/ids";

export { DailyDO, MatchDO };

const app = new Hono<SessionBindings>();

app.route("/api", api);

// GET /ws/:id: upgrade, forward to the DO. Session-gated the
// same way /api/* is; the DO itself is the one that verifies the caller is
// actually a player in this match (see MatchDO.handleWsUpgrade) once the
// request reaches it, so there is no separate round-trip just to check
// membership before forwarding.
app.use("/ws/*", sessionMiddleware());

app.get("/ws/:id", async (c) => {
  const session = c.get("session");
  if (!session) return c.json({ error: "no_identity" }, 401);

  if ((c.req.header("Upgrade") ?? "").toLowerCase() !== "websocket") {
    return c.json({ error: "expected_websocket" }, 426);
  }

  const code = normalizeMatchCode(c.req.param("id"));
  if (!MATCH_CODE_RE.test(code)) {
    return c.json({ error: "not_found" }, 404);
  }

  const id = c.env.MATCH.idFromName(code);
  const stub = c.env.MATCH.get(id);

  // Forward the original request (preserving Upgrade/Sec-WebSocket-* headers
  // needed for the handshake) with the player's id attached as a header.
  const headers = new Headers(c.req.raw.headers);
  headers.set("X-Player-Id", session.pid);
  const forwarded = new Request(new URL("/ws", "http://do").toString(), {
    method: "GET",
    headers,
  });
  return stub.fetch(forwarded);
});

// Requests that fall through here (anything not matched above, i.e. not
// under /api or /ws) are handled by the Static Assets binding automatically
// — there is no hand-rolled asset fallback in this Worker.
export default {
  fetch: app.fetch,
  // Both crons in wrangler.jsonc land here, told apart by their schedule: the
  // weekly recap's, and the hourly lobby sweep's. At the hour the recap goes
  // out, both fire, each as a run of its own.
  scheduled(controller, env, ctx) {
    if (controller.cron === RECAP_CRON) {
      ctx.waitUntil(sendWeeklyRecap(env, controller.scheduledTime));
    } else {
      ctx.waitUntil(sweepLobbies(env));
    }
  },
} satisfies ExportedHandler<Env>;
