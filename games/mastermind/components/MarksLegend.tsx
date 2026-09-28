import { useTranslation } from "react-i18next";

// What the marks mean. Hidden from assistive technology, which reads every
// row's marks as words. Drawn in the text's own colour, since it sits on the
// page, not the board.
export function MarksLegend() {
  const { t } = useTranslation("mastermind");
  return (
    <div
      aria-hidden="true"
      className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs font-semibold text-[var(--text-secondary)]"
    >
      <span className="flex items-center gap-1.5">
        <span
          className="inline-block size-3 rounded-full"
          style={{ background: "var(--text-primary)" }}
        />
        {t("legend.exact")}
      </span>
      <span className="flex items-center gap-1.5">
        <span
          className="inline-block size-3 rounded-full"
          style={{ border: "2px solid var(--text-primary)" }}
        />
        {t("legend.near")}
      </span>
    </div>
  );
}
