import { useTranslation } from "react-i18next";

export function RoundProgress({ round, totalRounds }: { round: number; totalRounds: number }) {
  const { t } = useTranslation("trivia");
  const fraction = totalRounds > 0 ? (round + 1) / totalRounds : 0;
  return (
    <div className="flex flex-col gap-1.5">
      <p className="m-0 text-xs font-bold tracking-[0.15em] text-[var(--text-muted)] uppercase">
        {t("round", { round: round + 1, total: totalRounds })}
      </p>
      <div
        className="h-2 overflow-hidden rounded-[var(--radius-pill)] bg-[var(--surface-inset)] shadow-[var(--shadow-inset)]"
        role="progressbar"
        aria-valuenow={round + 1}
        aria-valuemin={1}
        aria-valuemax={totalRounds}
      >
        <div
          className="h-full origin-left rounded-[inherit] transition-transform duration-[var(--dur-slow)] ease-[var(--ease-spring)]"
          style={{
            transform: `scaleX(${fraction})`,
            background: "linear-gradient(90deg, var(--accent), var(--party-pink))",
          }}
        />
      </div>
    </div>
  );
}
