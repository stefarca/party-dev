// The tile icon: a single 2048 tile holding a 2, the tile every run starts from. Drawn inside
// the 24×24 `<svg>` of `GameGlyph` in `currentColor`.
export default function G2048Icon() {
  return (
    <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2.5" y="2.5" width="19" height="19" rx="4.5" strokeWidth="2" />
      <path d="M8.7 9.3a3.3 3.3 0 1 1 5.8 2.2L8.7 17.3h6.6" strokeWidth="2.4" />
    </g>
  );
}
