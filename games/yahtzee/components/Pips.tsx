// Where each face's pips sit, on a face 100 units across.
const PIPS: Record<number, [cx: number, cy: number][]> = {
  1: [[50, 50]],
  2: [
    [28, 28],
    [72, 72],
  ],
  3: [
    [28, 28],
    [50, 50],
    [72, 72],
  ],
  4: [
    [28, 28],
    [72, 28],
    [28, 72],
    [72, 72],
  ],
  5: [
    [28, 28],
    [72, 28],
    [50, 50],
    [28, 72],
    [72, 72],
  ],
  6: [
    [28, 25],
    [28, 50],
    [28, 75],
    [72, 25],
    [72, 50],
    [72, 75],
  ],
};

// A die's face, its pips filling whatever box it is given.
export function Pips({ face }: { face: number }) {
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true" className="size-full">
      {(PIPS[face] ?? []).map(([cx, cy]) => (
        <circle key={`${cx}:${cy}`} cx={cx} cy={cy} r="9.5" fill="var(--tile-ink)" />
      ))}
    </svg>
  );
}
