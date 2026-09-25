import { useTranslation } from "react-i18next";

import type { GameUiProps } from "../../shared/protocol";
import { Loading } from "../common/Loading";
import { SeatBadge } from "../common/SeatBadge";
import { StatusLine } from "../common/StatusLine";
import { Board } from "./components/Board";
import { SeatToken } from "./components/SeatToken";
import type { Mark } from "./game";
import type strings from "./locales/en.json";
import type { TicTacToeView } from "./view";

declare module "i18next" {
  interface ResourceNamespaceMap {
    tictactoe: typeof strings;
  }
}

// Tic-tac-toe board. The turn deadline is shown once, generically, by
// `TurnIndicator` in `MatchPage` — no countdown here. The shell
// (`GameSurface`) provides the cabinet; this renders only the board, painted
// with the theme-independent `--board-*` tokens so the marks stay vivid in
// both light and dark mode.

export default function TicTacToeUi({ view, players, result, send }: GameUiProps) {
  const { t } = useTranslation("tictactoe");
  const v = view as TicTacToeView | null;

  if (!v) return <Loading label={t("loading")} />;

  const yourMark = v.you === "spectator" ? null : v.you;
  const nameFor = (mark: Mark): string =>
    players.find((p) => p.id === v.players[mark])?.nickname ?? mark;

  return (
    <div className="flex flex-col gap-4">
      <div className="mx-auto flex w-full max-w-sm flex-wrap items-center justify-center gap-2 sm:justify-between">
        {(["X", "O"] as const).map((mark) => (
          <SeatBadge
            key={mark}
            token={<SeatToken mark={mark} />}
            label={v.you === mark ? t("you", { name: nameFor(mark) }) : nameFor(mark)}
            isYou={v.you === mark}
            isTurn={!result && v.turn === mark}
          />
        ))}
      </div>

      <Board view={v} onPlace={(cell) => send({ t: "place", cell })} />

      {!result && (
        <StatusLine>
          {v.yourTurn
            ? t("status.yourTurn", { mark: yourMark })
            : v.turn
              ? t("status.waitingFor", { name: nameFor(v.turn) })
              : t("status.finished")}
        </StatusLine>
      )}
    </div>
  );
}
