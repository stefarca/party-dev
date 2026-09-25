import { Button } from "@heroui/react";
import { useTranslation } from "react-i18next";

import { FLEET } from "../game";
import type { Placement } from "../game";

// The dock beside the board while a fleet is laid out: every ship, picked
// to place (or picked up again) from here, and the buttons that turn,
// shuffle, clear and send the layout.
export function Dock({
  draft,
  selected,
  vertical,
  onPick,
  onRotate,
  onShuffle,
  onClear,
  onReady,
}: {
  draft: Array<Placement | null>;
  selected: number | null;
  vertical: boolean;
  onPick: (ship: number) => void;
  onRotate: () => void;
  onShuffle: () => void;
  onClear: () => void;
  onReady: () => void;
}) {
  const { t } = useTranslation("battleship");
  const complete = draft.every((p) => p !== null);
  return (
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
                onClick={() => onPick(ship)}
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
        onPress={onRotate}
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
          onPress={onShuffle}
          className="rounded-[var(--radius-pill)]"
        >
          {t("dock.random")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          fullWidth
          onPress={onClear}
          isDisabled={draft.every((p) => p === null)}
          className="rounded-[var(--radius-pill)]"
        >
          {t("dock.clear")}
        </Button>
      </div>
      <Button
        fullWidth
        onPress={() => complete && onReady()}
        isDisabled={!complete}
        className="rounded-[var(--radius-pill)] font-display font-bold transition-transform duration-[var(--dur-fast)] ease-[var(--ease-spring)] not-disabled:hover:scale-[1.03] not-disabled:active:scale-95"
      >
        {t("dock.ready")}
      </Button>
    </div>
  );
}
