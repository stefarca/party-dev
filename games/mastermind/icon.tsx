// The tile icon: a row of three code pegs over the two marks that answer it, one filled and one
// a ring. Drawn inside the 24×24 `<svg>` of `GameGlyph` in `currentColor`.
export default function MastermindIcon() {
  return (
    <g fill="currentColor" stroke="currentColor">
      <circle cx="5" cy="9" r="3" stroke="none" />
      <circle cx="12" cy="9" r="3" stroke="none" />
      <circle cx="19" cy="9" r="3" stroke="none" />
      <circle cx="8.5" cy="17.5" r="2" stroke="none" />
      <circle cx="15.5" cy="17.5" r="1.9" fill="none" strokeWidth="1.8" />
    </g>
  );
}
