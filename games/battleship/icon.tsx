// The tile icon: a warship riding a wave, its portholes cut out (even-odd) so the gradient shows
// through. Drawn inside the 24×24 `<svg>` of `GameGlyph` in `currentColor`.
export default function BattleshipIcon() {
  return (
    <>
      <path
        fillRule="evenodd"
        d="M1.5 12.5h21l-2.6 4.3a1.6 1.6 0 0 1-1.4.8H5.5a1.6 1.6 0 0 1-1.4-.8zM6.3 14.9a1 1 0 1 0 2 0a1 1 0 1 0-2 0zM11 14.9a1 1 0 1 0 2 0a1 1 0 1 0-2 0zM15.7 14.9a1 1 0 1 0 2 0a1 1 0 1 0-2 0z"
      />
      <path d="M7 12.5V9.6a1 1 0 0 1 1-1h6.2a1 1 0 0 1 1 1v2.9zM9.8 8.6V5.2h2.2v3.4zM15.2 10.6l4.6-1.6.5 1.3-4.6 1.6z" />
      <path
        d="M2 20.6c1.7 0 1.7-1 3.3-1s1.7 1 3.3 1 1.7-1 3.4-1 1.7 1 3.3 1 1.7-1 3.4-1 1.6 1 3.3 1"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </>
  );
}
