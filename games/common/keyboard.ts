import { useEffect, useRef } from "react";

// Keys a daily board listens for on the whole page, not only while it has
// focus. The listener lives on the window, reached through narrow types of
// its own rather than `window`, since the Worker's type-check of every game
// has no DOM types to offer.

export interface KeyLike {
  key: string;
  repeat: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  defaultPrevented: boolean;
  target: unknown;
  preventDefault(): void;
}

export interface KeyTarget {
  addEventListener(type: "keydown", listener: (event: KeyLike) => void): void;
  removeEventListener(type: "keydown", listener: (event: KeyLike) => void): void;
}

// The window, as far as listening for keys goes.
const keyTarget = globalThis as unknown as KeyTarget;

// Calls `onKey` for every key pressed anywhere on the page while `active`.
// The listener outlives renders, so it always calls the `onKey` of the
// latest one, and sees the board as it is now.
export function useWindowKeys(active: boolean, onKey: (event: KeyLike) => void): void {
  const latest = useRef(onKey);
  latest.current = onKey;
  useEffect(() => {
    if (!active) return;
    const listener = (event: KeyLike) => latest.current(event);
    keyTarget.addEventListener("keydown", listener);
    return () => keyTarget.removeEventListener("keydown", listener);
  }, [active]);
}

// An element, as far as moving focus to it goes. Refs are held as `unknown`
// and narrowed to this: the Worker's type-check has an element type with no
// `focus()`.
export interface Focusable {
  focus(): void;
}

// Keys typed into a field, or pressed inside a dialog, are someone else's.
const NOT_FOR_THE_BOARD =
  "input, textarea, select, [contenteditable], [role='dialog'], [role='alertdialog']";

// Whether the key was pressed inside an element matching `selector`.
export function closest(event: KeyLike, selector: string): boolean {
  const target = event.target as { closest?: (selector: string) => unknown } | null;
  return Boolean(target?.closest?.(selector));
}

// Whether a key is the board's to handle: not a shortcut, not already
// handled, and not typed somewhere else. Shift is allowed here, since some
// keyboards need it to type a digit at all; a board that wants it left
// alone checks it itself.
export function isForTheBoard(event: KeyLike): boolean {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return false;
  return !closest(event, NOT_FOR_THE_BOARD);
}
