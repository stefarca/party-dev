import { useState } from "react";
import { useTranslation } from "react-i18next";

import { StatusLine } from "../../common/StatusLine";
import { FLEET, SIZE, cellName, randomFleet, shipCells } from "../game";
import type { Fleet, Placement } from "../game";
import { Board } from "./Board";
import { Dock } from "./Dock";
import type { CellSpec } from "./Board";
import type { HullSpec } from "./Hull";

// Laying out your fleet before the shooting starts. The layout lives only
// here until Ready sends it whole; `reduce` checks it again either way.
export function Placing({ caption, send }: { caption: string; send: (action: unknown) => void }) {
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
      <StatusLine>{status}</StatusLine>
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
        <Dock
          draft={draft}
          selected={selected}
          vertical={vertical}
          onPick={(ship) => (draft[ship] !== null ? pickUp(ship) : setSelected(ship))}
          onRotate={rotate}
          onShuffle={shuffle}
          onClear={clear}
          onReady={() => send({ t: "place", ships: draft as Fleet })}
        />
      </div>
    </div>
  );
}
