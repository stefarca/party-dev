import { useState } from "react";
import type { FormEvent } from "react";

import { Button, Form, Input, Label, Popover, TextField } from "@heroui/react";

import { ApiError } from "./api";
import { AppBackground } from "./components/AppBackground";
import { PlayerAvatar } from "./components/PlayerAvatar";
import { Spinner } from "./components/states";
import { ThemeToggle } from "./components/ThemeToggle";
import { WordMark } from "./components/WordMark";
import { Dashboard } from "./routes/Dashboard";
import { MatchPage } from "./routes/MatchPage";
import { NicknameGate } from "./routes/NicknameGate";
import { navigate, useRoute } from "./router";
import { SessionProvider, useSession } from "./session";

function RenameControl() {
  const { player, rename } = useSession();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(player?.nickname ?? "");
  const [error, setError] = useState<string | null>(null);

  if (!player) return null;
  const nickname = player.nickname;

  function setOpen(open: boolean) {
    setEditing(open);
    if (open) {
      setValue(nickname);
      setError(null);
    }
  }

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
    <Popover isOpen={editing} onOpenChange={setOpen}>
      <Button
        variant="ghost"
        size="sm"
        aria-label={`Signed in as ${nickname}. Change nickname`}
        className="max-w-32 gap-2 rounded-[var(--radius-pill)] border border-[var(--border-subtle)] bg-[var(--surface-2)] pr-3 pl-1 transition-transform duration-[var(--dur-fast)] ease-[var(--ease-spring)] hover:scale-105 sm:max-w-none"
      >
        <PlayerAvatar id={player.playerId} nickname={nickname} size="sm" />
        <span className="truncate text-sm font-bold">{nickname}</span>
      </Button>
      <Popover.Content placement="bottom end">
        <Popover.Dialog aria-label="Rename nickname">
          <Form onSubmit={handleRename} className="flex w-60 flex-col gap-3 p-4">
            <TextField value={value} onChange={setValue} maxLength={24}>
              <Label className="text-xs font-bold text-[var(--text-muted)]">Nickname</Label>
              <Input autoFocus />
            </TextField>
            {error && (
              <p role="alert" className="m-0 text-sm text-danger">
                {error}
              </p>
            )}
            <div className="flex gap-2">
              <Button type="submit" size="sm">
                Save
              </Button>
              <Button type="button" variant="ghost" size="sm" onPress={() => setOpen(false)}>
                Cancel
              </Button>
            </div>
          </Form>
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}

function Header() {
  return (
    <header className="sticky top-0 z-20 border-b border-[var(--border-subtle)] bg-[var(--surface-void)]/75 backdrop-blur-xl">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-3">
        <a
          href="/"
          className="group inline-flex items-center gap-2 font-display text-lg font-bold text-[var(--text-primary)] no-underline"
          onClick={(e) => {
            e.preventDefault();
            navigate("/");
          }}
        >
          <WordMark
            animated
            className="size-7 text-accent transition-transform duration-[var(--dur-base)] ease-[var(--ease-bounce)] group-hover:rotate-12 group-hover:scale-110"
          />
          <span>party</span>
        </a>
        <div className="flex items-center gap-2">
          <RenameControl />
          <ThemeToggle />
        </div>
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
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <WordMark animated className="size-14 text-accent opacity-60" />
        <h1 className="m-0 font-display text-2xl font-bold">Nothing here</h1>
        <p className="m-0 text-[var(--text-muted)]">That link does not point at a match.</p>
        <Button onPress={() => navigate("/")}>Back to the hub</Button>
      </div>
    </main>
  );
}

function AppShell() {
  const { state } = useSession();

  if (state === "loading") {
    return (
      <main
        id="main-content"
        className="flex min-h-dvh animate-in flex-col items-center justify-center gap-5 duration-500 fade-in"
      >
        <WordMark animated className="size-14 text-accent" />
        <Spinner label="Loading party" />
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
      <AppBackground />
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      <AppShell />
    </SessionProvider>
  );
}
