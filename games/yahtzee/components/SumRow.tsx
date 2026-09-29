import { LINE, POINTS } from "../lines";

// A line the card adds up rather than scores: a subtotal, a bonus, the
// total. `muted` is for a figure still to be earned.
export function SumRow({
  label,
  value,
  muted = false,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <li className={`${LINE} border-transparent bg-[var(--surface-3)]`}>
      <span className="truncate font-bold text-[var(--text-secondary)]">{label}</span>{" "}
      <span
        className={`${POINTS} ${muted ? "text-[var(--text-muted)]" : "text-[var(--text-primary)]"}`}
      >
        {value}
      </span>
    </li>
  );
}
