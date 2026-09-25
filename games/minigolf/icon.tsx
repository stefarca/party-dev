// The tile icon: a flag in the cup, and a ball rolling up to it. Drawn inside the 24×24 `<svg>`
// of `GameGlyph` in `currentColor`.
export default function MinigolfIcon() {
  return (
    <g fill="currentColor" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 18V3.5" fill="none" strokeWidth="1.8" />
      <path d="M13 3.5l6.5 2.8L13 9.1z" strokeWidth="1.4" />
      <ellipse cx="13" cy="18.5" rx="5.5" ry="2" fill="none" strokeWidth="1.8" />
      <circle cx="5" cy="18" r="2.4" stroke="none" />
    </g>
  );
}
