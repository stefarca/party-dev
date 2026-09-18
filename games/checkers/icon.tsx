// The tile icon: a crowned checker, its ridge and crown cut out (even-odd) so the gradient shows
// through. Drawn inside the 24×24 `<svg>` of `GameGlyph` in `currentColor`.
export default function CheckersIcon() {
  return (
    <path
      fillRule="evenodd"
      d="M1.5 12a10.5 10.5 0 1 0 21 0a10.5 10.5 0 1 0-21 0zM3.6 12a8.4 8.4 0 1 0 16.8 0a8.4 8.4 0 1 0-16.8 0zM5 12a7 7 0 1 0 14 0a7 7 0 1 0-14 0zM8 15.4 7.4 9.2l2.8 2.5L12 7.4l1.8 4.3 2.8-2.5-.6 6.2z"
    />
  );
}
