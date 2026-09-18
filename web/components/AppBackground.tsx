// The ambient backdrop: three big blurred party blobs drifting behind the
// app, plus the dot grid painted by `.app-bg` itself. Fixed, `aria-hidden`
// and `pointer-events: none` — it is never a scroll container and can never
// swallow a click.
//
// The blobs are deliberately declared here rather than as `.app-bg::before`
// variants so each one can carry its own colour, size and phase without the
// stylesheet growing a rule per blob.
// `opacity` is per-blob rather than shared: the mint and warm hues are far
// more luminous than the accent violet, so an opacity that reads as a hint
// behind the accent blob reads as a wash of colour behind those two.
const BLOBS: { color: string; className: string; delay: string; opacity: number }[] = [
  {
    color: "var(--accent)",
    className: "-top-40 -left-32 size-[28rem] sm:size-[36rem]",
    delay: "0s",
    opacity: 0.35,
  },
  {
    color: "var(--party-pink)",
    className: "-top-32 -right-40 size-[24rem] sm:size-[32rem]",
    delay: "-9s",
    opacity: 0.28,
  },
  {
    color: "var(--party-mint)",
    className: "-bottom-72 left-1/4 size-[26rem] sm:size-[34rem]",
    delay: "-17s",
    opacity: 0.16,
  },
];

export function AppBackground() {
  return (
    <div className="app-bg" aria-hidden="true">
      {BLOBS.map((blob) => (
        <span
          key={blob.className}
          className={`party-blob ${blob.className}`}
          style={{ background: blob.color, animationDelay: blob.delay, opacity: blob.opacity }}
        />
      ))}
    </div>
  );
}
