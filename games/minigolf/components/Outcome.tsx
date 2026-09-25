import { useTranslation } from "react-i18next";

import { Banner } from "../../common/Banner";
import { BUTTON, PRIMARY } from "../../common/buttons";

// What the last shot did, as a pill: celebrated when it dropped. On a hole
// it finished, a Next button moves the course on.
export function Outcome({
  text,
  holed,
  onNext,
}: {
  text: string;
  holed: boolean;
  // Present while the finished hole is still on screen.
  onNext: (() => void) | null;
}) {
  const { t } = useTranslation("minigolf");
  return (
    <div className="flex flex-col items-center gap-2">
      <Banner fill={holed ? "var(--tile-32)" : "var(--tile-2)"} celebrate={holed}>
        {text}
      </Banner>
      {onNext && (
        <button
          type="button"
          autoFocus
          onClick={onNext}
          className={`${BUTTON} ${PRIMARY} h-11 gap-2 rounded-[var(--radius-pill)] px-5 text-sm font-bold`}
        >
          {t("next")}
          <span aria-hidden="true">→</span>
        </button>
      )}
    </div>
  );
}
