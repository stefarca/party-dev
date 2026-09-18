// The tile icon: the # grid with an X and an O in play. Drawn inside the 24×24 `<svg>` of
// `GameGlyph` in `currentColor`.
export default function TicTacToeIcon() {
  return (
    <g fill="none" stroke="currentColor" strokeLinecap="round">
      <path d="M8 1.5v21M16 1.5v21M1.5 8h21M1.5 16h21" strokeWidth="1.5" opacity="0.5" />
      <path d="M2 2l4 4M6 2l-4 4" strokeWidth="2.4" />
      <circle cx="12" cy="12" r="2.4" strokeWidth="2.4" />
      <path d="M18 18l4 4M22 18l-4 4" strokeWidth="2.4" />
    </g>
  );
}
