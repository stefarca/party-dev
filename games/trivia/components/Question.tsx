export function Question({ text }: { text: string }) {
  return (
    <h3 className="m-0 font-display text-xl leading-snug font-bold text-balance text-[var(--text-primary)] sm:text-2xl">
      {text}
    </h3>
  );
}
