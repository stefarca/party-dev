import { useTranslation } from "react-i18next";

import type { GameUiProps } from "../../shared/protocol";
import { Loading } from "../common/Loading";
import { SeatBadge } from "../common/SeatBadge";
import { StatusLine } from "../common/StatusLine";
import { Board } from "./components/Board";
import { SeatToken } from "./components/SeatToken";
import type strings from "./locales/en.json";
import type { Connect4View } from "./view";

declare module "i18next" {
  interface ResourceNamespaceMap {
    connect4: typeof strings;
  }
}

// Connect 4 board. No game-specific countdown here — the turn deadline is
// already shown once, generically, by `TurnIndicator` in `MatchPage`;
// duplicating it here would just be two clocks disagreeing by a second.
//
// The shell (`GameSurface`) provides the surrounding cabinet — this
// component renders only the board content that goes inside it. The board
// itself is painted with the theme-independent `--board-*` tokens, so the
// frame stays a dark plastic object and the discs stay vivid in both light
// and dark mode.

// `players` (from the match snapshot) is in join order, which is the same
// order `init()` assigned seats 0/1 in — so `players[seat]` is a
// straightforward lookup, not a leak of any hidden info (Connect 4 has none
// to begin with). `undefined` for a seat nobody has taken.
function nameFor(players: GameUiProps["players"], seat: 0 | 1): string | undefined {
  return players[seat]?.nickname;
}

export default function Connect4Ui({ view, players, result, send }: GameUiProps) {
  const { t } = useTranslation("connect4");
  const v = view as Connect4View | null;

  if (!v) return <Loading label={t("loading")} />;

  const disabled = v.winner !== null || v.draw || !v.yourTurn;
  const yourSeat = v.you === 0 || v.you === 1 ? v.you : null;
  // Which seat is on the clock, used only to highlight a badge. It cannot be
  // inferred from `turnNo`: the opening seat is drawn from the seeded PRNG
  // rather than always being seat 0, and `view()` deliberately exposes only
  // `you`/`yourTurn`, never the raw `turn`. For a seated player those two
  // flags pin it down exactly; a spectator gets no highlight rather than a
  // guessed one.
  const turnSeat: 0 | 1 | null =
    yourSeat === null ? null : v.yourTurn ? yourSeat : ((1 - yourSeat) as 0 | 1);

  const seatLabel = (seat: 0 | 1): string => {
    const name = nameFor(players, seat) ?? t("player", { number: seat + 1 });
    return v.you === seat ? t("you", { name }) : name;
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="mx-auto flex w-full max-w-lg flex-wrap items-center justify-center gap-2 sm:justify-between">
        {([0, 1] as const).map((seat) => (
          <SeatBadge
            key={seat}
            token={<SeatToken seat={seat} />}
            label={seatLabel(seat)}
            isYou={v.you === seat}
            isTurn={!result && v.winner === null && !v.draw && turnSeat === seat}
          />
        ))}
      </div>

      <Board
        view={v}
        disabled={disabled}
        yourSeat={yourSeat}
        onDrop={(col) => !disabled && send({ t: "drop", col })}
      />

      {!result && (
        <StatusLine>
          {v.winner !== null
            ? t("status.finished")
            : v.yourTurn
              ? t("status.yourTurn")
              : t("status.waiting")}
        </StatusLine>
      )}
    </div>
  );
}
