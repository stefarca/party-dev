// The tile icon: a question mark in a speech bubble. Drawn inside the 24×24 `<svg>` of
// `GameGlyph` in `currentColor`.
export default function TriviaIcon() {
  return (
    <>
      <path
        d="M5 3.5h14A2.5 2.5 0 0 1 21.5 6v9.5A2.5 2.5 0 0 1 19 18h-7.5l-4.5 3.5V18H5a2.5 2.5 0 0 1-2.5-2.5V6A2.5 2.5 0 0 1 5 3.5z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M9.7 8.4a2.4 2.4 0 1 1 3.4 2.2c-.7.35-1.1.9-1.1 1.6v.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="12" cy="15.3" r="1.15" />
    </>
  );
}
