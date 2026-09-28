// The chunky buttons the daily games put under their boards: a raised face
// that grows under the pointer and dips when pressed. `BUTTON` is the shape
// and motion; one of the fills below goes with it.
export const BUTTON =
  "flex cursor-pointer items-center justify-center border text-[var(--text-primary)] shadow-[var(--edge-highlight)] transition-transform duration-[var(--dur-fast)] ease-[var(--ease-spring)] touch-manipulation not-disabled:hover:scale-105 not-disabled:active:scale-95 disabled:cursor-not-allowed disabled:opacity-40";
export const PLAIN = "border-[var(--border-subtle)] bg-[var(--surface-2)]";
export const PRESSED = "border-[var(--border-accent)] bg-[var(--accent-soft)]";
export const PRIMARY = "border-transparent bg-[var(--accent)] text-[var(--text-on-accent)]";
