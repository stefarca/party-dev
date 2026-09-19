import { Button } from "@heroui/react";
import { useState } from "react";
import type { CSSProperties, KeyboardEvent, ReactNode } from "react";
import { useTranslation } from "react-i18next";

import type { GameUiProps } from "../../shared/protocol";
import { CELLS, FLEET, SIZE, cellName, randomFleet, shipCells } from "./game";
import type { BattleshipView, Fleet, Placement, Seat, ShipId, ShotView } from "./game";
import type strings from "./locales/en.json";

declare module "i18next" {
  interface ResourceNamespaceMap {
    battleship: typeof strings;
  }
}

// Battleship: your own waters, and the enemy's you fire into. The turn
// deadline is shown once, generically, by `TurnIndicator` in `MatchPage` — no
// countdown here. The shell (`GameSurface`) provides the cabinet; this renders
// only the boards, painted with the theme-independent `--board-*` tokens so
// the ships and pegs read the same in light and dark mode.
//
// Each board is three layers: the water with its grid lines, the ships drawn
// over it, and a transparent grid of buttons on top that carries the pegs,
// the focus ring and every square's accessible name.

// Colour is never the only signal: a hit is a large ringed peg with a cross, a
// miss a small plain one, a sunk ship's name is on each of its squares, and a
// ship revealed at the end is an outline rather than a solid hull.
type HullLook = "afloat" | "sunk" | "revealed" | "fits" | "blocked";

interface HullSpec {
  key: string;
  placement: Placement;
  length: number;
  look: HullLook;
  landing?: boolean;
}

const LAND = "animate-[party-piece-land_var(--dur-slow)_var(--ease-spring)_both]";
const GLOSS = "radial-gradient(circle at 30% 25%, var(--gloss-highlight), var(--gloss-fade) 60%)";
const GRID_LINES =
  "linear-gradient(to right, var(--board-rim) 1px, transparent 1px), linear-gradient(to bottom, var(--board-rim) 1px, transparent 1px)";

const ROW_LETTERS = Array.from({ length: SIZE }, (_, row) => cellName(row * SIZE).charAt(0));

// How far a hull sits in from the edges of its squares, in squares.
const HULL_INSET = 0.12;

const HULL_STYLE: Record<HullLook, CSSProperties> = {
  afloat: { backgroundColor: "var(--board-hull)", backgroundImage: GLOSS },
  sunk: { backgroundColor: "var(--board-hull)", opacity: 0.55 },
  revealed: { border: "2px dashed var(--board-hull)" },
  fits: { border: "2px dashed var(--accent)", backgroundColor: "var(--accent-soft)" },
  blocked: { border: "2px dashed var(--seat-1)" },
};

function other(seat: Seat): Seat {
  return seat === 0 ? 1 : 0;
}

// The box of `length` squares running from a placement's top-left end, as
// percentages of the board, drawn `inset` squares in from every edge.
function box({ row, col, vertical }: Placement, length: number, inset = 0): CSSProperties {
  const width = vertical ? 1 : length;
  const height = vertical ? length : 1;
  const pct = (squares: number) => `${squares * (100 / SIZE)}%`;
  return {
    left: pct(col + inset),
    top: pct(row + inset),
    width: pct(width - 2 * inset),
    height: pct(height - 2 * inset),
  };
}

function Hull({ spec }: { spec: HullSpec }) {
  return (
    <span
      aria-hidden="true"
      className={`pointer-events-none absolute rounded-[var(--radius-pill)] ${
        spec.look === "afloat" ? "shadow-[var(--game-piece-shadow)]" : ""
      } ${spec.landing ? LAND : ""}`}
      style={{ ...box(spec.placement, spec.length, HULL_INSET), ...HULL_STYLE[spec.look] }}
    />
  );
}

