// A golf term for a hole's score against its par.
export function termOf(strokes: number, par: number) {
  const toPar = strokes - par;
  if (toPar <= -2) return "eagle" as const;
  if (toPar === -1) return "birdie" as const;
  if (toPar === 0) return "par" as const;
  if (toPar === 1) return "bogey" as const;
  if (toPar === 2) return "double" as const;
  return "triple" as const;
}

// A hole's score in golf terms, from an eagle down to a triple bogey.
export type Term = ReturnType<typeof termOf>;
