import { getDailyMeta, getGameMeta } from "../games/catalog";
import { gameName } from "../games/names";
import { dayOf, isDay } from "../shared/daily";
import { MATCH_CODE_RE, normalizeMatchCode } from "../shared/ids";
import { UNKNOWN_NICKNAME } from "../shared/nickname";
import { scoreText } from "../shared/score";
import { dailyStanding } from "./chart";

// What a shared link says about itself before anyone opens it. A chat app
// (WhatsApp, Telegram, iMessage, Slack) fetches the page behind a link and
// reads its Open Graph tags, and never runs its JavaScript, so the SPA's own
// words cannot reach that preview. The Worker therefore serves the pages a
// player shares — `/m/:code` and `/daily/:gameId` — itself: the same
// `index.html` the assets would, with its title and description rewritten to
// say which game, whose lobby, or whose score.
//
// Everything is read from D1's derived index, which is fine for a preview: it
// only has to be about right, and it is never a match's truth. A preview that
// cannot be worked out, for whatever reason, leaves the page's own generic
// tags in place; it never stands between a player and the page.

export interface Preview {
  title: string;
  description: string;
}

type Plural = { one: string; many: string };

// Preview wording. Like a push notification, it is composed here in the
// Worker and so cannot go through i18next. Exported for
// worker/preview.test.ts, which fails when a language exists in web/locales/
// and not here.
export const PREVIEW_COPY: Record<
  string,
  {
    lobby: { title: string; titleNoHost: string; seats: Plural; full: string };
    match: { title: string; active: string; done: string };
    daily: { title: string; body: string };
    challenge: { title: string; open: string; ranked: string; body: string };
  }
> = {
  en: {
    lobby: {
      title: "{{host}} invited you to play {{game}}",
      titleNoHost: "You're invited to play {{game}}",
      seats: {
        one: "1 seat left. Tap to join before it fills up.",
        many: "{{count}} seats left. Tap to join before they fill up.",
      },
      full: "The lobby is full, and the match is about to start.",
    },
    match: {
      title: "{{game}} on Pimpom",
      active: "{{names}} are playing.",
      done: "{{names}} played this one.",
    },
    daily: {
      title: "Today's {{game}} on Pimpom",
      body: "The same board for everyone, one run each. How far can you get?",
    },
    challenge: {
      title: "{{name}} scored {{score}} at {{game}}. Can you beat it?",
      open: "{{name}} challenges you to {{game}}",
      ranked: "#{{rank}} of {{count}} on the chart for {{day}}.",
      body: "The same board for everyone, one run each. Your turn.",
    },
  },
  it: {
    lobby: {
      title: "{{host}} ti invita a giocare a {{game}}",
      titleNoHost: "Sei invitato a giocare a {{game}}",
      seats: {
        one: "Resta 1 posto. Tocca per entrare prima che si riempia.",
        many: "Restano {{count}} posti. Tocca per entrare prima che si riempiano.",
      },
      full: "La lobby è piena e la partita sta per iniziare.",
    },
    match: {
      title: "{{game}} su Pimpom",
      active: "{{names}} stanno giocando.",
      done: "{{names}} hanno giocato questa partita.",
    },
    daily: {
      title: "{{game}} di oggi su Pimpom",
      body: "La stessa sfida per tutti, una partita a testa. Fin dove arrivi?",
    },
    challenge: {
      title: "{{name}} ha fatto {{score}} a {{game}}. Riesci a batterlo?",
      open: "{{name}} ti sfida a {{game}}",
      ranked: "{{rank}}º su {{count}} nella classifica di {{day}}.",
      body: "La stessa sfida per tutti, una partita a testa. Tocca a te.",
    },
  },
};

function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(values[key] ?? ""));
}

// Which language to write a preview in. A link the app builds carries its
// sharer's language as `lang`, since the friends they send it to most likely
// read the same one and a link preview crawler rarely says what it reads.
// Failing that, the crawler's own Accept-Language, and then English.
export function previewLanguage(lang: string | null, acceptLanguage: string | null): string {
  if (lang && lang in PREVIEW_COPY) return lang;
  const wanted = (acceptLanguage ?? "")
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      return { tag: tag.toLowerCase().split("-")[0], q: q ? Number(q.slice(2)) : 1 };
    })
    .filter((entry) => entry.tag && entry.q > 0)
    .sort((a, b) => b.q - a.q);
  return wanted.find((entry) => entry.tag in PREVIEW_COPY)?.tag ?? "en";
}

function listOf(lang: string, names: string[]): string {
  return new Intl.ListFormat(lang, { type: "conjunction" }).format(names);
}

