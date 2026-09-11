import { Hono } from "hono";

import { MatchDO } from "./match";

export { MatchDO };

const app = new Hono<{ Bindings: Env }>();
const api = new Hono<{ Bindings: Env }>();

api.get("/health", async (c) => {
  let doResult: unknown;
  try {
    const id = c.env.MATCH.idFromName("health");
    const stub = c.env.MATCH.get(id);
    const res = await stub.fetch("http://do/ping");
    doResult = await res.json();
  } catch (err) {
    return c.json(
      { ok: false, subsystem: "do", error: String(err) },
      500
    );
  }

  let matches: number;
  try {
    const row = await c.env.DB.prepare(
      "SELECT count(*) AS n FROM matches"
    ).first<{ n: number }>();
    matches = row?.n ?? 0;
  } catch (err) {
    return c.json(
      { ok: false, subsystem: "d1", error: String(err) },
      500
    );
  }

  return c.json({
    ok: true,
    now: Date.now(),
    do: doResult,
    d1: { matches },
  });
});

api.notFound((c) => c.json({ ok: false, error: "not found" }, 404));

app.route("/api", api);

// Requests that fall through here (anything not matched above, i.e. not
// under /api) are handled by the Static Assets binding automatically —
// there is no hand-rolled asset fallback in this Worker.
export default {
  fetch: app.fetch,
} satisfies ExportedHandler<Env>;
