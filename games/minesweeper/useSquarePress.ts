import { useEffect, useRef } from "react";

// How long a finger rests on a square before it plants a flag there.
const LONG_PRESS_MS = 400;

// A finger resting on a square: the timer that will flag it, and whether it
// already has, so the tap that follows the press does not open it as well.
interface Press {
  cell: number;
  timer: ReturnType<typeof setTimeout> | null;
  flagged: boolean;
}

export interface SquarePress {
  onPointerDown(event: { pointerType: string }): void;
  onPointerUp(): void;
  onPointerLeave(): void;
  onPointerCancel(): void;
  onClick(): void;
  onContextMenu(event: { preventDefault(): void }): void;
}

// What a pointer does to a square: a tap opens it, and a long press on a
// touch screen, or a right-click, flags it. Returns the handlers for one
// square, sharing one press between all of them.
export function useSquarePress({
  playable,
  onSelect,
  onOpen,
  onFlag,
  onPointer,
}: {
  playable: boolean;
  onSelect: (cell: number) => void;
  onOpen: (cell: number) => void;
  onFlag: (cell: number) => void;
  // Any pointer touching the board, which takes the keyboard's ring away.
  onPointer: () => void;
}): (cell: number) => SquarePress {
  const press = useRef<Press | null>(null);
  // Whether the pointer that last touched the board was a mouse. A long press
  // on a phone can raise a context menu too, and the press's own timer has
  // flagged that square already.
  const mouse = useRef(true);
  // A long press's timer outlives the render that set it; this keeps it
  // acting on the board as it is now.
  const flag = useRef(onFlag);
  flag.current = onFlag;

  useEffect(
    () => () => {
      if (press.current?.timer) clearTimeout(press.current.timer);
    },
    [],
  );

  const letGo = () => {
    const held = press.current;
    if (held?.timer) {
      clearTimeout(held.timer);
      held.timer = null;
    }
  };

  return (cell) => ({
    onPointerDown(event) {
      letGo();
      press.current = null;
      mouse.current = event.pointerType === "mouse";
      onPointer();
      if (mouse.current || !playable) return;
      const held: Press = { cell, timer: null, flagged: false };
      held.timer = setTimeout(() => {
        held.timer = null;
        held.flagged = true;
        flag.current(cell);
      }, LONG_PRESS_MS);
      press.current = held;
    },
    onPointerUp: letGo,
    onPointerLeave: letGo,
    onPointerCancel() {
      letGo();
      press.current = null;
    },
    onClick() {
      const held = press.current;
      press.current = null;
      onSelect(cell);
      if (held?.cell === cell && held.flagged) return;
      onOpen(cell);
    },
    onContextMenu(event) {
      if (!playable) return;
      event.preventDefault();
      if (!mouse.current) return;
      onSelect(cell);
      onFlag(cell);
    },
  });
}
