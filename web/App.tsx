import { useState } from "react";
import type { FormEvent } from "react";

import { Avatar, Button, Form, Input, Label, Popover, TextField } from "@heroui/react";

import { ApiError } from "./api";
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
      <Button variant="ghost" size="sm" className="max-w-28 gap-2 sm:max-w-none">
        <Avatar size="sm">
          <Avatar.Fallback>{player.nickname.slice(0, 1).toUpperCase()}</Avatar.Fallback>
        </Avatar>
        <span className="truncate">{player.nickname}</span>
      </Button>
      <Popover.Content placement="bottom end">
        <Popover.Dialog aria-label="Rename nickname">
          <Form onSubmit={handleRename} className="flex w-56 flex-col gap-2 p-3">
            <TextField value={value} onChange={setValue} maxLength={24}>
              <Label className="sr-only">Nickname</Label>
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
    <header className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface/80 px-4 py-3 backdrop-blur-md">
      <a
        href="/"
        className="inline-flex items-center gap-2 text-lg font-bold text-foreground no-underline"
        onClick={(e) => {
          e.preventDefault();
          navigate("/");
        }}
      >
        <WordMark className="size-5 text-accent" />
        party-dev
      </a>
      <div className="flex flex-wrap items-center gap-2">
        <RenameControl />
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
      <main
        id="main-content"
        className="flex min-h-dvh flex-col items-center justify-center gap-4 animate-in fade-in duration-500"
      >
        <WordMark className="size-10 text-accent" />
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
