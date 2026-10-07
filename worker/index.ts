import { Hono } from "hono";
import type { Context } from "hono";

import { api } from "./api";
import { sessionMiddleware, type SessionBindings } from "./auth";
import { DailyDO } from "./daily";
import { MatchDO } from "./match";
import { previewFor, withPreview } from "./preview";
import { RECAP_CRON, sendWeeklyRecap } from "./recap";
import { sweepMatches } from "./sweep";
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

// The pages players send each other: a match link and a daily game's link
// (a challenge, when it names a player's run). Each is the SPA's own
// index.html, served through the assets binding exactly as it would be
// without the Worker, with its link-preview tags filled in for that page. The
// preview is read beside the page, not before it, and a preview that fails
// leaves the page as it is.
async function sharedPage(c: Context<SessionBindings>): Promise<Response> {
  const url = new URL(c.req.url);
  // No conditional headers: the page that comes back is rewritten, so a 304
  // for the file underneath would say nothing about it.
  const headers = new Headers(c.req.raw.headers);
  headers.delete("if-none-match");
  headers.delete("if-modified-since");
  const [page, preview] = await Promise.all([
    c.env.ASSETS.fetch(new Request(url, { headers })),
    previewFor(c.env.DB, url, c.req.header("Accept-Language") ?? null),
  ]);
  return withPreview(page, url, preview);
}

app.get("/m/*", sharedPage);
app.get("/daily/*", sharedPage);

// Requests that fall through here (anything not matched above, i.e. not
// under /api, /ws, /m or /daily) are handled by the Static Assets binding
// automatically — there is no hand-rolled asset fallback in this Worker.
export default {
  fetch: app.fetch,
  // Both crons in wrangler.jsonc land here, told apart by their schedule: the
  // weekly recap's, and the hourly match sweep's. At the hour the recap goes
  // out, both fire, each as a run of its own.
  scheduled(controller, env, ctx) {
    if (controller.cron === RECAP_CRON) {
      ctx.waitUntil(sendWeeklyRecap(env, controller.scheduledTime));
    } else {
      ctx.waitUntil(sweepMatches(env));
    }
  },
} satisfies ExportedHandler<Env>;
