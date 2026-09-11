import { DurableObject } from "cloudflare:workers";

// PLAN.md §10 gotchas that apply to every method added to this class:
// - Hibernation API only: use `ctx.acceptWebSocket()` / `webSocketMessage()`
//   handlers, never `ws.addEventListener` — the latter pins the DO in memory
//   and bills idle lobbies for nothing.
// - Never `setInterval`. Use `ctx.storage.setAlarm()`.
// - Hibernation wipes in-memory state; persist to `ctx.storage` on every
//   mutation and rehydrate from it in the constructor.
//
// This plan (01) keeps MatchDO deliberately empty: one table, one route,
// nothing else. Plans 02/04 add players, state and alarms.
export class MatchDO extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)"
    );
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/ping") {
      const row = this.ctx.storage.sql
        .exec("SELECT count(*) AS n FROM sqlite_master")
        .one() as { n: number };
      return Response.json({
        ok: true,
        id: this.ctx.id.toString(),
        tables: row.n,
      });
    }
    return Response.json({ ok: false, error: "not found" }, { status: 404 });
  }
}
