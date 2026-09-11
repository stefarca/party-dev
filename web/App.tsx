import { useEffect, useState } from "react";

// Throwaway plumbing-proof UI. Plan 03 replaces this with the real
// dashboard / match screens.
export function App() {
  const [health, setHealth] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((res) => res.json())
      .then(setHealth)
      .catch((err) => setError(String(err)));
  }, []);

  return (
    <main>
      <h1>party-dev</h1>
      <p>Plumbing proof: Worker → Durable Object → D1.</p>
      {error && <pre className="error">{error}</pre>}
      <pre>{health ? JSON.stringify(health, null, 2) : "loading..."}</pre>
    </main>
  );
}
