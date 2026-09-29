// The tile icon: two dice mid-throw, a tilted one outlined showing two and a solid one in front
// showing three, its pips knocked out. Drawn inside the 24×24 `<svg>` of `GameGlyph` in
// `currentColor`.
export default function YahtzeeIcon() {
  return (
    <g fill="currentColor" stroke="currentColor">
      <g transform="rotate(-14 7.5 7.5)">
        <rect x="2.5" y="2.5" width="10" height="10" rx="2.6" fill="none" strokeWidth="1.8" />
        <circle cx="5.6" cy="5.6" r="1.25" stroke="none" />
        <circle cx="9.4" cy="9.4" r="1.25" stroke="none" />
      </g>
      <path
        stroke="none"
        fillRule="evenodd"
        d="M13.8 10.5h5.4a3 3 0 0 1 3 3v5.4a3 3 0 0 1-3 3h-5.4a3 3 0 0 1-3-3v-5.4a3 3 0 0 1 3-3ZM12.6 13.8a1.4 1.4 0 1 0 2.8 0a1.4 1.4 0 1 0-2.8 0ZM15.1 16.2a1.4 1.4 0 1 0 2.8 0a1.4 1.4 0 1 0-2.8 0ZM17.6 18.6a1.4 1.4 0 1 0 2.8 0a1.4 1.4 0 1 0-2.8 0Z"
      />
    </g>
  );
}
