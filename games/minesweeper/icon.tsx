// The tile icon: a mine, its spikes out on every side. Drawn inside the 24×24 `<svg>` of
// `GameGlyph` in `currentColor`.
export default function MinesweeperIcon() {
  return (
    <g fill="none" stroke="currentColor" strokeLinecap="round">
      <circle cx="12" cy="12" r="6" fill="currentColor" stroke="none" />
      <path
        d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1"
        strokeWidth="2.2"
      />
    </g>
  );
}
