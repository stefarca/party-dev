import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { DailyUiProps } from "../../shared/protocol";
import type { Focusable } from "../common/keyboard";
import { Loading } from "../common/Loading";
import { Stats } from "../common/Stats";
import { StatusLine } from "../common/StatusLine";
import { Field } from "./components/Field";
import { HazardLegend } from "./components/HazardLegend";
import { Outcome } from "./components/Outcome";
import { Scorecard } from "./components/Scorecard";
import { ShotControls } from "./components/ShotControls";
import { HOLE_CAP, MAX_STROKES } from "./game";
import type { LastShot, MinigolfView, Point } from "./game";
import { bearing, distance } from "./geometry";
import type strings from "./locales/en.json";
import { termOf } from "./scoring";
import { usePlayback } from "./usePlayback";

declare module "i18next" {
  interface ResourceNamespaceMap {
    minigolf: typeof strings;
  }
}

// The mini golf course: one hole at a time, drawn to scale, with the aim and
// power of the next shot set by dragging back from the ball like a
// slingshot, or on the two sliders below it. A shot goes to the server,
// which alone rolls the ball, and comes back as the path the ball took; the
// page plays that path back, then shows where the ball came to rest. A hole
// the shot finished stays on screen, with what it scored, until its player
// moves on to the next one.
//
// The course is a picture, and its accessible name says what matters about
// it: the hole, its par, its hazards, and how far away the cup is and which
// way. The aim is a compass bearing, so a player who cannot see the course
// can still aim at the cup.
//
// Some of the picture moves on its own: ripples drift across a pond,
// chevrons slide down a slope, the flag stirs and the ball waiting to be hit
// breathes a ring. None of it is needed to play, so none of it runs for a
// player who prefers reduced motion.

