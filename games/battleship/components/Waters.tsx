import { useTranslation } from "react-i18next";

import { FLEET, cellName, shipCells } from "../game";
import type { BattleshipView, Seat, ShipId } from "../game";
import { Board } from "./Board";
import type { CellSpec } from "./Board";
import type { HullSpec } from "./Hull";
import { Roster } from "./Roster";

// Everything drawn in `owner`'s waters: their ships as far as this player
// may see them, the pegs of every shot the other seat fired there, and the
// fleet listed underneath. `seat` is this player's, or null for a spectator.
export function Waters({
  view: v,
  owner,
  seat,
  title,
  caption,
  onFire,
}: {
  view: BattleshipView;
  owner: Seat;
  seat: Seat | null;
  title: string;
  caption: string;
  onFire: (square: number) => void;
}) {
  const { t } = useTranslation("battleship");
  const shooter: Seat = owner === 0 ? 1 : 0;
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
    return [{ key: id, placement: fleet[i], length, look: owner === seat ? "afloat" : "revealed" }];
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
      label={title}
      caption={caption}
      hulls={hulls}
      cell={cell}
      lastShot={lastShot}
      crosshair={canFire}
      onCell={onFire}
      footer={<Roster sunk={v.sunk[owner].map((s) => s.ship)} />}
    />
  );
}
