// What a light shows besides its colour, so on and off differ in shape as
// well: a sun while it is on, an empty ring once it is off.
export function LightGlyph({ on }: { on: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-1/2">
      {on ? (
        <g stroke="var(--tile-ink)" strokeLinecap="round" opacity="0.7">
          <circle cx="12" cy="12" r="4.5" fill="var(--tile-ink)" stroke="none" />
          <path
            d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M18.7 5.3l-1.8 1.8M7.1 16.9l-1.8 1.8"
            strokeWidth="2.2"
          />
        </g>
      ) : (
        <circle cx="12" cy="12" r="4.5" fill="none" stroke="var(--board-mark)" strokeWidth="2" />
      )}
    </svg>
  );
}