// A match link: whose lobby, what game, and how many seats are left; or, once
// the match is under way, who is in it.
export async function matchPreview(
  db: D1Database,
  rawCode: string,
  lang: string,
): Promise<Preview | null> {
  const code = normalizeMatchCode(rawCode);
  if (!MATCH_CODE_RE.test(code)) return null;
  const match = await db
    .prepare("SELECT game_id, status, host_id FROM matches WHERE id = ?")
    .bind(code)
    .first<{ game_id: string | null; status: string | null; host_id: string | null }>();
  const meta = match?.game_id ? getGameMeta(match.game_id) : undefined;
  if (!match || !meta) return null;

  const { results: players } = await db
    .prepare(
      `SELECT mp.player_id AS id, p.nickname AS nickname
       FROM match_players mp LEFT JOIN players p ON p.id = mp.player_id
       WHERE mp.match_id = ?`,
    )
    .bind(code)
    .all<{ id: string; nickname: string | null }>();
  const host = players.find((p) => p.id === match.host_id);
  const names = [...(host ? [host] : []), ...players.filter((p) => p !== host)].map(
    (p) => p.nickname ?? UNKNOWN_NICKNAME,
  );

  const copy = PREVIEW_COPY[lang];
  const game = gameName(meta.id, lang);
  if (match.status === "lobby") {
    const left = meta.maxPlayers - players.length;
    return {
      title: host?.nickname
        ? fill(copy.lobby.title, { host: host.nickname, game })
        : fill(copy.lobby.titleNoHost, { game }),
      description:
        left <= 0
          ? copy.lobby.full
          : fill(left === 1 ? copy.lobby.seats.one : copy.lobby.seats.many, { count: left }),
    };
  }
  return {
    title: fill(copy.match.title, { game }),
    description:
      names.length === 0
        ? ""
        : fill(match.status === "done" ? copy.match.done : copy.match.active, {
            names: listOf(lang, names),
          }),
  };
}

// A daily game's link. With `from` and `day` it is a challenge: that player's
// score on that day, ranked as the chart ranks it. Without them, or when they
// point at no finished run, it is an invitation to today's board.
export async function dailyPreview(
  db: D1Database,
  gameId: string,
  challenge: { from: string | null; day: string | null },
  lang: string,
  now: number = Date.now(),
): Promise<Preview | null> {
  const meta = getDailyMeta(gameId);
  if (!meta) return null;
  const copy = PREVIEW_COPY[lang];
  const game = gameName(meta.id, lang);
  const invitation: Preview = {
    title: fill(copy.daily.title, { game }),
    description: copy.daily.body,
  };

  const { from, day } = challenge;
  if (!from || !day || !isDay(day) || day > dayOf(now)) return invitation;
  const standing = await dailyStanding(db, meta, day, from);
  const run = standing.run;
  if (!run || run.nickname === UNKNOWN_NICKNAME) return invitation;
  if (run.status !== "done" || run.score === null) {
    return {
      title: fill(copy.challenge.open, { name: run.nickname, game }),
      description: copy.daily.body,
    };
  }

  const dayText = new Intl.DateTimeFormat(lang, {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(Date.parse(`${day}T00:00:00Z`));
  const ranked =
    run.rank !== null
      ? fill(copy.challenge.ranked, { rank: run.rank, count: standing.finished, day: dayText }) +
        " "
      : "";
  return {
    title: fill(copy.challenge.title, {
      name: run.nickname,
      score: scoreText(lang, run.score, meta.format),
      game,
    }),
    description: ranked + copy.challenge.body,
  };
}

// The preview for whatever page `url` is, or null for one that has none of
// its own. Never throws: a failed read only costs the preview.
export async function previewFor(
  db: D1Database,
  url: URL,
  acceptLanguage: string | null,
): Promise<Preview | null> {
  const lang = previewLanguage(url.searchParams.get("lang"), acceptLanguage);
  try {
    const match = url.pathname.match(/^\/m\/([^/]+)\/?$/);
    if (match) return await matchPreview(db, decodeURIComponent(match[1]), lang);
    const daily = url.pathname.match(/^\/daily\/([^/]+)\/?$/);
    if (daily) {
      return await dailyPreview(
        db,
        decodeURIComponent(daily[1]),
        {
          from: url.searchParams.get("from"),
          day: url.searchParams.get("day"),
        },
        lang,
      );
    }
  } catch (err) {
    console.error("link preview failed", err);
  }
  return null;
}

// Where the preview image lives. A crawler needs it absolute, and the page's
// own origin is the one that is certainly right.
export const PREVIEW_IMAGE_PATH = "/og-image.png";

// `page` (the SPA's index.html, as the assets served it) with `preview`
// written into its title and Open Graph tags, and the preview image made
// absolute. The tags themselves are in index.html; this only fills them, so
// a page served without the Worker still has sensible generic ones. Values go
// in through setAttribute/setInnerContent, which escape them: a nickname is
// never HTML here.
export function withPreview(page: Response, url: URL, preview: Preview | null): Response {
  if (!page.ok || !(page.headers.get("content-type") ?? "").includes("text/html")) return page;
  const image = new URL(PREVIEW_IMAGE_PATH, url.origin).toString();
  const content = (value: string) => ({
    element(el: Element) {
      el.setAttribute("content", value);
    },
  });
  let rewriter = new HTMLRewriter()
    .on('meta[property="og:image"]', content(image))
    .on('meta[property="og:url"]', content(url.toString()));
  if (preview) {
    rewriter = rewriter
      .on("title", {
        element(el) {
          el.setInnerContent(preview.title);
        },
      })
      .on('meta[property="og:title"]', content(preview.title))
      .on('meta[name="description"]', content(preview.description))
      .on('meta[property="og:description"]', content(preview.description));
  }
  const rewritten = rewriter.transform(page);
  // The asset's validators describe the file, not this page of it.
  const headers = new Headers(rewritten.headers);
  headers.delete("etag");
  headers.delete("content-length");
  return new Response(rewritten.body, { status: rewritten.status, headers });
}