export default function MinigolfUi({ view, status, send }: DailyUiProps) {
  const { t, i18n } = useTranslation("minigolf");
  const language = i18n.resolvedLanguage ?? "en";
  const v = view as MinigolfView | null;
  const ids = `golf${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const { flying, finished, landed, moveOn } = usePlayback(v);

  // The view a shot was sent from. Until a new one arrives, the shot is on
  // its way, and there is no ball to hit.
  const [sentFrom, setSentFrom] = useState<unknown>(null);
  const [angle, setAngle] = useState(0);
  const [power, setPower] = useState(0.5);
  const [aimedAt, setAimedAt] = useState<string | null>(null);
  // Held as `unknown` and narrowed where it is focused: the Worker's
  // type-check of this file has an element type with no `focus()`.
  const shootButton = useRef<unknown>(null);

  if (!v) return <Loading label={t("loading")} />;

  // The hole on screen is the one the last shot was played on while it
  // rolls, while it waits to be moved on from, and once the round is done.
  const holding = flying ?? finished ?? (v.over ? v.last : null);
  const holeIndex = holding ? holding.hole : v.hole;
  const hole = v.course[holeIndex];
  const strokes = holding ? holding.strokes : v.strokes;
  const lastEnd: Point | null = holding
    ? [holding.path[holding.path.length - 2], holding.path[holding.path.length - 1]]
    : null;
  // The ball as it lies: gone once it drops or is picked up.
  const ball: Point | null = holding ? (holding.outcome === "rest" ? lastEnd : null) : v.ball;
  // Where the course's name measures from: where the ball lies, or where a
  // splash sent it back to.
  const described: Point | null = holding
    ? holding.outcome === "holed"
      ? null
      : holding.outcome === "water"
        ? holding.from
        : lastEnd
    : v.ball;

  const playing = status === "active" && !v.over;
  const canShoot = playing && !flying && !finished && sentFrom !== view && ball !== null;

  // Every new ball position starts aimed at the cup.
  const aimKey = `${holeIndex}:${v.ball[0]}:${v.ball[1]}`;
  if (canShoot && aimedAt !== aimKey) {
    setAimedAt(aimKey);
    setAngle(bearing(v.ball, hole.cup));
  }

  const shoot = (shotAngle: number, shotPower: number) => {
    if (!canShoot) return;
    setSentFrom(view);
    send({ t: "shot", n: v.shots, angle: shotAngle, power: shotPower });
  };

  const number = new Intl.NumberFormat(language);
  const metres = new Intl.NumberFormat(language, {
    style: "unit",
    unit: "meter",
    maximumFractionDigits: 1,
  });
  const degrees = new Intl.NumberFormat(language, {
    style: "unit",
    unit: "degree",
    unitDisplay: "narrow",
  });
  // Course units are ten centimetres.
  const away = (from: Point) => metres.format(distance(from, hole.cup) / 10);

  const played = v.cards.reduce((sum, card) => sum + card, 0);
  const parPlayed = v.course.slice(0, v.cards.length).reduce((sum, { par }) => sum + par, 0);
  const toPar = played - parPlayed;
  const toParText =
    v.cards.length === 0 || toPar === 0
      ? t("even")
      : toPar > 0
        ? `+${number.format(toPar)}`
        : `−${number.format(-toPar)}`;

  const hazards = [
    hole.water.length > 0 && t("hazard.water"),
    hole.sand.length > 0 && t("hazard.sand"),
    hole.slopes.length > 0 && t("hazard.slope"),
    hole.blocks.length > 0 && t("hazard.blocks"),
  ].filter((hazard): hazard is string => typeof hazard === "string");
  const where = {
    hole: holeIndex + 1,
    holes: v.course.length,
    par: hole.par,
  };
  const fieldName = [
    described
      ? t("field", {
          ...where,
          distance: away(described),
          bearing: degrees.format(bearing(described, hole.cup)),
        })
      : t("fieldHoled", where),
    hazards.length > 0
      ? t("hazards", {
          list: new Intl.ListFormat(language, { type: "conjunction" }).format(hazards),
        })
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  // What a shot that has landed did, for the banner and for a screen reader.
  const outcomeText = (shot: LastShot): string => {
    if (shot.outcome === "holed") {
      return shot.strokes === 1
        ? t("cup.ace")
        : t("cup.holed", {
            strokes: shot.strokes,
            term: t(`term.${termOf(shot.strokes, v.course[shot.hole].par)}`),
          });
    }
    if (shot.card !== null) return t("cup.pickedUp", { max: MAX_STROKES, cap: HOLE_CAP });
    if (shot.outcome === "water") return t("cup.splash");
    const end: Point = [shot.path[shot.path.length - 2], shot.path[shot.path.length - 1]];
    return t("cup.rest", { strokes: shot.strokes, distance: away(end) });
  };
  const settled = v.last !== null && !flying ? v.last : null;
  const bannerShot = finished ?? (v.over ? settled : null);

  const stats: [key: "hole" | "par" | "strokes" | "total", value: string][] = [
    ["hole", t("holeOf", { hole: holeIndex + 1, holes: v.course.length })],
    ["par", number.format(hole.par)],
    ["strokes", number.format(strokes)],
    ["total", toParText],
  ];

  // Where the last shot dropped or splashed, while its hole is on screen.
  const landing: Point | null =
    !flying && settled && settled.hole === holeIndex && settled.outcome !== "rest"
      ? settled.outcome === "holed"
        ? hole.cup
        : [settled.path[settled.path.length - 2], settled.path[settled.path.length - 1]]
      : null;

  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-4">
      <Stats
        label={t("stats.label")}
        stats={stats.map(([key, value]) => ({ key, label: t(`stats.${key}`), value }))}
      />
      <Field
        ids={ids}
        label={fieldName}
        hole={hole}
        holeIndex={holeIndex}
        holeNumber={number.format(holeIndex + 1)}
        shots={v.shots}
        canShoot={canShoot}
        ball={ball}
        angle={angle}
        power={power}
        flying={flying}
        landing={landing}
        holed={settled?.outcome === "holed"}
        onAim={(shotAngle, shotPower) => {
          setAngle(shotAngle);
          setPower(shotPower);
        }}
        onShoot={shoot}
        onLanded={landed}
      />
      {bannerShot && (
        <Outcome
          text={outcomeText(bannerShot)}
          holed={bannerShot.outcome === "holed"}
          onNext={
            finished &&
            (() => {
              moveOn();
              (shootButton.current as Focusable | null)?.focus();
            })
          }
        />
      )}
      <ShotControls
        angle={angle}
        power={power}
        playing={playing}
        canShoot={canShoot}
        onAngle={setAngle}
        onPower={setPower}
        onShoot={() => shoot(angle, power)}
        shootRef={(element) => {
          shootButton.current = element;
        }}
      />
      <HazardLegend hole={hole} ids={`${ids}-${holeIndex}`} />
      <Scorecard view={v} holeIndex={holeIndex} />
      <StatusLine>
        {v.over
          ? t("over")
          : status === "done"
            ? t("ended")
            : settled?.outcome === "water" && !finished
              ? t("cup.splash")
              : v.shots === 0
                ? t("hint", { max: MAX_STROKES, cap: HOLE_CAP })
                : null}
      </StatusLine>
      <p role="status" className="sr-only">
        {settled ? outcomeText(settled) : ""}
      </p>
    </div>
  );
}
