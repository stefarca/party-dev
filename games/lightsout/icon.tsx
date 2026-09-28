// The tile icon: a 3×3 board just pressed in the middle, the plus it lit filled and the corners
// still dark rings. Drawn inside the 24×24 `<svg>` of `GameGlyph` in `currentColor`.
export default function LightsOutIcon() {
  return (
    <g fill="currentColor" stroke="currentColor">
      <rect x="9" y="2" width="6" height="6" rx="1.6" stroke="none" />
      <rect x="2" y="9" width="6" height="6" rx="1.6" stroke="none" />
      <rect x="9" y="9" width="6" height="6" rx="1.6" stroke="none" />
      <rect x="16" y="9" width="6" height="6" rx="1.6" stroke="none" />
      <rect x="9" y="16" width="6" height="6" rx="1.6" stroke="none" />
      <g fill="none" strokeWidth="1.6">
        <rect x="2.8" y="2.8" width="4.4" height="4.4" rx="1.2" />
        <rect x="16.8" y="2.8" width="4.4" height="4.4" rx="1.2" />
        <rect x="2.8" y="16.8" width="4.4" height="4.4" rx="1.2" />
        <rect x="16.8" y="16.8" width="4.4" height="4.4" rx="1.2" />
      </g>
    </g>
  );
}
