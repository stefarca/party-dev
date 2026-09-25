import { useTranslation } from "react-i18next";

import type { GameUiProps } from "../../shared/protocol";
import { Loading } from "../common/Loading";
import { Placing } from "./components/Placing";
import { Report } from "./components/Report";
import { Waters } from "./components/Waters";
import { FLEET } from "./game";
import type { BattleshipView, Seat } from "./game";
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

export default function BattleshipUi({ view, players, result, send }: GameUiProps) {
  const { t } = useTranslation("battleship");
  const v = view as BattleshipView | null;

  if (!v) return <Loading label={t("loading")} />;

  const seat = v.you === "spectator" ? null : v.you;
  const nameOf = (s: Seat): string =>
    players.find((p) => p.id === v.players[s])?.nickname ?? v.players[s];
  if (v.phase === "placing" && seat !== null && !v.ready[seat]) {
    return <Placing caption={t("you", { name: nameOf(seat) })} send={send} />;
  }

  // Whose waters are drawn as whose: a spectator sees seat 0's as the first.
  const mine: Seat = seat ?? 0;
  const theirs: Seat = mine === 0 ? 1 : 0;
  const waters = (owner: Seat) => (
    <Waters
      key={owner}
      view={v}
      owner={owner}
      seat={seat}
      title={
        seat === null
          ? t("board.of", { name: nameOf(owner) })
          : t(owner === seat ? "board.yours" : "board.enemy")
      }
      caption={`${owner === seat ? t("you", { name: nameOf(owner) }) : nameOf(owner)} · ${t(
        "afloat",
        { count: FLEET.length - v.sunk[owner].length },
      )}`}
      onFire={(square) => send({ t: "fire", cell: square })}
    />
  );

  return (
    <div className="flex flex-col gap-4">
      <Report view={v} seat={seat} over={result !== null} nameOf={nameOf} />
      {v.phase === "placing" ? (
        waters(mine)
      ) : (
        // The waters you fire into come first: on a phone that is the board
        // you act on, at the top.
        <div className="grid items-start gap-6 md:grid-cols-2 md:gap-4">
          {waters(theirs)}
          {waters(mine)}
        </div>
      )}
    </div>
  );
}
