// What a game shows before its first view arrives.
export function Loading({ label }: { label: string }) {
  return <p className="m-0 text-[var(--text-muted)]">{label}</p>;
}