function Peg({ hit, landing }: { hit: boolean; landing: boolean }) {
  if (!hit) {
    return (
      <span
        aria-hidden="true"
        className={`size-[30%] rounded-full bg-[var(--board-peg)] shadow-[var(--shadow-1)] ${landing ? LAND : ""}`}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={`flex size-[58%] items-center justify-center rounded-full bg-[var(--seat-1)] text-[var(--seat-1-contrast)] shadow-[var(--game-piece-shadow)] ring-2 ring-[var(--seat-1-contrast)] ${landing ? LAND : ""}`}
    >
      <svg viewBox="0 0 24 24" className="size-3/5" fill="none" stroke="currentColor">
        <path d="M6 6 18 18M18 6 6 18" strokeWidth={4} strokeLinecap="round" />
      </svg>
    </span>
  );
}

interface CellSpec {
  label: string;
  active: boolean; // pressing it does something
  peg: ShotView | null;
}

function Board({
  label,
  caption,
  hulls,
  cell,
  lastShot,
  crosshair = false,
  lockedAs = "disabled",
  footer,
  onCell,
  onHover,
  onKeyDown,
}: {
  label: string;
  caption: string;
  hulls: HullSpec[];
  cell: (square: number) => CellSpec;
  lastShot: number | null;
  crosshair?: boolean;
  // How a square that does nothing is shut. `disabled` takes it out of the
  // tab order; `aria` keeps it focusable and under the pointer, so the ship
  // being placed can still be previewed over it.
  lockedAs?: "disabled" | "aria";
  footer?: ReactNode;
  onCell?: (square: number) => void;
  onHover?: (square: number | null) => void;
  onKeyDown?: (event: KeyboardEvent) => void;
}) {
  return (
    <section className="mx-auto flex w-full max-w-md min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 px-1">
        <h3 className="m-0 font-display text-sm font-bold text-[var(--text-primary)]">{label}</h3>
        <span className="truncate text-xs text-[var(--text-muted)]">{caption}</span>
      </div>
      <div
        role="group"
        aria-label={label}
        onKeyDown={onKeyDown}
        className="rounded-[var(--radius-lg)] border-4 p-1.5 shadow-[var(--shadow-inset),var(--shadow-2)] sm:p-2"
        style={{ background: "var(--board-well)", borderColor: "var(--board-rim)" }}
      >
        <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-1">
          <span aria-hidden="true" />
          <div
            aria-hidden="true"
            className="grid text-center font-display text-[10px] leading-none font-bold text-[var(--board-hull)] tabular-nums sm:text-xs"
            style={{ gridTemplateColumns: `repeat(${SIZE}, 1fr)` }}
          >
            {Array.from({ length: SIZE }, (_, col) => (
              <span key={col}>{col + 1}</span>
            ))}
          </div>
          <div
            aria-hidden="true"
            className="grid items-center pr-0.5 font-display text-[10px] leading-none font-bold text-[var(--board-hull)] sm:text-xs"
            style={{ gridTemplateRows: `repeat(${SIZE}, 1fr)` }}
          >
            {ROW_LETTERS.map((letter) => (
              <span key={letter}>{letter}</span>
            ))}
          </div>
          <div
            className="relative aspect-square overflow-hidden rounded-[var(--radius-xs)]"
            style={{
              backgroundColor: "var(--board-hole)",
              backgroundImage: GRID_LINES,
              backgroundSize: `${100 / SIZE}% ${100 / SIZE}%`,
            }}
            onPointerLeave={onHover && (() => onHover(null))}
          >
            {lastShot !== null && (
              <span
                aria-hidden="true"
                className="absolute bg-[var(--board-mark)]"
                style={box(
                  { row: Math.floor(lastShot / SIZE), col: lastShot % SIZE, vertical: false },
                  1,
                )}
              />
            )}
            {hulls.map((spec) => (
              <Hull key={spec.key} spec={spec} />
            ))}
            <div
              className="absolute inset-0 grid"
              style={{
                gridTemplateColumns: `repeat(${SIZE}, 1fr)`,
                gridTemplateRows: `repeat(${SIZE}, 1fr)`,
              }}
            >
              {Array.from({ length: CELLS }, (_, square) => {
                const { label: name, active, peg } = cell(square);
                return (
                  <button
                    key={square}
                    type="button"
                    disabled={!active && lockedAs === "disabled"}
                    aria-disabled={!active && lockedAs === "aria" ? true : undefined}
                    aria-label={name}
                    onClick={active ? () => onCell?.(square) : undefined}
                    onPointerEnter={onHover && (() => onHover(square))}
                    onFocus={onHover && (() => onHover(square))}
                    className={`group relative flex min-w-0 items-center justify-center border-none bg-transparent p-0 focus-visible:z-10 focus-visible:outline-offset-[-3px] disabled:cursor-default ${
                      active ? "cursor-pointer" : "cursor-default"
                    }`}
                  >
                    {peg && <Peg hit={peg.hit} landing={square === lastShot} />}
                    {crosshair && active && (
                      <span
                        aria-hidden="true"
                        className="absolute inset-[18%] rounded-full border-2 border-[var(--accent)] opacity-0 shadow-[var(--glow-accent)] transition-[opacity,scale] duration-[var(--dur-fast)] ease-[var(--ease-spring)] group-hover:scale-110 group-hover:opacity-100 group-focus-visible:opacity-100"
                      />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
      {footer}
    </section>
  );
}

// The fleet listed under a board, with every sunk ship struck through.
function Roster({ sunk }: { sunk: ShipId[] }) {
  const { t } = useTranslation("battleship");
  return (
    <ul className="m-0 flex list-none flex-wrap justify-center gap-1.5 p-0">
      {FLEET.map(({ id, length }) => {
        const down = sunk.includes(id);
        return (
          <li
            key={id}
            className={`flex items-center gap-1.5 rounded-[var(--radius-pill)] bg-[var(--surface-1)] px-2 py-0.5 text-xs ${
              down ? "text-[var(--text-muted)] line-through" : "text-[var(--text-secondary)]"
            }`}
          >
            <span aria-hidden="true" className="flex gap-px">
              {Array.from({ length }, (_, i) => (
                <span
                  key={i}
                  className={`size-1.5 rounded-full ${down ? "bg-[var(--seat-1)]" : "bg-[var(--text-muted)]"}`}
                />
              ))}
            </span>
            {t(`ship.${id}`)}
            {down && <span className="sr-only">, {t("cell.sunk")}</span>}
          </li>
        );
      })}
    </ul>
  );
}

// Laying out your fleet before the shooting starts. The layout lives only
// here until Ready sends it whole; `reduce` checks it again either way.
function Placing({ caption, send }: { caption: string; send: (action: unknown) => void }) {
  const { t } = useTranslation("battleship");
  const [draft, setDraft] = useState<Array<Placement | null>>(() => FLEET.map(() => null));
  const [selected, setSelected] = useState<number | null>(0);
  const [vertical, setVertical] = useState(false);
  const [hover, setHover] = useState<number | null>(null);

  // square -> the ship on it
  const occupied = new Map<number, number>();
  draft.forEach((placement, ship) => {
    for (const square of placement ? (shipCells(placement, FLEET[ship].length) ?? []) : []) {
      occupied.set(square, ship);
    }
  });

  const at = (square: number): Placement => ({
    row: Math.floor(square / SIZE),
    col: square % SIZE,
    vertical,
  });
  const fits = (ship: number, placement: Placement): boolean => {
    const squares = shipCells(placement, FLEET[ship].length);
    return squares !== null && squares.every((square) => !occupied.has(square));
  };

  const pickUp = (ship: number) => {
    const placement = draft[ship];
    if (placement) setVertical(placement.vertical);
    setDraft(draft.map((p, i) => (i === ship ? null : p)));
    setSelected(ship);
  };

  const choose = (square: number) => {
    if (selected !== null && fits(selected, at(square))) {
      const next = draft.map((p, i) => (i === selected ? at(square) : p));
      setDraft(next);
      // Straight on to the next ship still to place, so a whole fleet is five
      // clicks.
      const order = [...FLEET.keys()].map((i) => (selected + 1 + i) % FLEET.length);
      setSelected(order.find((i) => next[i] === null) ?? null);
      return;
    }
    const ship = occupied.get(square);
    if (ship !== undefined) pickUp(ship);
  };

  const rotate = () => setVertical((was) => !was);
  // A fresh layout each press. `Math.random()` is fine here: this is a
  // suggestion on the client, and the server checks whatever is sent.
  const shuffle = () => {
    setDraft(randomFleet(Math.floor(Math.random() * 2 ** 32))[0]);
    setSelected(null);
  };
  const clear = () => {
    setDraft(FLEET.map(() => null));
    setSelected(0);
  };
  const complete = draft.every((p) => p !== null);

  const hulls: HullSpec[] = [];
  draft.forEach((placement, ship) => {
    if (placement) {
      hulls.push({
        key: FLEET[ship].id,
        placement,
        length: FLEET[ship].length,
        look: "afloat",
        landing: true,
      });
    }
  });
  if (selected !== null && hover !== null) {
    // The ship being placed, drawn where it would go from the square under
    // the pointer or focus — cut short at the edge if it would run off.
    const placement = at(hover);
    const room = SIZE - (vertical ? placement.row : placement.col);
    hulls.push({
      key: "preview",
      placement,
      length: Math.min(FLEET[selected].length, room),
      look: fits(selected, placement) ? "fits" : "blocked",
    });
  }

  const selectedShip = selected === null ? null : FLEET[selected].id;
  const cell = (square: number): CellSpec => {
    const ship = occupied.get(square);
    const fitsHere = selected !== null && fits(selected, at(square));
    const notes = [
      cellName(square),
      ship === undefined ? t("cell.empty") : t(`ship.${FLEET[ship].id}`),
      fitsHere ? t("cell.placeHere", { ship: t(`theShip.${FLEET[selected].id}`) }) : null,
    ];
    return {
      label: notes.filter(Boolean).join(", "),
      active: fitsHere || ship !== undefined,
      peg: null,
    };
  };

  const status =
    selectedShip === null
      ? t("status.pickShip")
      : t(vertical ? "status.placeVertical" : "status.placeHorizontal", {
          ship: t(`theShip.${selectedShip}`),
        });

  return (
    <div className="flex flex-col gap-4">
      <p className="m-0 text-center text-sm font-semibold text-[var(--text-secondary)]">{status}</p>
      <div className="grid items-start gap-4 md:grid-cols-[minmax(0,1fr)_15rem]">
        <Board
          label={t("board.yours")}
          caption={caption}
          hulls={hulls}
          cell={cell}
          lastShot={null}
          lockedAs="aria"
          onCell={choose}
          onHover={setHover}
          onKeyDown={(event) => {
            if (event.key === "r" || event.key === "R") {
              event.preventDefault();
              rotate();
            }
          }}
        />
        <div className="mx-auto flex w-full max-w-md flex-col gap-3 rounded-[var(--radius-lg)] bg-[var(--surface-1)] p-3 shadow-[var(--edge-highlight),var(--shadow-1)]">
          <h3 className="m-0 font-display text-sm font-bold text-[var(--text-primary)]">
            {t("dock.title")}
          </h3>
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {FLEET.map(({ id, length }, ship) => {
              const placed = draft[ship] !== null;
              const isSelected = selected === ship;
              return (
                <li key={id}>
                  <button
                    type="button"
                    aria-pressed={isSelected}
                    aria-label={[
                      t(`ship.${id}`),
                      t("squares", { count: length }),
                      t(placed ? "dock.placed" : "dock.notPlaced"),
                    ].join(", ")}
                    onClick={() => (placed ? pickUp(ship) : setSelected(ship))}
                    className={`flex w-full cursor-pointer items-center gap-3 rounded-[var(--radius-md)] border-2 px-3 py-1.5 text-left transition-[border-color,background-color] duration-[var(--dur-fast)] ${
                      isSelected
                        ? "border-[var(--border-accent)] bg-[var(--accent-soft)]"
                        : "border-transparent bg-[var(--surface-2)] hover:border-[var(--border-subtle)]"
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className="flex flex-none gap-0.5 rounded-[var(--radius-pill)] p-1"
                      style={{ background: "var(--board-hole)" }}
                    >
                      {Array.from({ length }, (_, i) => (
                        <span
                          key={i}
                          className="size-2.5 rounded-full"
                          style={{
                            background: placed ? "var(--board-hull)" : "var(--board-rim)",
                          }}
                        />
                      ))}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--text-primary)]">
                      {t(`ship.${id}`)}
                    </span>
                    {placed && (
                      <span aria-hidden="true" className="text-sm text-[var(--ok-fg)]">
                        ✓
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
          <Button
            size="sm"
            variant="secondary"
            fullWidth
            onPress={rotate}
            aria-label={t("dock.rotateLabel", {
              direction: t(vertical ? "dock.vertical" : "dock.horizontal"),
            })}
            className="rounded-[var(--radius-pill)]"
          >
            <span aria-hidden="true">{vertical ? "↕" : "↔"}</span>
            {t("dock.rotate")}
          </Button>
          <div className="grid grid-cols-2 gap-2">
            <Button
              size="sm"
              variant="secondary"
              fullWidth
              onPress={shuffle}
              className="rounded-[var(--radius-pill)]"
            >
              {t("dock.random")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              fullWidth
              onPress={clear}
              isDisabled={draft.every((p) => p === null)}
              className="rounded-[var(--radius-pill)]"
            >
              {t("dock.clear")}
            </Button>
          </div>
          <Button
            fullWidth
            onPress={() => complete && send({ t: "place", ships: draft as Fleet })}
            isDisabled={!complete}
            className="rounded-[var(--radius-pill)] font-display font-bold transition-transform duration-[var(--dur-fast)] ease-[var(--ease-spring)] not-disabled:hover:scale-[1.03] not-disabled:active:scale-95"
          >
            {t("dock.ready")}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function BattleshipUi({ view, players, result, send }: GameUiProps) {
  const { t } = useTranslation("battleship");
  const v = view as BattleshipView | null;

  if (!v) {
    return <p className="m-0 text-[var(--text-muted)]">{t("loading")}</p>;
  }

  const seat = v.you === "spectator" ? null : v.you;
  const nameOf = (s: Seat): string =>
    players.find((p) => p.id === v.players[s])?.nickname ?? v.players[s];
  if (v.phase === "placing" && seat !== null && !v.ready[seat]) {
    return <Placing caption={t("you", { name: nameOf(seat) })} send={send} />;
  }

  // Whose waters are drawn as whose: a spectator sees seat 0's as the first.
  const mine: Seat = seat ?? 0;
  const theirs = other(mine);
  const titleOf = (s: Seat): string =>
    seat === null
      ? t("board.of", { name: nameOf(s) })
      : t(s === seat ? "board.yours" : "board.enemy");
  const captionOf = (s: Seat): string =>
    `${s === seat ? t("you", { name: nameOf(s) }) : nameOf(s)} · ${t("afloat", {
      count: FLEET.length - v.sunk[s].length,
    })}`;

  // Everything drawn in `owner`'s waters: their ships as far as this player
  // may see them, and the pegs of every shot the other seat fired there.
  const boardFor = (owner: Seat) => {
    const shooter = other(owner);
    const sunk = new Map(v.sunk[owner].map((s) => [s.ship, s]));
    const fleet = v.fleets[owner];
    const hulls: HullSpec[] = FLEET.flatMap(({ id, length }, i): HullSpec[] => {
      const wreck = sunk.get(id);
      if (wreck) {
        return [
          { key: id, placement: wreck, length, look: "sunk", landing: v.lastShot?.sunk === id },
        ];
      }
      if (!fleet) return [];
      return [
        { key: id, placement: fleet[i], length, look: owner === seat ? "afloat" : "revealed" },
      ];
    });

    const shipOn = new Map<number, ShipId>();
    FLEET.forEach(({ id, length }, i) => {
      const placement = sunk.get(id) ?? fleet?.[i];
      for (const square of placement ? (shipCells(placement, length) ?? []) : []) {
        shipOn.set(square, id);
      }
    });
    const shots = new Map(v.shots[shooter].map((shot) => [shot.cell, shot]));
    const lastShot = v.lastShot?.by === shooter ? v.lastShot.cell : null;
    const canFire = v.yourTurn && shooter === seat;

    const cell = (square: number): CellSpec => {
      const shot = shots.get(square) ?? null;
      const ship = shipOn.get(square);
      const active = canFire && shot === null;
      const notes = [
        cellName(square),
        ship ? t(`ship.${ship}`) : owner === seat ? t("cell.empty") : null,
        shot
          ? shot.hit
            ? ship && sunk.has(ship)
              ? t("cell.sunk")
              : t("cell.hit")
            : t("cell.miss")
          : ship || active || owner === seat
            ? null
            : t("cell.unknown"),
        square === lastShot ? t("cell.lastShot") : null,
        active ? t("cell.fireHere") : null,
      ];
      return { label: notes.filter(Boolean).join(", "), active, peg: shot };
    };

    return (
      <Board
        key={owner}
        label={titleOf(owner)}
        caption={captionOf(owner)}
        hulls={hulls}
        cell={cell}
        lastShot={lastShot}
        crosshair={canFire}
        onCell={(square) => send({ t: "fire", cell: square })}
        footer={<Roster sunk={v.sunk[owner].map((s) => s.ship)} />}
      />
    );
  };

  const lines: string[] = [];
  if (v.lastShot) {
    const { by, cell, hit, sunk } = v.lastShot;
    const values = {
      cell: cellName(cell),
      name: nameOf(by),
      ship: sunk ? t(`theShip.${sunk}`) : "",
    };
    const who = by === seat ? "you" : "they";
    const outcome = sunk ? "Sunk" : hit ? "Hit" : "Miss";
    lines.push(t(`lastShot.${who}${outcome}`, values));
  }
  if (!result) {
    if (v.phase === "placing") {
      lines.push(seat === null ? t("status.placing") : t("status.ready", { name: nameOf(theirs) }));
    } else if (v.yourTurn) {
      lines.push(t("status.yourShot"));
    } else if (v.turn !== null) {
      lines.push(t("status.waitingShot", { name: nameOf(v.turn) }));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div role="status" className="flex flex-col items-center gap-0.5 text-center">
        {lines.map((line, i) => (
          <p
            key={line}
            className={`m-0 text-sm ${
              i === 0 && v.lastShot
                ? "font-bold text-[var(--text-primary)]"
                : "font-semibold text-[var(--text-secondary)]"
            }`}
          >
            {line}
          </p>
        ))}
      </div>
      {v.phase === "placing" ? (
        boardFor(mine)
      ) : (
        // The waters you fire into come first: on a phone that is the board
        // you act on, at the top.
        <div className="grid items-start gap-6 md:grid-cols-2 md:gap-4">
          {boardFor(theirs)}
          {boardFor(mine)}
        </div>
      )}
    </div>
  );
}
