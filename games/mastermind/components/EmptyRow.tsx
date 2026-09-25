import { PEGS } from "../game";
import { HOLES, NUMBER, ROW } from "../rows";
import { Hole } from "./Hole";
import { Marks } from "./Marks";

// A row no guess has reached, dimmed and hidden from assistive technology.
export function EmptyRow({ number }: { number: number }) {
  return (
    <div aria-hidden="true" className={`${ROW} opacity-60`}>
      <span className={NUMBER}>{number}</span>
      <span className={HOLES}>
        {Array.from({ length: PEGS }, (_, slot) => (
          <span key={slot} className="aspect-square">
            <Hole />
          </span>
        ))}
      </span>
      <Marks guess={null} />
    </div>
  );
}
