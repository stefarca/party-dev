import { Description, Label, Switch } from "@heroui/react";
import { useTranslation } from "react-i18next";

import type { MatchVisibility } from "../../shared/protocol";

// Private or public, as one switch: off is invite-only, on also lists the lobby
// under the hub's Public tab. The line under it always says what the current
// setting means, so the switch never has to be understood from its position
// alone. Used on the hub's shelf, for the next match, and by the host in the
// lobby, for this one.
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
    <Switch
      size="sm"
      isSelected={visibility === "public"}
      onChange={(on) => onChange(on ? "public" : "private")}
      isDisabled={isDisabled}
      className={`flex flex-col gap-1 ${className}`}
    >
      <Switch.Content>
        <Switch.Control>
          <Switch.Thumb />
        </Switch.Control>
        <Label className="text-sm font-bold text-[var(--text-primary)]">
          {t("visibility.label")}
        </Label>
      </Switch.Content>
      <Description className="text-xs text-[var(--text-muted)]">
        {t(`visibility.${visibility}`)}
      </Description>
    </Switch>
  );
}
