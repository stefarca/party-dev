// Four tiles tumbling around a centre — an abstract "party" mark with no
// game-specific imagery. Each tile floats on its own phase, so the logo has
// a slow idle life to it; `prefers-reduced-motion` flattens that globally.
export function WordMark({
  className = "size-6 text-current",
  animated = false,
}: {
  className?: string;
  animated?: boolean;
}) {
  const tiles = [
    { x: 3, y: 3, opacity: 1, delay: "0s" },
    { x: 13.5, y: 3, opacity: 0.75, delay: "-1.1s" },
    { x: 3, y: 13.5, opacity: 0.75, delay: "-2.2s" },
    { x: 13.5, y: 13.5, opacity: 0.5, delay: "-3.3s" },
  ];

  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      fill="currentColor"
    >
      {tiles.map((tile) => (
        <rect
          key={`${tile.x}-${tile.y}`}
          x={tile.x}
          y={tile.y}
          width="7.5"
          height="7.5"
          rx="2.6"
          opacity={tile.opacity}
          style={
            animated
              ? {
                  animation: `party-float 3.6s var(--ease-out) ${tile.delay} infinite`,
                  transformOrigin: `${tile.x + 3.75}px ${tile.y + 3.75}px`,
                }
              : undefined
          }
        />
      ))}
    </svg>
  );
}
