import { useState } from "react";
import type { FormEvent } from "react";

import { ApiError } from "./api";
import { Spinner } from "./components/states";
import { ThemeToggle } from "./components/ThemeToggle";
import { WordMark } from "./components/WordMark";
import { Dashboard } from "./routes/Dashboard";
import { MatchPage } from "./routes/MatchPage";
import { NicknameGate } from "./routes/NicknameGate";
import { navigate, useRoute } from "./router";
import { SessionProvider, useSession } from "./session";

function Header() {
  const { player, rename } = useSession();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(player?.nickname ?? "");
  const [error, setError] = useState<string | null>(null);

  async function handleRename(e: FormEvent) {
    e.preventDefault();
    try {
      await rename(value);
      setEditing(false);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not rename.");
    }
  }

  return (
    <header className="app-header">
      <a
        href="/"
        className="app-title"
        onClick={(e) => {
          e.preventDefault();
          navigate("/");
        }}
      >
        <WordMark />
        party-dev
      </a>
      <div className="app-header-right">
        {player &&
          (editing ? (
            <form className="rename-form" onSubmit={handleRename}>
              <input
                value={value}
                onChange={(e) => setValue(e.target.value)}
                maxLength={24}
                autoFocus
              />
              <button type="submit" className="btn btn-primary btn-sm">
                Save
              </button>
              <button
                type="button"
                className="btn btn-quiet btn-sm"
                onClick={() => setEditing(false)}
              >
                Cancel
              </button>
              {error && <span className="error">{error}</span>}
            </form>
          ) : (
            <button className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>
              {player.nickname} ✎
            </button>
          ))}
        <ThemeToggle />
      </div>
    </header>
  );
}

function RouteContent() {
  const route = useRoute();
  if (route.name === "dashboard") return <Dashboard />;
  if (route.name === "match") return <MatchPage code={route.code} />;
  return (
    <main id="main-content" className="app-container">
      <p>Page not found.</p>
    </main>
  );
}

function AppShell() {
  const { state } = useSession();

  if (state === "loading") {
    return (
      <main id="main-content" className="splash">
        <WordMark className="splash-mark" />
        <Spinner label="Loading party-dev" />
      </main>
    );
  }

  if (state === "anon") {
    return <NicknameGate />;
  }

  return (
    <>
      <Header />
      <RouteContent />
    </>
  );
}

export function App() {
  return (
    <SessionProvider>
      <div className="app-bg" aria-hidden="true" />
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      <AppShell />
    </SessionProvider>
  );
}
