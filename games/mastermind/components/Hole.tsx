// An empty hole in the board.
export function Hole() {
  return (
    <span
      aria-hidden="true"
      className="block size-full rounded-full shadow-[var(--shadow-inset)]"
      style={{ background: "var(--board-hole)" }}
    />
  );
}
