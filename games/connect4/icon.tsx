// The tile icon: a disc dropping into a column of the board. Drawn inside the 24×24 `<svg>` of
// `GameGlyph` in `currentColor`; the holes are cut out (even-odd) so the gradient shows through.
export default function Connect4Icon() {
  return (
    <>
      <circle cx="17" cy="4" r="2.5" />
      <path
        fillRule="evenodd"
        d="M5 9h14a2.5 2.5 0 0 1 2.5 2.5v7.5a2.5 2.5 0 0 1-2.5 2.5H5A2.5 2.5 0 0 1 2.5 19v-7.5A2.5 2.5 0 0 1 5 9zM5.1 12.6a1.9 1.9 0 1 0 3.8 0a1.9 1.9 0 1 0-3.8 0zM10.1 12.6a1.9 1.9 0 1 0 3.8 0a1.9 1.9 0 1 0-3.8 0zM15.1 12.6a1.9 1.9 0 1 0 3.8 0a1.9 1.9 0 1 0-3.8 0zM5.1 17.9a1.9 1.9 0 1 0 3.8 0a1.9 1.9 0 1 0-3.8 0zM10.1 17.9a1.9 1.9 0 1 0 3.8 0a1.9 1.9 0 1 0-3.8 0zM15.1 17.9a1.9 1.9 0 1 0 3.8 0a1.9 1.9 0 1 0-3.8 0z"
      />
    </>
  );
}
