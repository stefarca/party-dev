import { useRef, useState } from "react";

import type { LastShot, MinigolfView } from "./game";

// Which shot is playing back, and which finished hole is waiting to be moved
// on from. Shots the page has already shown count from those it loaded
// with: any shot past that rolls along its path before the course moves on.
export function usePlayback(v: MinigolfView | null) {
  const loadedWith = useRef<number | null>(null);
  if (v && loadedWith.current === null) loadedWith.current = v.shots;
  const [shown, setShown] = useState<number | null>(null);
  // A hole the last shot finished, kept on screen until its player moves on.
  const [finished, setFinished] = useState<LastShot | null>(null);

  const seen = shown ?? loadedWith.current ?? v?.shots ?? 0;
  const flying = v && v.last !== null && v.shots > seen ? v.last : null;

  return {
    flying,
    finished,
    // The shot in flight has come to rest.
    landed() {
      if (!v) return;
      setShown(v.shots);
      if (v.last && v.last.card !== null && !v.over) setFinished(v.last);
    },
    moveOn() {
      setFinished(null);
    },
  };
}
