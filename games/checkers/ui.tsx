import { useTranslation } from "react-i18next";

import type { GameUiProps } from "../../shared/protocol";
import { Loading } from "../common/Loading";
import { SeatBadge } from "../common/SeatBadge";
import { StatusLine } from "../common/StatusLine";
import { Board } from "./components/Board";
import { PieceDisc } from "./components/PieceDisc";
import { QUIET_PLY_LIMIT } from "./game";
import type { Side } from "./game";
import type strings from "./locales/en.json";
import { useMove } from "./useMove";
import type { CheckersView } from "./view";

declare module "i18next" {
  interface ResourceNamespaceMap {
    checkers: typeof strings;
  }
}

// Checkers board. The turn deadline is shown once, generically, by
// `TurnIndicator` in `MatchPage` — no countdown here. The shell
// (`GameSurface`) provides the cabinet; this renders only the board, painted
// with the theme-independent `--board-*` tokens so the pieces stay vivid in
// both light and dark mode. Each player sees their own pieces at the bottom.

export default function CheckersUi({ view, players, result, send }: GameUiProps) {
  const { t } = useTranslation("checkers");
  const v = view as CheckersView | null;
  const move = useMove(v, send);

  if (!v) return <Loading label={t("loading")} />;

  const nameFor = (side: Side): string =>
    players.find((p) => p.id === v.players[side])?.nickname ?? t(`side.${side}`);
  const piecesLeft = (side: Side): number =>
    v.board.filter((square) => square?.side === side).length;

  const picked = move.selection.length;
  const status = v.yourTurn
    ? picked > 1
      ? t("status.keepJumping")
      : picked === 1
        ? v.mustJump
          ? t("status.pickJump")
          : t("status.pickMove")
        : v.mustJump
          ? t("status.mustJump")
          : t("status.pickPiece")
    : v.turn
      ? t("status.waitingFor", { name: nameFor(v.turn) })
      : t("status.finished");
  const quietLeft = QUIET_PLY_LIMIT - v.quietPlies;

  return (
    <div className="flex flex-col gap-4">
      <div className="mx-auto flex w-full max-w-lg flex-wrap items-center justify-center gap-2 sm:justify-between">
        {(["red", "blue"] as const).map((side) => (
          <SeatBadge
            key={side}
            token={<PieceDisc piece={{ side, king: false }} className="size-7" />}
            label={v.you === side ? t("you", { name: nameFor(side) }) : nameFor(side)}
            isYou={v.you === side}
            isTurn={!result && v.turn === side}
          >
            <span className="text-xs text-[var(--text-muted)] tabular-nums">
              {t("left", { count: piecesLeft(side) })}
            </span>
          </SeatBadge>
        ))}
      </div>

      <Board view={v} move={move} />

      {!result && (
        <div className="flex flex-col items-center gap-1">
          <StatusLine>{status}</StatusLine>
          {v.turn && quietLeft <= 20 && (
            <p className="m-0 text-center text-xs text-[var(--text-muted)]">
              {t("quietDraw", { count: quietLeft })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
