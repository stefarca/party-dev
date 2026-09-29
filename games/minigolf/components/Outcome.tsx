import { useTranslation } from "react-i18next";

import { Banner } from "../../common/Banner";
import { BUTTON, PRIMARY } from "../../common/buttons";
import type { Focusable } from "../../common/keyboard";

// Focuses the Next button as it appears, like `autoFocus`, but without
// scrolling the page. Declared once, so React
// calls it only when the button mounts rather than on every render.
const focusOnMount = (element: unknown) => {
  (element as Focusable | null)?.focus({ preventScroll: true });
};

// Where along the field's bottom edge the pill floats, as complete class
// strings: across the middle, or in a corner, kept narrow enough to clear a
// cup in the other one.
const SIDE = {
  center: "inset-x-3 items-center",
  left: "left-3 max-w-[60%] items-start",
  right: "right-3 max-w-[60%] items-end",
} as const;

// What the last shot did, as a pill floating over the bottom of the field:
// celebrated when it dropped. On a hole it finished, a Next button moves the
// course on. Nothing on the field can be played while it shows, so it may
// cover some of it. The bottom edge, never the top, since a page scrolled
// down to the shot controls has the top of the field under the app's sticky
// header. The parent sets the field's box as the positioning context, and
// picks the side that keeps the cup in view.
export function Outcome({
  text,
  holed,
  side,
  onNext,
}: {
  text: string;
  holed: boolean;
  side: keyof typeof SIDE;
  // Present while the finished hole is still on screen.
  onNext: (() => void) | null;
}) {
  const { t } = useTranslation("minigolf");
  return (
    <div
      className={`pointer-events-none absolute bottom-3 flex flex-col gap-2 text-balance drop-shadow-md ${SIDE[side]}`}
    >
      <Banner fill={holed ? "var(--tile-32)" : "var(--tile-2)"} celebrate={holed}>
        {text}
      </Banner>
      {onNext && (
        <button
          type="button"
          ref={focusOnMount}
          onClick={onNext}
          className={`${BUTTON} ${PRIMARY} pointer-events-auto h-11 gap-2 rounded-[var(--radius-pill)] px-5 text-sm font-bold`}
        >
          {t("next")}
          <span aria-hidden="true">→</span>
        </button>
      )}
    </div>
  );
}
