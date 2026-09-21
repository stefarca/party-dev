// The tile icon: a sudoku box, its grid ruled in thirds, with a few of its digits filled in. Drawn
// inside the 24×24 `<svg>` of `GameGlyph` in `currentColor`.
export default function SudokuIcon() {
  return (
    <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2.5" y="2.5" width="19" height="19" rx="4.5" strokeWidth="2" />
      <path d="M8.8 3v18M15.2 3v18M3 8.8h18M3 15.2h18" strokeWidth="1.2" opacity="0.5" />
      <path
        d="M4.9 4.6l1.2-.8v3.8M10.7 10.1h2.8l-1.9 3.8M19 20.2v-3.9l-2.4 2.8h3.2"
        strokeWidth="1.8"
      />
    </g>
  );
}
