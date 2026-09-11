import { Hono } from "hono";

import { api } from "./api";
import { MatchDO } from "./match";

export { MatchDO };

const app = new Hono<{ Bindings: Env }>();

app.route("/api", api);

// Requests that fall through here (anything not matched above, i.e. not
// under /api) are handled by the Static Assets binding automatically —
// there is no hand-rolled asset fallback in this Worker.
export default {
  fetch: app.fetch,
} satisfies ExportedHandler<Env>;
