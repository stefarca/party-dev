import { Button, Label, Switch, Tooltip } from "@heroui/react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { MatchVisibility } from "../../shared/protocol";

const VISIBILITIES: readonly MatchVisibility[] = ["private", "public"];

// Private or public, as one switch: off is invite-only, on also lists the lobby
// under the hub's Public tab. Its label names the current setting, and the info
// button beside it explains both. Used on the hub's shelf, for the next match,
// and by the host in the lobby, for this one.
export function VisibilitySwitch({
  visibility,
  onChange,
  isDisabled = false,
  className = "",
}: {
  visibility: MatchVisibility;
  onChange: (next: MatchVisibility) => void;
  isDisabled?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <div className={`flex items-center gap-1 ${className}`}>
      <Switch
        size="sm"
        isSelected={visibility === "public"}
        onChange={(on) => onChange(on ? "public" : "private")}
        isDisabled={isDisabled}
      >
        <Switch.Content>
          <Switch.Control>
            <Switch.Thumb />
          </Switch.Control>
          {/* Both labels share one grid cell, so the switch is as wide as the longer one and
              nothing beside it shifts when it flips. The other one is hidden, which also keeps it
              out of the switch's accessible name. */}
          <Label className="grid text-sm font-bold text-[var(--text-primary)]">
            {VISIBILITIES.map((v) => (
              <span
                key={v}
                aria-hidden={v !== visibility}
                className={`col-start-1 row-start-1 ${v === visibility ? "" : "invisible"}`}
              >
                {t(`visibility.${v}`)}
              </span>
            ))}
          </Label>
        </Switch.Content>
      </Switch>
      <VisibilityInfo />
    </div>
  );
}

// Opens on hover and keyboard focus like any tooltip, and on a tap too, since a
// touch screen has no hover. A tap anywhere else closes it again.
function VisibilityInfo() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (e: PointerEvent) => {
      if (!trigger.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  return (
    <Tooltip delay={0} isOpen={open} onOpenChange={setOpen} shouldCloseOnPress={false}>
      <Button
        ref={trigger}
        isIconOnly
        variant="ghost"
        size="sm"
        aria-label={t("visibility.about")}
        onPress={(e) => {
          if (e.pointerType === "touch") setOpen((o) => !o);
        }}
        className="size-7 min-w-0 rounded-full text-[var(--text-muted)] hover:text-[var(--text-primary)]"
      >
        <svg
          viewBox="0 0 24 24"
          className="size-4"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v5" />
          <circle cx="12" cy="7.75" r="0.5" fill="currentColor" />
        </svg>
      </Button>
      <Tooltip.Content showArrow placement="bottom" className="rounded-sm px-3 py-2.5 break-normal">
        <Tooltip.Arrow />
        <dl className="m-0 flex flex-col gap-2 text-xs">
          {VISIBILITIES.map((v) => (
            <div key={v}>
              <dt className="font-bold text-[var(--text-primary)]">{t(`visibility.${v}`)}</dt>
              <dd className="m-0 text-[var(--text-secondary)]">{t(`visibility.hint.${v}`)}</dd>
            </div>
          ))}
        </dl>
      </Tooltip.Content>
    </Tooltip>
  );
}
