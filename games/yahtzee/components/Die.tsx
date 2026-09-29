import { useTranslation } from "react-i18next";

import { Pips } from "./Pips";

// A thrown die drops onto the tray spinning, a moment after the one before
// it; a die whose roll is on its way rattles until it lands.
const TUMBLE = "animate-[party-dice-tumble_var(--dur-slow)_var(--ease-out)_both]";
const RATTLE = "animate-[party-dice-shake_140ms_ease-in-out_infinite]";

const FACE = {
  background: "linear-gradient(150deg, var(--die-face) 45%, var(--die-shade))",
} as const;

// One die on the tray, as a toggle button: pressed while it is held. A held
// die rises out of the row, ringed, and says so on the tag beneath it; any
// other die's tag is the key that holds it.
export function Die({
  index,
  face,
  held,
  thrown,
  throwKey,
  rattling,
  disabled,
  onToggle,
}: {
  index: number;
  // Null until the round's first roll.
  face: number | null;
  held: boolean;
  // Whether the last roll threw it, so it lands spinning.
  thrown: boolean;
  // Names that roll, so each throw lands afresh.
  throwKey: string;
  rattling: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation("yahtzee");
  const number = index + 1;
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-[1.8cqw]">
      <button
        type="button"
        aria-label={face === null ? t("die.blank", { number }) : t("die.face", { number, face })}
        aria-pressed={face === null ? undefined : held}
        disabled={disabled}
        onClick={onToggle}
        className={`aspect-square w-full cursor-pointer rounded-[22%] p-0 transition-[translate,scale] duration-[var(--dur-base)] ease-[var(--ease-spring)] touch-manipulation disabled:cursor-default ${
          held ? "-translate-y-[10%]" : "not-disabled:hover:-translate-y-[4%]"
        } not-disabled:active:scale-95`}
      >
        {face === null ? (
          <span className="block size-full rounded-[22%] bg-[var(--board-hole)] shadow-[var(--shadow-inset)]" />
        ) : (
          // Keyed by the throw, so a die thrown again mounts afresh and tumbles in.
          <span
            key={thrown ? throwKey : "kept"}
            className={`block size-full rounded-[22%] p-[5%] ${rattling ? RATTLE : thrown ? TUMBLE : ""}`}
            style={{
              ...FACE,
              boxShadow: held
                ? "0 0 0 0.9cqw var(--tile-128), 0 0 3cqw color-mix(in oklab, var(--tile-128) 60%, transparent), var(--game-piece-shadow)"
                : "var(--game-piece-shadow)",
              animationDelay: rattling ? undefined : `${index * 45}ms`,
            }}
          >
            <Pips face={face} />
          </span>
        )}
      </button>
      <span
        aria-hidden="true"
        className="rounded-[var(--radius-pill)] px-[1.8cqw] text-[2.6cqw] leading-[1.6] font-bold tracking-[0.08em] uppercase tabular-nums"
        style={
          held
            ? { background: "var(--tile-128)", color: "var(--tile-ink)" }
            : { color: "var(--board-hull)" }
        }
      >
        {held ? t("held") : number}
      </span>
    </div>
  );
}
